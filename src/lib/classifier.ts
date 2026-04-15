import { chatComplete } from './llm'
import { getChatProvider, getEmbeddingProvider } from './providers/factory'
import { cosineSimilarity } from './embedder'
import { kMeans, type ClusterResult } from './cluster'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { classifierLog } from './logger'
import { classifyCluster, classifyItem, groupRareCategories as groupRareCategoriesContract, normalizeCategories } from './prompts'
import { getCached, setCached } from './storage'
import type { BookmarkItem, LlmSettings, TabItem } from './types'
import { DEFAULT_LLM_SETTINGS } from './types'

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

function createProgressTracker(operation: string, total: number, context?: Record<string, unknown>) {
  const startedAt = Date.now()
  const safeTotal = Math.max(total, 1)
  let done = 0
  let lastPct = -1
  let lastLoggedDone = 0

  classifierLog.info(`${operation} start`, { total: safeTotal, ...context })

  return {
    tick(delta = 1, extra?: Record<string, unknown>) {
      const nextDone = Math.min(safeTotal, done + Math.max(0, Math.floor(delta)))
      for (let current = done + 1; current <= nextDone; current += 1) {
        const pct = Math.floor((current / safeTotal) * 100)
        const shouldLog =
          pct > lastPct
          || current === safeTotal
          || (safeTotal < 100 && current - lastLoggedDone >= 5)
        if (!shouldLog) continue
        lastPct = pct
        lastLoggedDone = current
        classifierLog.debug(`${operation} progress`, { done: current, total: safeTotal, pct, ...extra })
      }
      done = nextDone
    },
    finish(extra?: Record<string, unknown>) {
      classifierLog.info(`${operation} done`, {
        total: safeTotal,
        durationMs: Date.now() - startedAt,
        ...extra,
      })
    },
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

let categoryLabelEmbeddingsPromise: Promise<Map<string, number[]>> | null = null
let lastUsedCategoryHash: string | null = null

async function getCategoryLabelEmbeddings(settings: LlmSettings): Promise<Map<string, number[]>> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  const model = provider.getEmbeddingModel(settings) || 'default'
  
  // Create a simple hash/key to detect changes in categories or descriptors
  const categoryHash = `${model}:${JSON.stringify(settings.nliCategories)}`

  if (categoryLabelEmbeddingsPromise && categoryHash === lastUsedCategoryHash) {
    return categoryLabelEmbeddingsPromise
  }

  categoryLabelEmbeddingsPromise = (async () => {
    classifierLog.info('re-embedding NLI categories', { count: settings.nliCategories.length })
    const map = new Map<string, number[]>()
    for (const cat of settings.nliCategories) {
      map.set(cat.label, await provider.embed(cat.descriptor || cat.label, settings))
    }
    return map
  })()

  lastUsedCategoryHash = categoryHash
  return categoryLabelEmbeddingsPromise
}

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

function domainSiteLine(domain: string, domainMap: Map<string, DomainInfo> | undefined): string {
  if (!domainMap) return ''
  const info = getDomainInfo(domain, domainMap)
  if (!info?.known) return ''
  if (info.description && info.category) return `\nSite: ${info.description} (${info.category})`
  if (info.description) return `\nSite: ${info.description}`
  if (info.category) return `\nSite: ${info.category}`
  return ''
}

async function classifyItemNLI(
  item: ClassifiedItem,
  settings: LlmSettings,
  domainMap?: Map<string, DomainInfo>,
): Promise<string> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  
  const path = urlPathSnippet(item.url)
  const domainDesc = domainMap ? getDomainInfo(item.domain, domainMap)?.description : undefined
  const text = [domainDesc, item.title, item.domain, path].filter(Boolean).join(' ')
  const queryEmbedding = await provider.embed(text, settings)
  const labelEmbeddings = await getCategoryLabelEmbeddings(settings)
  let bestLabel = 'Other'
  let bestScore = -Infinity

  for (const [label, embedding] of labelEmbeddings.entries()) {
    const score = cosineSimilarity(queryEmbedding, embedding)
    if (score > bestScore) {
      bestScore = score
      bestLabel = label
    }
  }

  return bestLabel
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
  
  const useNli = embedProvider.getClassificationMethod(settings) === 'nli'
  
  const tracker = createProgressTracker('classifyItems', uncached.length, { provider: chatProviderId })
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
    const batch = uncached.slice(i, i + BATCH)
    const results: { url: string; category: string }[] = []

    for (const item of batch) {
      try {
        let category = 'Other'
        if (useNli) {
          category = await classifyItemNLI(item, settings, domainMap)
        } else {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap)
          const userMsg = classifyItem.user({ title: item.title, domain: item.domain, path, siteLine })
          const raw = await chatComplete(systemPrompt, userMsg, settings, 40, options)
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
        tracker.tick(1)
      }
    }
    if (results.length > 0) onProgress(results)
  }
  tracker.finish({ failed })
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
): Promise<Map<string, import('./types').PageIntent>> {
  const map = new Map<string, import('./types').PageIntent>()
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
  const tracker = createProgressTracker('normalizeCategoryLabels', labels.length)

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
    tracker.tick(labels.length)
    tracker.finish()
    return parsed
  } catch (err) {
    tracker.tick(labels.length)
    classifierLog.warn('normalizeCategoryLabels JSON parse failed, keeping originals', {
      err: err instanceof Error ? err.message : String(err),
    })
    tracker.finish({ fallback: true })
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
  const tracker = createProgressTracker('groupRareCategories', current.length * Math.max(1, maxPasses), { maxPasses })

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
      tracker.tick(1)
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
    tracker.finish({ updates: 0 })
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

  tracker.finish({ updates: updates.length })
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
  const tracker = createProgressTracker('splitLargeClusters', Math.max(totalWork, 1), {
    groups: groups.size,
    totalItems: items.length,
  })

  for (const [parentCategory, members] of groups) {
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
      )
      tracker.tick(members.length, { parentCategory, strategy: 'kmeans' })
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
      const batch = members.slice(i, i + BATCH)
      const updates: { url: string; category: string; parentCategory?: string }[] = []

      for (const item of batch) {
        try {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap)
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
            options,
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
          tracker.tick(1, { parentCategory, strategy: 'batch-llm' })
        }
      }
      if (updates.length > 0) onProgress(updates)
    }
  }
  tracker.finish()
}

