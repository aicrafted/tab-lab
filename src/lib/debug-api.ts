import { classifyItems, groupRareCategories, normalizeCategoryLabels } from './classifier'
import { chatComplete } from './llm'
import { clearAllAICache, getCached, getLlmSettings, setCached } from './storage'
import { getAll, type CacheEntry } from './cacheDb'
import type { LlmSettings } from './types'

type CachePrefix = 'tab' | 'bm'

export interface TablabDebugApi {
  getCategories(): Promise<{ category: string; count: number }[]>
  getTags(): Promise<{ tag: string; count: number }[]>
  getIntents(): Promise<{ intent: string; count: number }[]>
  getCache(url: string): Promise<CacheEntry | null>
  dumpCache(): Promise<Record<string, CacheEntry>>
  getSettings(): Promise<LlmSettings>
  ai: {
    normalizeCategories(labels: string[]): Promise<Record<string, string>>
    classifyUrl(url: string, title: string): Promise<string>
    groupRare(prefix?: CachePrefix): Promise<{ url: string; category: string }[]>
    chat(userMessage: string, systemPrompt?: string, maxTokens?: number): Promise<string>
  }
  cache: {
    clear(): Promise<void>
    clearUrl(url: string): Promise<void>
    setCategory(url: string, category: string): Promise<void>
  }
}

function parseCacheRef(raw: string): { prefix: CachePrefix; url: string } {
  if (raw.startsWith('bm:')) return { prefix: 'bm', url: raw.slice(3) }
  if (raw.startsWith('tab:')) return { prefix: 'tab', url: raw.slice(4) }
  return { prefix: 'tab', url: raw }
}

function normalizeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

async function countBy<T extends string>(extract: (entry: CacheEntry) => T[]): Promise<{ value: T; count: number }[]> {
  const all = await getAll()
  const counts = new Map<T, number>()
  for (const entry of all.values()) {
    for (const value of extract(entry)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
}

function createDebugApi(): TablabDebugApi {
  return {
    async getCategories() {
      const counted = await countBy((entry) => {
        const category = entry.category?.trim()
        return category ? [category] : []
      })
      return counted.map(({ value, count }) => ({ category: value, count }))
    },

    async getTags() {
      const counted = await countBy((entry) => (entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean))
      return counted.map(({ value, count }) => ({ tag: value, count }))
    },

    async getIntents() {
      const counted = await countBy((entry) => {
        const raw = entry.intent
        if (typeof raw === 'string' && raw.trim()) return [raw.trim()]
        if (raw && typeof raw === 'object' && 'type' in raw) {
          const type = (raw as { type?: unknown }).type
          if (typeof type === 'string' && type.trim()) return [type.trim()]
        }
        return []
      })
      return counted.map(({ value, count }) => ({ intent: value, count }))
    },

    async getCache(url: string) {
      const { prefix, url: normalizedUrl } = parseCacheRef(url)
      return getCached(prefix, normalizedUrl)
    },

    /** May return a large object for big caches. */
    async dumpCache() {
      const all = await getAll()
      return Object.fromEntries(all.entries())
    },

    async getSettings() {
      return getLlmSettings()
    },

    ai: {
      async normalizeCategories(labels: string[]) {
        const settings = await getLlmSettings()
        return normalizeCategoryLabels(labels, settings)
      },

      async classifyUrl(url: string, title: string) {
        const settings = await getLlmSettings()
        const domain = normalizeDomain(url)
        let result = 'Other'
        await classifyItems(
          [{ url, title, domain }],
          'tab',
          settings,
          (updates) => { result = updates[0]?.category ?? result },
        )
        return result
      },

      async groupRare(prefix: CachePrefix = 'tab') {
        const settings = await getLlmSettings()
        const all = await getAll()
        const items = [...all.entries()]
          .filter(([key, entry]) => key.startsWith(`${prefix}:`) && entry.category?.trim())
          .map(([key, entry]) => ({
            url: key.slice(prefix.length + 1),
            category: entry.category.trim(),
          }))
        return groupRareCategories(items, prefix, settings)
      },

      async chat(
        userMessage: string,
        systemPrompt = 'You are a helpful assistant.',
        maxTokens = 200,
      ) {
        const settings = await getLlmSettings()
        const provider = settings.tasks.chat.provider
        const model = provider === 'gemini-nano' ? 'gemini-nano' : settings.providers[provider === 'browser-ml' ? 'browserMl' : provider as 'lmstudio' | 'openrouter']?.chatModel
        console.info('[tablab] chat ->', { provider, model, userMessage })
        const raw = await chatComplete(systemPrompt, userMessage, settings, maxTokens)
        console.info('[tablab] chat <-', raw)
        return raw
      },
    },

    cache: {
      async clear() {
        await clearAllAICache()
        console.info('[tablab] AI cache cleared')
      },

      async clearUrl(url: string) {
        const { prefix, url: normalizedUrl } = parseCacheRef(url)
        const existing = await getCached(prefix, normalizedUrl)
        if (!existing) {
          console.warn('[tablab] no cache entry for', `${prefix}:${normalizedUrl}`)
          return
        }
        await setCached(prefix, normalizedUrl, {
          ...existing,
          category: '',
          parentCategory: undefined,
          clusterId: undefined,
          tags: undefined,
          embedding: undefined,
          intent: undefined,
          processedAt: Date.now(),
        })
        console.info('[tablab] cleared cache for', `${prefix}:${normalizedUrl}`)
      },

      async setCategory(url: string, category: string) {
        const { prefix, url: normalizedUrl } = parseCacheRef(url)
        const existing = await getCached(prefix, normalizedUrl)
        const normalizedCategory = category.trim() || 'Other'
        await setCached(prefix, normalizedUrl, {
          category: normalizedCategory,
          parentCategory: existing?.parentCategory ?? normalizedCategory,
          clusterId: existing?.clusterId,
          tags: existing?.tags,
          embedding: existing?.embedding,
          intent: existing?.intent,
          processedAt: Date.now(),
        })
        console.info('[tablab] set category', { url: `${prefix}:${normalizedUrl}`, category: normalizedCategory })
      },
    },
  }
}

export function registerDebugApi(): void {
  if (typeof window === 'undefined') return
  const api = createDebugApi()
  Object.defineProperty(window, 'tablab', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: api,
  })
  console.info('[tablab] debug API available — window.tablab')
}

declare global {
  interface Window {
    tablab?: TablabDebugApi
  }
}
