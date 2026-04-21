import { kMeans, type ClusterResult } from './cluster'
import { chatComplete } from './llm'
import { getEmbeddingProvider } from './providers/factory'
import { getCached, setCached } from '../core/storage'
import {
  classifyCluster,
  analyzeMetadata,
  classifyCategory,
  classifyItem,
  type PageIntent,
  type KnownPlatform,
} from './prompts'
import type { LlmSettings } from '../core/types'
import { aiPipelineLog } from '../core/logger'
import { createLoggerProgress } from '../core/progress'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { classifyVectorNli } from './nli-engine'
export {
  checkLlmAvailability,
  resolveAiSetupState as checkAiStartupState,
} from './setup'
export type {
  LlmAvailability,
  LlmStatus,
  AiSetupState,
} from './setup'

const classifierParseMetrics = {
  strict: 0,
  fallback: 0,
}

function trackClassifierParse(strict: boolean): void {
  if (strict) classifierParseMetrics.strict += 1
  else classifierParseMetrics.fallback += 1
  const total = classifierParseMetrics.strict + classifierParseMetrics.fallback
  if (total > 0 && total % 25 === 0) {
    aiPipelineLog.info('parse metrics', {
      strict: classifierParseMetrics.strict,
      fallback: classifierParseMetrics.fallback,
    })
  }
}

const CATEGORY_RESPONSE_SCHEMA = {
  name: 'category_response',
  schema: {
    type: 'object',
    properties: {
      category: { type: 'string' },
    },
    required: ['category'],
    additionalProperties: false,
  },
  strict: false,
} as const

const CLUSTER_RESPONSE_SCHEMA = {
  name: 'cluster_response',
  schema: {
    type: 'object',
    properties: {
      category: { type: 'string' },
      name: { type: 'string' },
    },
    required: ['category', 'name'],
    additionalProperties: false,
  },
  strict: false,
} as const

export const SPLIT_THRESHOLD = 15

export function urlPathSnippet(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    return path.slice(0, 80)
  } catch {
    return ''
  }
}

export function domainSiteLine(domain: string, domainMap: Map<string, DomainInfo> | undefined, localNetworks: string[]): string {
  if (!domainMap) return ''
  const info = getDomainInfo(domain, domainMap, localNetworks)
  if (!info?.known) return ''
  if (info.description && info.category) return `\nSite: ${info.description} (${info.category})`
  if (info.description) return `\nSite: ${info.description}`
  if (info.category) return `\nSite: ${info.category}`
  return ''
}

export async function fetchLmStudioModels(settings: LlmSettings): Promise<string[]> {
  const { baseUrl, apiKey } = settings.providers.lmstudio
  if (!baseUrl) return []
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data: { id: string }[] }
    return json.data.map((model) => model.id).sort()
  } catch {
    return []
  }
}

type ClassifiedItem = { url: string; title: string; domain: string }
type ClusterInputItem = ClassifiedItem & { embedding: number[] }

