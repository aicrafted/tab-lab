import { chatComplete, extractJson } from './llm'
import { getCached, setCached } from './storage'
import type { LlmSettings } from './types'
import { DEFAULT_LLM_SETTINGS } from './types'

const TAG_SYSTEM_PROMPT = `You are a web page tagger. For each browser tab title and domain, reply with exactly 3-5 lowercase tags separated by commas. Tags must be concise (1-2 words), specific, and useful for filtering a personal collection. Avoid generic tags like "website" or "internet". Reply with tags only — no explanation, no extra punctuation.`
const TAG_SYSTEM_PROMPT_JSON = `You are a web page tagger. Output a JSON object with a "tags" key containing an array of 3-5 lowercase tags. Tags must be concise (1-2 words), specific, and useful for filtering a personal collection. Avoid generic tags like "website" or "internet".

Example output: {"tags": ["rust", "async", "performance"]}`

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
      return (parsed.tags as unknown[])
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, ''))
        .filter((tag) => tag.length > 1 && tag.length < 30)
        .slice(0, 5)
    }
  } catch {
  }
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

  const isWebLLM = settings.tasks.chat.provider === 'webllm'
  const systemPrompt = isWebLLM ? TAG_SYSTEM_PROMPT_JSON : TAG_SYSTEM_PROMPT
  const options = isWebLLM ? { responseFormat: 'json' as const, disableThinking: true } : {}

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (item) => {
        const raw = await chatComplete(
          systemPrompt,
          `Title: ${item.title}\nDomain: ${item.domain}`,
          settings,
          60,
          options,
        )
        const tags = isWebLLM ? parseTagsJson(raw) : parseTags(raw)
        const existing = await getCached(prefix, item.url)
        await setCached(prefix, item.url, {
          category: existing?.category ?? 'Other',
          processedAt: Date.now(),
          tags,
          intent: existing?.intent,
        })
        return { url: item.url, tags }
      }),
    )
    onProgress(results)
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
