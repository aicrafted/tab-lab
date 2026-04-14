import { chatComplete, extractJson } from './llm'
import { getCached, setCached } from './storage'
import type { LlmSettings } from './types'
import { DEFAULT_LLM_SETTINGS } from './types'

const TAG_SYSTEM_PROMPT = `You are a web page tagger. For each browser tab title, domain, and URL path, reply with exactly 3-5 lowercase tags separated by commas. Tags must be concise (1-2 words), specific, and useful for filtering a personal collection. Avoid generic tags like "website" or "internet". Reply with tags only — no explanation, no extra punctuation.`
const TAG_SYSTEM_PROMPT_JSON = `You are a web page tagger. Output a JSON object with a "tags" key containing an array of 3-5 lowercase tags. Tags must be concise (1-2 words), specific, and useful for filtering a personal collection. Avoid generic tags like "website" or "internet".

Example output: {"tags": ["rust", "async", "performance"]}`
const tagParseMetrics = {
  strict: 0,
  fallback: 0,
}

function trackTagParse(strict: boolean): void {
  if (strict) tagParseMetrics.strict += 1
  else tagParseMetrics.fallback += 1
  const total = tagParseMetrics.strict + tagParseMetrics.fallback
  if (total > 0 && total % 25 === 0) {
    console.info(`[tagger:parse] strict=${tagParseMetrics.strict} fallback=${tagParseMetrics.fallback}`)
  }
}
const TAGS_RESPONSE_SCHEMA = {
  name: 'tags_response',
  schema: {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['tags'],
    additionalProperties: false,
  },
  strict: false,
} as const

function urlPathSnippet(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    return path.slice(0, 80)
  } catch {
    return ''
  }
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((token) => token.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, ''))
    .filter((token) => token.length > 1 && token.length < 30)
    .slice(0, 5)
}

function parseTagsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(extractJson(raw)) as { tags?: unknown }
    if (Array.isArray(parsed.tags)) {
      const tags = (parsed.tags as unknown[])
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, ''))
        .filter((tag) => tag.length > 1 && tag.length < 30)
        .slice(0, 5)
      trackTagParse(true)
      return tags
    }
  } catch {
  }
  trackTagParse(false)
  return parseTags(raw)
}

export async function tagItems(
  items: { url: string; title: string; domain: string }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; tags: string[] }[]) => void,
): Promise<void> {
  const uncached: typeof items = []
  const cached: { url: string; tags: string[] }[] = []

  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      if (entry?.tags?.length) cached.push({ url: item.url, tags: entry.tags })
      else uncached.push(item)
    }),
  )

  if (cached.length > 0) onProgress(cached)
  if (uncached.length === 0) return

  const provider = settings.tasks.chat.provider
  const useJsonOutput = provider !== 'gemini-nano'
  const systemPrompt = useJsonOutput ? TAG_SYSTEM_PROMPT_JSON : TAG_SYSTEM_PROMPT
  const options = useJsonOutput
    ? {
      responseFormat: 'json' as const,
      metricKey: 'tags',
      jsonSchema: TAGS_RESPONSE_SCHEMA,
      ...(provider === 'webllm' ? { disableThinking: true } : {}),
    }
    : {}

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH)
    const results: { url: string; tags: string[] }[] = []

    for (const item of batch) {
      try {
        const path = urlPathSnippet(item.url)
        const userMsg = path
          ? `Title: ${item.title}\nDomain: ${item.domain}\nPath: ${path}`
          : `Title: ${item.title}\nDomain: ${item.domain}`
        const raw = await chatComplete(systemPrompt, userMsg, settings, 60, options,
        )
        const tags = useJsonOutput ? parseTagsJson(raw) : parseTags(raw)
        if (tags.length > 0) {
          const existing = await getCached(prefix, item.url)
          await setCached(prefix, item.url, {
            category: existing?.category ?? 'Other',
            processedAt: Date.now(),
            tags,
            intent: existing?.intent,
          })
          results.push({ url: item.url, tags })
        }
      } catch (err) {
        // Skip this item — log but don't abort the batch
        console.warn(`[tagger] skipping ${item.domain}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (results.length > 0) onProgress(results)
  }
}

export async function tagWithGeminiNano(
  items: { url: string; title: string; domain: string }[],
  prefix: 'tab' | 'bm',
  onProgress: (updates: { url: string; tags: string[] }[]) => void,
): Promise<void> {
  await tagItems(
    items,
    prefix,
    {
      ...DEFAULT_LLM_SETTINGS,
      tasks: {
        ...DEFAULT_LLM_SETTINGS.tasks,
        chat: { provider: 'gemini-nano', model: '' },
        embedding: { provider: 'transformers', model: '' },
      },
    },
    onProgress,
  )
}

export async function tagWithLmStudio(
  items: { url: string; title: string; domain: string }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; tags: string[] }[]) => void,
): Promise<void> {
  await tagItems(items, prefix, settings, onProgress)
}
