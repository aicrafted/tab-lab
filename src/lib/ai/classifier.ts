import { kMeans, type ClusterResult } from './cluster'
import { chatComplete } from './llm'
import { getChatProvider, getEmbeddingProvider } from './providers/factory'
import { getCached, setCached } from '../core/storage'
import { classifyCluster, classifyItem, groupRareCategories as groupRareCategoriesContract, normalizeCategories } from './prompts'
import type { LlmSettings } from '../core/types'
import { classifierLog } from '../core/logger'
import { createLoggerProgress } from '../core/progress'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { cosineSimilarity } from './embedder'
import { classifyVectorNli } from './nli-engine'

const classifierParseMetrics = {
  strict: 0,
  fallback: 0,
}

function trackClassifierParse(strict: boolean): void {
  if (strict) classifierParseMetrics.strict += 1
  else classifierParseMetrics.fallback += 1
  const total = classifierParseMetrics.strict + classifierParseMetrics.fallback
  if (total > 0 && total % 25 === 0) {
    classifierLog.info('parse metrics', {
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
const CATEGORY_MERGE_MAP_SCHEMA = {
  name: 'category_merge_map',
  schema: {
    type: 'object',
    additionalProperties: { type: 'string' },
  },
  strict: false,
} as const

export type LlmAvailability = 'checking' | 'ready' | 'after-download' | 'unavailable'
export type LlmStatus = LlmAvailability
export const SPLIT_THRESHOLD = 15
const RARE_THRESHOLD = 3


function urlPathSnippet(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    return path.slice(0, 80)
  } catch (err) {
    classifierLog.debug('failed to parse url path snippet', {
      url,
      err: err instanceof Error ? err.message : String(err),
    })
    return ''
  }
}

async function getTopCandidates(
  itemEmbedding: number[],
  taxonomyCentroids: Map<string, number[]>,
  topK = 5,
): Promise<string[]> {
  const scores: { label: string; score: number }[] = []
  for (const [label, centroid] of taxonomyCentroids.entries()) {
    scores.push({ label, score: cosineSimilarity(itemEmbedding, centroid) })
  }
  scores.sort((a, b) => b.score - a.score)
  return scores.slice(0, topK).map((s) => s.label)
}

function domainSiteLine(domain: string, domainMap: Map<string, DomainInfo> | undefined, localNetworks: string[]): string {
  if (!domainMap) return ''
  const info = getDomainInfo(domain, domainMap, localNetworks)
  if (!info?.known) return ''
  if (info.description && info.category) return `\nSite: ${info.description} (${info.category})`
  if (info.description) return `\nSite: ${info.description}`
  if (info.category) return `\nSite: ${info.category}`
  return ''
}


export async function checkLlmAvailability(settings?: LlmSettings): Promise<LlmAvailability> {
  if (!settings) return 'unavailable'
  const providerId = settings.tasks.chat.provider
  try {
    const provider = getChatProvider(providerId)
    const status = await provider.checkStatus(settings)
    
    if (status.status === 'ready') return 'ready'
    if (status.status === 'loading') return 'after-download'
    return 'unavailable'
  } catch (err) {
    classifierLog.warn('failed to check LLM availability via provider', {
      provider: providerId,
      err: err instanceof Error ? err.message : String(err),
    })
    return 'unavailable'
  }
}

export async function fetchLmStudioModels(settings: LlmSettings): Promise<string[]> {
  const { baseUrl, apiKey } = settings.providers.lmstudio
  if (!baseUrl) return []
  const res = await fetch(`${baseUrl}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return []
  const json = (await res.json()) as { data: { id: string }[] }
  return json.data.map((model) => model.id).sort()
}

type ClassifiedItem = { url: string; title: string; domain: string }
type ClusterInputItem = ClassifiedItem & { embedding: number[] }

export async function classifyItems(
  items: ClassifiedItem[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  signal?: AbortSignal,
  taxonomyCentroids?: Map<string, number[]>,
  candidates?: string[],
): Promise<void> {
  const uncached: ClassifiedItem[] = []
  const cached: { url: string; category: string }[] = []

  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
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

  // Ensure the required provider is ready
  const activeProviderId = useNli ? embedProviderId : chatProviderId
  const activeProvider = getChatProvider(activeProviderId as any)
  
  let ready = false
  let attempts = 0
  const maxAttempts = 10
  
  while (!ready && attempts < maxAttempts) {
    const status = await activeProvider.checkStatus(settings, { deep: true })
    if (status.status === 'ready') {
      ready = true
    } else if (status.status === 'loading') {
      classifierLog.info(`Provider ${activeProviderId} is loading, waiting...`, { 
        attempt: attempts + 1, 
        message: status.message 
      })
      await new Promise(resolve => setTimeout(resolve, 3000))
      attempts++
    } else {
      throw new Error(`Provider ${activeProviderId} unavailable: ${status.message || status.status}`)
    }
  }
  
  if (!ready) {
    throw new Error(`Provider ${activeProviderId} failed to become ready in time. Please check your local LLM server.`)
  }
  
  const tracker = createLoggerProgress('classifyItems', uncached.length, { provider: chatProviderId })
  const format = 'json' as const
  const useJsonOutput = true
  const systemPrompt = classifyItem.system(format)
  const options = {
    responseFormat: 'json' as const,
    metricKey: 'classifier-items',
    jsonSchema: CATEGORY_RESPONSE_SCHEMA,
    ...(chatProviderId === 'browser-ml' ? { disableThinking: true } : {}),
  }

  const BATCH = 5
  let failed = 0
  for (let i = 0; i < uncached.length; i += BATCH) {
    if (signal?.aborted) throw new Error('Aborted')
    const batch = uncached.slice(i, i + BATCH)
    const results: { url: string; category: string }[] = []

    for (const item of batch) {
      try {
        let category = 'Other'
        if (useNli) {
          const path = urlPathSnippet(item.url)
          const domainDesc = domainMap ? getDomainInfo(item.domain, domainMap, settings.localNetworks)?.description : undefined
          const text = [domainDesc, item.title, item.domain, path].filter(Boolean).join(' ')
          const queryEmbedding = await embedProvider.embed(text, settings, signal)
          const result = await classifyVectorNli(queryEmbedding, settings)
          if (!result) {
            tracker.progress(1, { url: item.url, skipped: 'low-confidence' })
            continue
          }
          category = result.label
        } else {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)

          let itemCandidates = candidates
          if (taxonomyCentroids && taxonomyCentroids.size > 0 && !!embedProvider.getEmbeddingModel(settings)) {
            try {
              const domainDesc = domainMap ? getDomainInfo(item.domain, domainMap, settings.localNetworks)?.description : undefined
              const text = [domainDesc, item.title, item.domain, path].filter(Boolean).join(' ')
              const queryEmbedding = await embedProvider.embed(text, settings, signal)
              itemCandidates = await getTopCandidates(queryEmbedding, taxonomyCentroids)
            } catch (err) {
              classifierLog.warn('failed to get top candidates via embeddings, falling back to free-form or global list', {
                url: item.url,
                err: err instanceof Error ? err.message : String(err)
              })
            }
          }

          const userMsg = classifyItem.user({ 
            title: item.title, 
            domain: item.domain, 
            path, 
            siteLine,
            candidates: itemCandidates
          })
          const raw = await chatComplete(systemPrompt, userMsg, settings, 40, { ...options, signal })
          if (useJsonOutput) {
            const parsed = classifyItem.parseResponseDetailed(raw)
            trackClassifierParse(parsed.strict)
            category = parsed.category
          } else {
            category = classifyItem.parseResponse(raw)
          }
        }
        const existing = await getCached(prefix, item.url)
        await setCached(prefix, item.url, {
          ...existing,
          category,
          parentCategory: existing?.parentCategory ?? category,
          processedAt: Date.now(),
        })
        results.push({ url: item.url, category })
      } catch (err) {
        failed += 1
        classifierLog.error('classifyItems item failed', {
          url: item.url,
          domain: item.domain,
          err: err instanceof Error ? err.message : String(err),
        })
      } finally {
        tracker.progress(1)
      }
    }
    if (results.length > 0) onProgress(results)
  }
  tracker.done({ failed })
}

/** Load cached categories for a set of items. Returns url → category map. */
export async function loadCachedCategories(
  items: { url: string }[],
  prefix: 'tab' | 'bm',
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      const cachedCategory = entry?.category?.trim()
      if (cachedCategory && !classifyItem.isInvalidResponse(cachedCategory)) {
        map.set(item.url, cachedCategory)
      }
    }),
  )
  return map
}

/** Load cached category hierarchy for a set of items. Returns url → { category, parentCategory }. */
export async function loadCachedCategoryData(
  items: { url: string }[],
  prefix: 'tab' | 'bm',
): Promise<Map<string, { category: string; parentCategory?: string }>> {
  const map = new Map<string, { category: string; parentCategory?: string }>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
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
  prefix: 'tab' | 'bm',
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      if (entry?.tags?.length) map.set(item.url, entry.tags)
    }),
  )
  return map
}

/** Load cached intents for a set of items. Returns url → intent map. */
export async function loadCachedIntents(
  items: { url: string }[],
  prefix: 'tab' | 'bm',
): Promise<Map<string, import('../core/types').PageIntent>> {
  const map = new Map<string, import('../core/types').PageIntent>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      if (entry?.intent) map.set(item.url, entry.intent)
    }),
  )
  return map
}

/** Returns a mapping of raw category → canonical category name. */
export async function normalizeCategoryLabels(
  labels: string[],
  settings: LlmSettings,
): Promise<Record<string, string>> {
  if (labels.length <= 1) return Object.fromEntries(labels.map((label) => [label, label]))
  const tracker = createLoggerProgress('normalizeCategoryLabels', labels.length)

  const prompt = normalizeCategories.user(labels)

  const maxTokens = Math.min(4000, labels.length * 50 + 300)
  const raw = await chatComplete(
    normalizeCategories.system(),
    prompt,
    settings,
    maxTokens,
    settings.tasks.chat.provider !== 'gemini-nano'
      ? {
        responseFormat: 'json',
        metricKey: 'classifier-normalize',
        jsonSchema: CATEGORY_MERGE_MAP_SCHEMA,
        ...(settings.tasks.chat.provider === 'browser-ml' ? { disableThinking: true } : {}),
      }
      : {},
  )

  try {
    const parsed = normalizeCategories.parseResponse(raw, labels)
    tracker.progress(labels.length)
    tracker.done()
    return parsed
  } catch (err) {
    tracker.progress(labels.length)
    classifierLog.warn('normalizeCategoryLabels JSON parse failed, keeping originals', {
      err: err instanceof Error ? err.message : String(err),
    })
    tracker.done({ fallback: true })
    return Object.fromEntries(labels.map((label) => [label, label]))
  }
}

export async function groupRareCategories(
  items: { url: string; category: string }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  maxPasses = 3,
): Promise<{ url: string; category: string }[]> {
  let current = items
    .map((item) => ({ url: item.url, category: item.category.trim() }))
    .filter((item) => item.category.length > 0)
  if (current.length === 0) return []
  const tracker = createLoggerProgress('groupRareCategories', current.length * Math.max(1, maxPasses), { maxPasses })

  const allUpdates = new Map<string, string>() // url → final category

  for (let pass = 0; pass < maxPasses; pass++) {
    const counts = new Map<string, number>()
    for (const item of current) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
    }

    const frequent = [...counts.entries()]
      .filter(([, count]) => count >= RARE_THRESHOLD)
      .map(([category]) => category)
    const rare = [...counts.entries()]
      .filter(([, count]) => count < RARE_THRESHOLD)
      .map(([category]) => category)

    if (rare.length === 0) {
      classifierLog.info('groupRareCategories no rare categories; stopping', { pass })
      break
    }

    classifierLog.info('groupRareCategories pass', { pass: pass + 1, rare: rare.length, frequent: frequent.length })

    const prompt = groupRareCategoriesContract.user({
      frequent: frequent.map((label) => ({ label, count: counts.get(label) ?? 0 })),
      rare: rare.map((label) => ({ label, count: counts.get(label) ?? 0 })),
    })

    const provider = settings.tasks.chat.provider
    const maxTokens = Math.min(4000, rare.length * 50 + 300)
    const raw = await chatComplete(
      groupRareCategoriesContract.system(),
      prompt,
      settings,
      maxTokens,
      {
        responseFormat: 'json',
        metricKey: 'classifier-group-rare',
        jsonSchema: CATEGORY_MERGE_MAP_SCHEMA,
        ...(provider === 'browser-ml' ? { disableThinking: true } : {}),
      },
    )

    let mergeMap: Record<string, string> = {}
    try {
      mergeMap = groupRareCategoriesContract.parseResponse(raw)
    } catch (err) {
      classifierLog.warn('groupRareCategories parse failed; stopping', {
        pass: pass + 1,
        err: err instanceof Error ? err.message : String(err),
        raw: raw.slice(0, 120),
      })
      break
    }

    let changed = false
    current = current.map((item) => {
      tracker.progress(1)
      const targetRaw = mergeMap[item.category]
      const target = typeof targetRaw === 'string' ? targetRaw.trim().slice(0, 40) : ''
      if (!target || target === item.category) return item
      changed = true
      allUpdates.set(item.url, target)
      return { url: item.url, category: target }
    })

    if (!changed) {
      classifierLog.info('groupRareCategories no changes; stopping', { pass: pass + 1 })
      break
    }
  }

  if (allUpdates.size === 0) {
    tracker.done({ updates: 0 })
    return []
  }

  const updates = [...allUpdates.entries()].map(([url, category]) => ({ url, category }))

  await Promise.all(updates.map(async (update) => {
    const existing = await getCached(prefix, update.url)
    if (!existing) return
    await setCached(prefix, update.url, {
      ...existing,
      category: update.category,
      processedAt: Date.now(),
    })
  }))

  tracker.done({ updates: updates.length })
  return updates
}

/** Re-classifies items in categories that have too many members. */
export async function splitLargeClusters(
  items: { url: string; title: string; domain: string; category: string }[],
  prefix: 'tab' | 'bm',
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
  const tracker = createLoggerProgress('splitLargeClusters', Math.max(totalWork, 1), {
    groups: groups.size,
    totalItems: items.length,
  })

  for (const [parentCategory, members] of groups) {
    if (signal?.aborted) throw new Error('Aborted')
    if (members.length <= SPLIT_THRESHOLD) continue

    const membersWithEmbeddings = embeddings
      ? members
          .map((member) => ({ ...member, embedding: embeddings.get(member.url) }))
          .filter((member): member is { url: string; title: string; domain: string; embedding: number[] } => Boolean(member.embedding))
      : []

    if (membersWithEmbeddings.length >= 3) {
      const subK = Math.max(2, Math.min(8, Math.ceil(members.length / 5)))
      const subClusters = kMeans(
        membersWithEmbeddings.map((member) => ({ url: member.url, embedding: member.embedding })),
        subK,
      )
      await classifyByClusters(
        membersWithEmbeddings,
        subClusters,
        prefix,
        settings,
        (updates) => {
          onProgress(updates.map((update) => ({ url: update.url, category: update.category })))
        },
        domainMap,
        signal,
      )
      tracker.progress(members.length, { parentCategory, strategy: 'kmeans' })
      continue
    }

    const provider = settings.tasks.chat.provider
    const format = provider !== 'gemini-nano' ? 'json' : 'text'
    const useJsonOutput = format === 'json'
    const systemPrompt = classifyItem.system(format)
    const options = useJsonOutput
      ? {
        responseFormat: 'json' as const,
        metricKey: 'classifier-split',
        jsonSchema: CATEGORY_RESPONSE_SCHEMA,
        ...(provider === 'browser-ml' ? { disableThinking: true } : {}),
      }
      : {}
    const BATCH = 5
    for (let i = 0; i < members.length; i += BATCH) {
      if (signal?.aborted) throw new Error('Aborted')
      const batch = members.slice(i, i + BATCH)
      const updates: { url: string; category: string; parentCategory?: string }[] = []

      for (const item of batch) {
        try {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)
          const userMsg = classifyItem.user({
            title: item.title,
            domain: item.domain,
            path,
            siteLine,
            parentCategory,
          })
          const raw = await chatComplete(
            systemPrompt,
            userMsg,
            settings,
            40,
            { ...options, signal },
          )
          const category = useJsonOutput
            ? (classifyItem.parseResponse(raw, parentCategory) || parentCategory)
            : classifyItem.parseResponse(raw, parentCategory)
          const existing = await getCached(prefix, item.url)
          await setCached(prefix, item.url, {
            ...existing,
            category,
            parentCategory,
            processedAt: Date.now(),
          })
          updates.push({ url: item.url, category, parentCategory })
        } catch (err) {
          classifierLog.error('splitLargeClusters item failed', {
            url: item.url,
            domain: item.domain,
            parentCategory,
            err: err instanceof Error ? err.message : String(err),
          })
        } finally {
          tracker.progress(1, { parentCategory, strategy: 'batch-llm' })
        }
      }
      if (updates.length > 0) onProgress(updates)
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
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string; parentCategory?: string; clusterId: number }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  signal?: AbortSignal,
  parentCategory?: string, // NEW
): Promise<Map<number, string>> {
  const totalMembers = clusters.reduce((sum, cluster) => sum + cluster.members.length, 0)
  const tracker = createLoggerProgress('classifyByClusters', totalMembers, { clusters: clusters.length, parentCategory })
  const byUrl = new Map(items.map((item) => [item.url, item]))
  const names = new Map<number, string>()
  const embedProviderId = settings.tasks.embedding.provider
  const embedProvider = getEmbeddingProvider(embedProviderId)
  const useNli = settings.tasks.classification.method === 'nli' && !!embedProvider.getEmbeddingModel(settings)

  for (const cluster of clusters) {
    if (signal?.aborted) throw new Error('Aborted')
    const representativeItems = cluster.representatives
      .map((url) => byUrl.get(url))
      .filter((item): item is ClusterInputItem => Boolean(item))

    if (representativeItems.length === 0 || cluster.members.length === 0) {
      tracker.progress(cluster.members.length, { clusterId: cluster.clusterId, skipped: true })
      continue
    }

    let category = 'Other'
    let name = 'Other'

    if (useNli) {
      const result = await classifyVectorNli(cluster.centroid, settings)
      if (!result) {
        tracker.progress(cluster.members.length, { clusterId: cluster.clusterId, skipped: 'low-confidence' })
        continue
      }
      category = result.label
      name = inferClusterNameFromRepresentative(representativeItems[0].title, category)
    } else {
      const provider = settings.tasks.chat.provider
      const raw = await chatComplete(
        classifyCluster.system(),
        classifyCluster.user(representativeItems.map((item) => {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)
          return classifyItem.user({ title: item.title, domain: item.domain, path, siteLine, parentCategory })
        })),
        settings,
        200,
        {
          responseFormat: 'json',
          metricKey: 'classifier-clusters',
          jsonSchema: CLUSTER_RESPONSE_SCHEMA,
          ...(provider === 'browser-ml' ? { disableThinking: true } : {}),
          signal,
        },
      )
      const parsed = classifyCluster.parseResponse(raw)
      category = parsed.category || 'Other'
      if (category === 'Other') {
        category = classifyItem.parseResponse(raw, 'Other')
      }
      name = parsed.name || category
    }

    names.set(cluster.clusterId, name)

    const updates: { url: string; category: string; parentCategory?: string; clusterId: number }[] = []
    for (const url of cluster.members) {
      const existing = await getCached(prefix, url)
      const finalParent = parentCategory || category
      await setCached(prefix, url, {
        category,
        parentCategory: finalParent,
        clusterId: cluster.clusterId,
        processedAt: Date.now(),
        tags: existing?.tags,
        embedding: existing?.embedding,
        intent: existing?.intent,
      })
      updates.push({ url, category, parentCategory: finalParent, clusterId: cluster.clusterId })
    }
    if (updates.length > 0) onProgress(updates)
    tracker.progress(cluster.members.length, { clusterId: cluster.clusterId })
  }

  tracker.done({ namedClusters: names.size })
  return names
}
