import { classifyItems } from '../ai/classifier'
import { legacy_groupRareCategories } from '../ai/category-post-processor-legacy'
import { refineCategoryLabels } from '../ai/post-processor'
import { chatComplete } from '../ai/llm'
import { clearAllAICache, getCached, getLlmSettings, setCached } from './storage'
import { getAll, type CacheEntry } from '../db/cacheDb'
import { kMeans, mergeSmallClusters, MIN_CLUSTER_SIZE } from '../ai/cluster'
import { loadEmbeddingsForCurrentModel } from '../ai/embedder'
import { normalizeUrlForCache } from './url-utils'
import type { LlmSettings } from './types'

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
    groupRare(): Promise<{ url: string; category: string }[]>
    chat(userMessage: string, systemPrompt?: string, maxTokens?: number): Promise<string>
    clusterTest(): Promise<any>
  }
  cache: {
    clear(): Promise<void>
    clearUrl(url: string): Promise<void>
    setCategory(url: string, category: string): Promise<void>
  }
}

function parseCacheRef(raw: string): string {
  const url = raw.replace(/^(tab|bm):/, '')
  return normalizeUrlForCache(url)
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
      return getCached(parseCacheRef(url))
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
        return refineCategoryLabels(labels.map(l => ({ label: l, count: 1 })), settings)
      },

      async classifyUrl(url: string, title: string) {
        const settings = await getLlmSettings()
        const domain = normalizeDomain(url)
        let result = 'Other'
        await classifyItems(
          [{ url, title, domain }],
          settings,
          (updates) => { result = updates[0]?.category ?? result },
        )
        return result
      },

      async groupRare() {
        const settings = await getLlmSettings()
        const all = await getAll()
        const items = [...all.entries()]
          .filter(([, entry]) => entry.category?.trim())
          .map(([key, entry]) => ({
            url: key,
            category: entry.category.trim(),
          }))
        return legacy_groupRareCategories(items, settings)
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
        console.info('[tablab] chat <-', raw)
        return raw
      },

      async clusterTest() {
        const [allCache, allEmbeddings] = await Promise.all([
          getAll(),
          loadEmbeddingsForCurrentModel(await getLlmSettings()),
        ])
        
        // Better fallback: if cache is empty, use all URLs that have embeddings
        let items: { url: string; title: string; embedding: number[] }[] = []
        
        if (allCache.size > 0) {
          items = [...allCache.entries()]
            .map(([key, entry]) => {
              const url = key
              const embedding = allEmbeddings.get(url)
              return { url, title: entry.category || normalizeDomain(url) || 'Unknown', embedding }
            })
            .filter((item): item is { url: string; title: string; embedding: number[] } => !!item.embedding)
        } 
        
        if (items.length === 0) {
          // Absolute fallback: just use what we have in embeddings
          console.info('[tablab] cache empty or no matches, using raw embeddings')
          items = [...allEmbeddings.entries()].map(([url, vector]) => ({
            url,
            title: normalizeDomain(url) || url,
            embedding: vector
          }))
        }

        if (items.length === 0) {
          console.warn('[tablab] no items with embeddings found', { cacheSize: allCache.size, embeddingSize: allEmbeddings.size })
          return `No items with embeddings found (Cache: ${allCache.size}, Embeddings: ${allEmbeddings.size})`
        }

        const k = Math.max(3, Math.min(150, Math.max(Math.ceil(items.length / 8), 3)))
        const raw = kMeans(items, k)
        const merged = mergeSmallClusters(raw, items, MIN_CLUSTER_SIZE)

        console.info('[tablab] Cluster Test Result:', {
          totalItems: items.length,
          rawCount: raw.length,
          mergedCount: merged.length,
          savings: raw.length - merged.length,
          rawSizes: raw.map(c => c.members.length),
          mergedSizes: merged.map(c => c.members.length)
        })

        return {
          totalItems: items.length,
          rawCount: raw.length,
          mergedCount: merged.length,
          mergedSizes: merged.map(c => c.members.length)
        }
      },
    },

    cache: {
      async clear() {
        await clearAllAICache()
        console.info('[tablab] AI cache cleared')
      },

      async clearUrl(url: string) {
        const normalizedUrl = parseCacheRef(url)
        const existing = await getCached(normalizedUrl)
        if (!existing) {
          console.warn('[tablab] no cache entry for', normalizedUrl)
          return
        }
        await setCached(normalizedUrl, {
          ...existing,
          category: '',
          parentCategory: undefined,
          clusterId: undefined,
          tags: undefined,
          embedding: undefined,
          intent: undefined,
          processedAt: Date.now(),
        })
        console.info('[tablab] cleared cache for', normalizedUrl)
      },

      async setCategory(url: string, category: string) {
        const normalizedUrl = parseCacheRef(url)
        const existing = await getCached(normalizedUrl)
        const normalizedCategory = category.trim() || 'Other'
        await setCached(normalizedUrl, {
          category: normalizedCategory,
          parentCategory: existing?.parentCategory ?? normalizedCategory,
          clusterId: existing?.clusterId,
          tags: existing?.tags,
          embedding: existing?.embedding,
          intent: existing?.intent,
          processedAt: Date.now(),
        })
        console.info('[tablab] set category', { url: normalizedUrl, category: normalizedCategory })
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