export async function classifyItems(
  items: ClassifiedItem[],
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  signal?: AbortSignal,
): Promise<void> {
  const uncached: ClassifiedItem[] = []
  const cached: { url: string; category: string }[] = []

  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(item.url)
      const cachedCategory = entry?.category?.trim()
      if (cachedCategory && !classifyItem.isInvalidResponse(cachedCategory)) {
        cached.push({ url: item.url, category: cachedCategory })
      } else {
        uncached.push(item)
      }
    }),
  )

  if (cached.length > 0) onProgress(cached)
  if (uncached.length === 0) return

  const chatProviderId = settings.tasks.chat.provider
  const embedProviderId = settings.tasks.embedding.provider
  const embedProvider = getEmbeddingProvider(embedProviderId)
  const useNli = settings.tasks.classification.method === 'nli' && !!embedProvider.getEmbeddingModel(settings)
  
  const tracker = createLoggerProgress('classifyItems', uncached.length, { provider: useNli ? 'nli' : chatProviderId })
  
  const format = 'json' as const
  const systemPrompt = classifyItem.system(format)
  const options = {
    responseFormat: 'json' as const,
    metricKey: 'classifier-items',
    jsonSchema: CATEGORY_RESPONSE_SCHEMA,
    ...(chatProviderId === 'browser-ml' ? { disableThinking: true } : {}),
  }

  const seenCategories = new Set<string>()
  // Seed with categories we already know from cache
  cached.forEach(c => seenCategories.add(c.category))

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    if (signal?.aborted) throw new Error('Aborted')
    const batch = uncached.slice(i, i + BATCH)
    const results: { url: string; category: string; parentCategory: string }[] = []

    // Provide some existing categories as hints, but limited to avoid prompt bloat
    const hints = Array.from(seenCategories).slice(0, 30)

    await Promise.all(batch.map(async (item) => {
      try {
        let category = 'Other'
        if (useNli) {
          const path = urlPathSnippet(item.url)
          const domainDesc = domainMap ? getDomainInfo(item.domain, domainMap, settings.localNetworks)?.description : undefined
          const text = [domainDesc, item.title, item.domain, path].filter(Boolean).join(' ')
          const queryEmbedding = await embedProvider.embed(text, settings, signal)
          const result = await classifyVectorNli(queryEmbedding, settings)
          category = result?.label || 'Other'
        } else {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)

          const userMsg = classifyItem.user({ 
            title: item.title, 
            domain: item.domain, 
            path, 
            siteLine,
            candidates: hints
          })
          const raw = await chatComplete(systemPrompt, userMsg, settings, 256, { ...options, signal })
          const parsed = classifyItem.parseResponseDetailed(raw)
          trackClassifierParse(parsed.strict)
          category = parsed.category
        }
        
        const finalCategory = category.trim()
        seenCategories.add(finalCategory) // Add to hints for next batch
        
        const existing = await getCached(item.url)
        const parentCategory = (existing?.parentCategory ?? finalCategory).trim()
        await setCached(item.url, { ...existing, category: finalCategory, parentCategory, processedAt: Date.now() })
        results.push({ url: item.url, category: finalCategory, parentCategory })
      } catch (err) {
        aiPipelineLog.error('classifyItems item failed', { url: item.url, err })
      } finally {
        tracker.progress(1)
      }
    }))
    if (results.length > 0) onProgress(results)
  }
  tracker.done()
}

/**
 * Unified classification, tagging and intent discovery in TWO requests.
 * Pass 1: tags + intent + platform
 * Pass 2: category (using tags as context)
 */
export async function analyzeItemsTwoPass(
  items: { url: string; title: string; domain: string }[],
  settings: LlmSettings,
  onProgress: (updates: {
    url: string;
    category: string;
    parentCategory: string;
    tags: string[];
    intent: PageIntent | undefined;
    platform: KnownPlatform | null;
  }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  signal?: AbortSignal,
): Promise<void> {
  const uncached = items 
  if (uncached.length === 0) return

  const tracker = createLoggerProgress('analyzeItemsTwoPass', uncached.length)
  const chatProviderId = settings.tasks.chat.provider
  
  const options = {
    responseFormat: 'json' as const,
    ...(chatProviderId === 'browser-ml' ? { disableThinking: true } : {}),
  }

  const seenCategories = new Set<string>()
  // Load initial hints from items provided (skip invalid/Other)
  await Promise.all(items.map(async (item) => {
    const entry = await getCached(item.url)
    if (entry?.category && !classifyItem.isInvalidResponse(entry.category)) seenCategories.add(entry.category)
  }))

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    if (signal?.aborted) throw new Error('Aborted')
    const batch = uncached.slice(i, i + BATCH)
    const results: { url: string; category: string; parentCategory: string; tags: string[]; intent: PageIntent | undefined; platform: KnownPlatform | null }[] = []

    const hints = Array.from(seenCategories)
      .filter(c => !classifyItem.isInvalidResponse(c))
      .slice(0, 30)

    await Promise.all(batch.map(async (item) => {
      try {
        const path = urlPathSnippet(item.url)
        const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)

        const domainInfo = domainMap ? getDomainInfo(item.domain, domainMap, settings.localNetworks) : null
        const platform = domainInfo?.platform ?? null

        // Pass 1: Metadata Extraction
        const metaUserMsg = analyzeMetadata.user({ title: item.title, domain: item.domain, path, siteLine })
        const metaRaw = await chatComplete(analyzeMetadata.system(), metaUserMsg, settings, 512, { ...options, signal, metricKey: 'classifier-meta' })
        const meta = analyzeMetadata.parseResponse(metaRaw)
        
        // Pass 2: Category Classification
        const catUserMsg = classifyCategory.user({ 
          title: item.title, 
          domain: item.domain, 
          path, 
          siteLine,
          candidates: hints,
          tags: meta.tags
        })
        const catRaw = await chatComplete(classifyCategory.system(), catUserMsg, settings, 256, { ...options, signal, metricKey: 'classifier-category' })
        const { category } = classifyCategory.parseResponse(catRaw)
        
        seenCategories.add(category)
        
        const existing = await getCached(item.url)
        const finalParent = (existing?.parentCategory ?? category).trim()
        
        await setCached(item.url, { 
          ...existing, 
          category: category, 
          parentCategory: finalParent,
          tags: meta.tags,
          intent: meta.intent,
          platform: platform ?? undefined,
          processedAt: Date.now() 
        })
        results.push({ 
          url: item.url, 
          category: category, 
          parentCategory: finalParent,
          tags: meta.tags, 
          intent: meta.intent, 
          platform: platform 
        })
      } catch (err) {
        aiPipelineLog.error('analyzeItemsTwoPass item failed', { url: item.url, err })
      } finally {
        tracker.progress(1)
      }
    }))
    if (results.length > 0) onProgress(results)
  }
  tracker.done()
}