export async function classifyTabs(
  tabs: TabItem[],
  onProgress: (updates: { url: string; category: string }[]) => void,
  settings?: LlmSettings,
): Promise<void> {
  const activeSettings = settings ?? {
    ...DEFAULT_LLM_SETTINGS,
    tasks: {
      ...DEFAULT_LLM_SETTINGS.tasks,
      chat: { provider: 'gemini-nano' },
      embedding: { provider: 'browser-ml' },
    },
  }
  await classifyItems(
    tabs.map((tab) => ({ url: tab.url, title: tab.title, domain: tab.domain })),
    'tab',
    activeSettings,
    onProgress,
  )
}

export async function classifyBookmarks(
  bookmarks: BookmarkItem[],
  onProgress: (updates: { url: string; category: string }[]) => void,
  settings?: LlmSettings,
): Promise<void> {
  const activeSettings = settings ?? {
    ...DEFAULT_LLM_SETTINGS,
    tasks: {
      ...DEFAULT_LLM_SETTINGS.tasks,
      chat: { provider: 'gemini-nano' },
      embedding: { provider: 'browser-ml' },
    },
  }
  await classifyItems(
    bookmarks.map((bookmark) => ({ url: bookmark.url, title: bookmark.title, domain: bookmark.domain })),
    'bm',
    activeSettings,
    onProgress,
  )
}

export async function classifyWithLmStudio(
  items: ClassifiedItem[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
  domainMap?: Map<string, DomainInfo>,
): Promise<void> {
  await classifyItems(items, prefix, settings, onProgress, domainMap)
}

function inferClusterNameFromRepresentative(title: string, category: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim()
  if (!normalized) return category
  return normalized.split(' ').slice(0, 5).join(' ').slice(0, 60)
}

async function classifyClusterNli(
  centroid: number[],
  settings: LlmSettings
): Promise<string> {
  const labelEmbeddings = await getCategoryLabelEmbeddings(settings)
  let bestLabel = 'Other'
  let bestScore = -Infinity
  for (const [label, embedding] of labelEmbeddings.entries()) {
    const score = cosineSimilarity(centroid, embedding)
    if (score > bestScore) {
      bestScore = score
      bestLabel = label
    }
  }
  return bestLabel
}

export async function classifyByClusters(
  items: ClusterInputItem[],
  clusters: ClusterResult[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string; parentCategory?: string; clusterId: number }[]) => void,
  domainMap?: Map<string, DomainInfo>,
): Promise<Map<number, string>> {
  const totalMembers = clusters.reduce((sum, cluster) => sum + cluster.members.length, 0)
  const tracker = createProgressTracker('classifyByClusters', totalMembers, { clusters: clusters.length })
  const byUrl = new Map(items.map((item) => [item.url, item]))
  const names = new Map<number, string>()
  const embedProviderId = settings.tasks.embedding.provider
  const embedProvider = getEmbeddingProvider(embedProviderId)
  const useNli = embedProvider.getClassificationMethod(settings) === 'nli'

  for (const cluster of clusters) {
    const representativeItems = cluster.representatives
      .map((url) => byUrl.get(url))
      .filter((item): item is ClusterInputItem => Boolean(item))

    if (representativeItems.length === 0 || cluster.members.length === 0) {
      tracker.tick(cluster.members.length, { clusterId: cluster.clusterId, skipped: true })
      continue
    }

    let category = 'Other'
    let name = 'Other'

    if (useNli) {
      category = await classifyClusterNli(cluster.centroid, settings)
      name = inferClusterNameFromRepresentative(representativeItems[0].title, category)
    } else {
      const provider = settings.tasks.chat.provider
      const raw = await chatComplete(
        classifyCluster.system(),
        classifyCluster.user(representativeItems.map((item) => {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap)
          return classifyItem.user({ title: item.title, domain: item.domain, path, siteLine })
        })),
        settings,
        200,
        {
          responseFormat: 'json',
          metricKey: 'classifier-clusters',
          jsonSchema: CLUSTER_RESPONSE_SCHEMA,
          ...(provider === 'browser-ml' ? { disableThinking: true } : {}),
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
      await setCached(prefix, url, {
        category,
        parentCategory: category,
        clusterId: cluster.clusterId,
        processedAt: Date.now(),
        tags: existing?.tags,
        embedding: existing?.embedding,
        intent: existing?.intent,
      })
      updates.push({ url, category, parentCategory: category, clusterId: cluster.clusterId })
    }
    if (updates.length > 0) onProgress(updates)
    tracker.tick(cluster.members.length, { clusterId: cluster.clusterId })
  }

  tracker.finish({ namedClusters: names.size })
  return names
}
