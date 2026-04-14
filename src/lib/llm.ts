import { webllmChat } from './webllm-provider'
import type { LlmSettings } from './types'

/**
 * Sanitize a string for safe transmission to an LLM.
 * Removes control characters, replacement characters, and strips
 * characters outside the BMP that might cause encoding issues.
 */
export function sanitizeForLlm(text: string): string {
  return text
    // Replace replacement characters and other invalid Unicode
    .replace(/\uFFFD/g, '')
    // Remove control characters except newline and tab
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Remove Unicode control characters
    .replace(/[\u0080-\u009F]/g, '')
    // Strip any remaining problematic sequences
    .replace(/\p{C}/gu, '')
    .trim()
}

/**
 * Extract the first JSON object or array from arbitrary text.
 * Handles cases where the model wraps JSON in prose or code blocks.
 */
export function extractJson(text: string): string {
  // Strip markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) return codeBlock[1].trim()

  // Find first { or [ and extract balanced JSON
  const start = text.search(/[{[]/)
  if (start === -1) return text

  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start)
}

export interface ChatOptions {
  responseFormat?: 'json'
  disableThinking?: boolean
  metricKey?: string
  jsonSchema?: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
}

type LlmMetric = {
  calls: number
  structuredRequested: number
  structuredFallback: number
  failures: number
}

const llmMetrics = new Map<string, LlmMetric>()

function trackLlmMetric(
  key: string,
  updater: (metric: LlmMetric) => void,
): void {
  const metric = llmMetrics.get(key) ?? {
    calls: 0,
    structuredRequested: 0,
    structuredFallback: 0,
    failures: 0,
  }
  updater(metric)
  llmMetrics.set(key, metric)
  if (metric.calls > 0 && metric.calls % 20 === 0) {
    console.info(`[llm:metrics:${key}] calls=${metric.calls} structured=${metric.structuredRequested} fallback=${metric.structuredFallback} failures=${metric.failures}`)
  }
}

// Retry helper with exponential backoff for HTTP requests
async function withHttpRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxRetries - 1) throw err
      const delay = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s
      console.warn(`[llm] attempt ${attempt + 1} failed, retrying in ${delay}ms…`, err)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}

export async function chatComplete(
  systemPrompt: string,
  userMessage: string,
  settings: LlmSettings,
  maxTokens = 40,
  options: ChatOptions = {},
): Promise<string> {
  const cleanMessage = sanitizeForLlm(userMessage)
  const metricKey = options.metricKey ?? 'default'
  trackLlmMetric(metricKey, (metric) => {
    metric.calls += 1
    if (options.responseFormat === 'json') metric.structuredRequested += 1
  })
  const provider = settings.tasks.chat.provider
  switch (provider) {
    case 'gemini-nano': {
      if (!window.ai?.languageModel) throw new Error('Gemini Nano unavailable')
      const session = await window.ai.languageModel.create({ systemPrompt })
      try {
        return (await session.prompt(cleanMessage)).trim()
      } finally {
        session.destroy()
      }
    }
    case 'webllm':
      return webllmChat(systemPrompt, cleanMessage, settings.tasks.chat.model, maxTokens, options)
    case 'openrouter':
    case 'lmstudio':
    default: {
      const baseUrl = provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : settings.providers.lmstudio.baseUrl
      const apiKey = provider === 'openrouter'
        ? settings.providers.openrouter.apiKey
        : settings.providers.lmstudio.apiKey
      const model = settings.tasks.chat.model

      const defaultJsonSchema = {
        name: 'response',
        schema: {
          type: 'object',
          additionalProperties: true,
        },
        strict: false,
      } as const

      const buildBody = (useStructuredJson: boolean): string => JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: cleanMessage },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
        ...(provider === 'lmstudio' && useStructuredJson
          ? {
            response_format: {
              type: 'json_schema',
              json_schema: options.jsonSchema ?? defaultJsonSchema,
            },
          }
          : {}),
      })

      const request = async (useStructuredJson: boolean): Promise<Response> => {
        const body = buildBody(useStructuredJson)
        const r = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/aicrafted/tab-lab' } : {}),
          },
          body,
          signal: AbortSignal.timeout(30_000),
        })
        if (!r.ok) {
          const errorText = await r.text().catch(() => '')
          throw new Error(`Chat API ${r.status}${errorText ? `: ${errorText}` : ''}`)
        }
        return r
      }

      const wantsStructuredJson = options.responseFormat === 'json'
      const res = await withHttpRetry(async () => {
        try {
          return await request(wantsStructuredJson)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const responseFormatIssue = /response_format|json_schema|json_object/i.test(message)
          if (provider === 'lmstudio' && wantsStructuredJson && responseFormatIssue) {
            console.warn('[llm] structured response rejected by server; retrying without response_format', message)
            trackLlmMetric(metricKey, (metric) => {
              metric.structuredFallback += 1
            })
            return request(false)
          }
          trackLlmMetric(metricKey, (metric) => {
            metric.failures += 1
          })
          throw err
        }
      })
      const json = (await res.json()) as { choices: { message: { content: string } }[] }
      return json.choices[0]?.message.content?.trim() ?? ''
    }
  }
}