/** Load cached categories for a set of items. Returns url → category map. */
export async function loadCachedCategories(items: { url: string }[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.all(items.map(async (item) => {
    const entry = await getCached(item.url)
    const cat = entry?.category?.trim()
    if (cat && !classifyItem.isInvalidResponse(cat)) map.set(item.url, cat)
  }))
  return map
}

/** Load cached category hierarchy for a set of items. Returns url → { category, parentCategory }. */
export async function loadCachedCategoryData(
  items: { url: string }[],
): Promise<Map<string, { category: string; parentCategory?: string }>> {
  const map = new Map<string, { category: string; parentCategory?: string }>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(item.url)
      const cachedCategory = entry?.category?.trim()
      if (!cachedCategory || classifyItem.isInvalidResponse(cachedCategory)) return
      const parentCategory = entry?.parentCategory?.trim()
      map.set(item.url, {
        category: cachedCategory,
        ...(parentCategory ? { parentCategory } : {}),
      })
    }),
  )
  return map
}

/** Load cached tags for a set of items. Returns url → tags map. */
export async function loadCachedTags(
  items: { url: string }[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(item.url)
      if (entry?.tags?.length) map.set(item.url, entry.tags)
    }),
  )
  return map
}

/** Load cached intents for a set of items. Returns url → intent map. */
export async function loadCachedIntents(
  items: { url: string }[],
): Promise<Map<string, import('../core/types').PageIntent>> {
  const map = new Map<string, import('../core/types').PageIntent>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(item.url)
      if (entry?.intent) map.set(item.url, entry.intent)
    }),
  )
  return map
}

