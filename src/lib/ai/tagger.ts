import { chatComplete } from './llm'
import { tagItem } from './prompts'
import { getCached, setCached } from '../core/storage'
import type { LlmSettings } from '../core/types'
import { DEFAULT_LLM_SETTINGS } from '../core/types'
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

export async function tagItems(
  items: { url: string; title: string; domain: string }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; tags: string[] }[]) => void,
  signal?: AbortSignal,
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
  const format = 'json' as const
  const useJsonOutput = true
  const systemPrompt = tagItem.system(format)
  const options = {
    responseFormat: 'json' as const,
    metricKey: 'tags',
    jsonSchema: TAGS_RESPONSE_SCHEMA,
    ...(provider === 'browser-ml' ? { disableThinking: true } : {}),
  }

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    if (signal?.aborted) throw new Error('Aborted')
    const batch = uncached.slice(i, i + BATCH)
    const results: { url: string; tags: string[] }[] = []

    for (const item of batch) {
      try {
        const path = urlPathSnippet(item.url)
        const userMsg = tagItem.user({ title: item.title, domain: item.domain, path })
        const raw = await chatComplete(systemPrompt, userMsg, settings, 60, { ...options, signal })
        const parsed = tagItem.parseResponseDetailed(raw, format)
        if (useJsonOutput) trackTagParse(parsed.strict)
        const tags = parsed.tags
        if (tags.length > 0) {
          const existing = await getCached(prefix, item.url)
          await setCached(prefix, item.url, {
            category: existing?.category ?? 'Other',
            parentCategory: existing?.parentCategory,
            clusterId: existing?.clusterId,
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
  signal?: AbortSignal,
): Promise<void> {
  await tagItems(
    items,
    prefix,
    {
      ...DEFAULT_LLM_SETTINGS,
      tasks: {
        ...DEFAULT_LLM_SETTINGS.tasks,
        chat: { provider: 'gemini-nano' },
        embedding: { provider: 'browser-ml' },
      },
    },
    onProgress,
    signal,
  )
}

export async function tagWithLmStudio(
  items: { url: string; title: string; domain: string }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; tags: string[] }[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  await tagItems(items, prefix, settings, onProgress, signal)
}
