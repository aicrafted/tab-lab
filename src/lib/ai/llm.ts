import { getChatProvider } from './providers/factory'
import { llmLog } from '../core/logger'
import type { LlmSettings } from '../core/types'

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


export interface ChatOptions {
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  responseFormat?: 'json'
  jsonSchema?: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
  metricKey?: string
  disableThinking?: boolean
  topK?: number
}

type LlmMetric = {
  calls: number
  structuredRequested: number
  structuredFallback: number
  failures: number
}

const llmMetrics = new Map<string, LlmMetric>()
const ENABLE_LLM_CALL_DEBUG = true
const LLM_LOG_PREVIEW_MAX = 4000
let llmCallSeq = 0

function toPreview(text: string): string {
  if (text.length <= LLM_LOG_PREVIEW_MAX) return text
  return `${text.slice(0, LLM_LOG_PREVIEW_MAX)}... <truncated ${text.length - LLM_LOG_PREVIEW_MAX} chars>`
}

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
    llmLog.info(`metrics ${key}`, {
      calls: metric.calls,
      structuredRequested: metric.structuredRequested,
      structuredFallback: metric.structuredFallback,
      failures: metric.failures,
    })
  }
}


export async function chatComplete(
  systemPrompt: string,
  userMessage: string,
  settings: LlmSettings,
  maxTokens = 512,
  options: ChatOptions = {},
): Promise<string> {
  const cleanMessage = sanitizeForLlm(userMessage)
  const metricKey = options.metricKey ?? 'default'
  const provider = settings.tasks.chat.provider
  const callId = ++llmCallSeq
  const startedAt = Date.now()
  const chatProviderInstance = getChatProvider(provider)
  const model = chatProviderInstance.getChatModel(settings) ?? provider
  
  // Resolve effective params for logging
  const effectiveTemperature = options.temperature ?? chatProviderInstance.getTemperature(settings)
  const effectiveTopK = options.topK ?? (provider === 'gemini-nano' ? 3 : undefined)

  if (ENABLE_LLM_CALL_DEBUG) {
    llmLog.info('llm-call start', {
      callId,
      provider,
      metricKey,
      model,
      maxTokens,
      temperature: effectiveTemperature,
      ...(effectiveTopK !== undefined ? { topK: effectiveTopK } : {}),
      responseFormat: options.responseFormat ?? 'text',
      systemPromptLength: systemPrompt.length,
      userMessageLength: cleanMessage.length,
      systemPromptPreview: toPreview(systemPrompt),
      userMessagePreview: toPreview(cleanMessage),
    })
  }

  trackLlmMetric(metricKey, (metric) => {
    metric.calls += 1
    if (options.responseFormat === 'json') metric.structuredRequested += 1
  })
  try {
    const chatProvider = getChatProvider(provider)
    const response = await chatProvider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: cleanMessage },
      ],
      settings,
      {
        maxTokens,
        signal: options.signal,
        ...options,
      }
    )
    if (ENABLE_LLM_CALL_DEBUG) {
      llmLog.info('llm-call done', {
        callId,
        provider,
        metricKey,
        elapsedMs: Date.now() - startedAt,
        responseLength: response.length,
        responsePreview: toPreview(response),
      })
    }
    return response
  } catch (err) {
    if (ENABLE_LLM_CALL_DEBUG) {
      llmLog.error('llm-call failed', {
        callId,
        provider,
        metricKey,
        elapsedMs: Date.now() - startedAt,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  }
}