export async function splitLargeClusters(
  items: { url: string; title: string; domain: string; category: string }[],
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  embeddings?: Map<string, number[]>,
  signal?: AbortSignal,
): Promise<void> {
  const groups = new Map<string, { url: string; title: string; domain: string }[]>()
  for (const item of items) {
    if (!item.category) continue
    const bucket = groups.get(item.category) ?? []
    bucket.push(item)
    groups.set(item.category, bucket)
  }
  
  const totalWork = [...groups.values()]
    .filter((members) => members.length > SPLIT_THRESHOLD)
    .reduce((sum, members) => sum + members.length, 0)
  const tracker = createLoggerProgress('splitLargeClusters', Math.max(totalWork, 1))

  for (const [parentCategory, members] of groups) {
    if (signal?.aborted) throw new Error('Aborted')
    if (members.length <= SPLIT_THRESHOLD) continue

    const membersWithEmbeddings = embeddings
      ? members
          .map((member) => ({ ...member, embedding: embeddings.get(member.url) }))
          .filter((member): member is { url: string; title: string; domain: string; embedding: number[] } => Boolean(member.embedding))
      : []

    if (membersWithEmbeddings.length >= 3) {
      const subClusters = kMeans(membersWithEmbeddings.map((m) => ({ url: m.url, embedding: m.embedding })), Math.max(2, Math.min(8, Math.ceil(members.length / 5))))
      await classifyByClusters(membersWithEmbeddings, subClusters, settings, (updates) => {
        onProgress(updates.map((u) => ({ url: u.url, category: u.category })))
      }, domainMap, signal, parentCategory)
      tracker.progress(members.length)
      continue
    }

    const format = settings.tasks.chat.provider === 'gemini-nano' ? 'text' : 'json'
    const systemPrompt = classifyItem.system(format)
    const options = format === 'json' ? { responseFormat: 'json' as const, metricKey: 'classifier-split', jsonSchema: CATEGORY_RESPONSE_SCHEMA } : {}
    
    for (const item of members) {
      try {
        const path = urlPathSnippet(item.url)
        const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)
        const raw = await chatComplete(systemPrompt, classifyItem.user({ title: item.title, domain: item.domain, path, siteLine, parentCategory }), settings, 40, { ...options, signal })
        const category = classifyItem.parseResponse(raw, parentCategory)
        const existing = await getCached(item.url)
        await setCached(item.url, { ...existing, category, parentCategory, processedAt: Date.now() })
        onProgress([{ url: item.url, category }])
      } catch (err) {
        aiPipelineLog.error('splitLargeClusters item failed', { url: item.url, err })
      } finally {
        tracker.progress(1)
      }
    }
  }
  tracker.done()
}

function inferClusterNameFromRepresentative(title: string, category: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim()
  if (!normalized) return category
  return normalized.split(' ').slice(0, 5).join(' ').slice(0, 60)
}

export async function classifyByClusters(
  items: ClusterInputItem[],
  clusters: ClusterResult[],
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string; parentCategory?: string; clusterId: number }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  signal?: AbortSignal,
  parentCategory?: string,
): Promise<Map<number, string>> {
  const totalMembers = clusters.reduce((sum, cluster) => sum + cluster.members.length, 0)
  const tracker = createLoggerProgress('classifyByClusters', totalMembers)
  const byUrl = new Map(items.map((item) => [item.url, item]))
  const names = new Map<number, string>()
  const embedProvider = getEmbeddingProvider(settings.tasks.embedding.provider)
  const useNli = settings.tasks.classification.method === 'nli' && !!embedProvider.getEmbeddingModel(settings)

  for (const cluster of clusters) {
    if (signal?.aborted) throw new Error('Aborted')
    const representativeItems = cluster.representatives.map((url) => byUrl.get(url)).filter((item): item is ClusterInputItem => !!item)
    if (representativeItems.length === 0 || cluster.members.length === 0) continue

    let category = 'Other'
    let name = 'Other'

    if (useNli) {
      const result = await classifyVectorNli(cluster.centroid, settings)
      if (result) {
        category = result.label
        name = inferClusterNameFromRepresentative(representativeItems[0].title, category)
      }
    } else {
      const raw = await chatComplete(
        classifyCluster.system(),
        classifyCluster.user(representativeItems.map((item) => {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)
          return classifyItem.user({ title: item.title, domain: item.domain, path, siteLine, parentCategory })
        })),
        settings,
        200,
        { responseFormat: 'json', metricKey: 'classifier-clusters', jsonSchema: CLUSTER_RESPONSE_SCHEMA, signal }
      )
      const parsed = classifyCluster.parseResponse(raw)
      category = parsed.category || 'Other'
      name = parsed.name || category
    }

    names.set(cluster.clusterId, name)
    const updates: { url: string; category: string; parentCategory?: string; clusterId: number }[] = []
    for (const url of cluster.members) {
      const existing = await getCached(url)
      const finalParent = parentCategory || category
      await setCached(url, { ...existing, category, parentCategory: finalParent, clusterId: cluster.clusterId, processedAt: Date.now() })
      updates.push({ url, category, parentCategory: finalParent, clusterId: cluster.clusterId })
    }
    if (updates.length > 0) onProgress(updates)
    tracker.progress(cluster.members.length)
  }
  tracker.done()
  return names
}
