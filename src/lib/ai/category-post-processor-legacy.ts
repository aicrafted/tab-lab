import { kMeans, type ClusterResult } from './cluster'
import { chatComplete } from './llm'
import { getEmbeddingProvider } from './providers/factory'
import { getCached, setCached } from '../core/storage'
import { classifyCluster, classifyItem, groupRareCategories as groupRareCategoriesContract, normalizeCategories, MAP_LABELS_TO_UMBRELLAS_SYSTEM, MAP_LABELS_TO_UMBRELLAS_USER_PREFIX, MAP_LABELS_TO_UMBRELLAS_USER_MIDDLE } from './prompts'
import type { LlmSettings } from '../core/types'
import { aiPipelineLog } from '../core/logger'
import { createLoggerProgress } from '../core/progress'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { cosineSimilarity, fetchEmbedding, fetchEmbeddingsBatch } from './embedder'
import { SPLIT_THRESHOLD } from './classifier'
import { classifyVectorNli } from './nli-engine'

const RARE_THRESHOLD = 3

const RARE_GROUP_SCHEMA = {
  name: 'rare_group',
  schema: {
    type: 'object',
    additionalProperties: { type: 'string' },
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

function urlPathSnippet(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    return path.slice(0, 80)
  } catch {
    return ''
  }
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

/** Legacy refinement logic that discovers umbrellas and maps labels to them with parentCategory hierarchy. */
export async function legacy_normalizeCategoryLabels(
  rawLabels: string[],
  settings: LlmSettings,
): Promise<Record<string, string>> {
  const labels = [...new Set(rawLabels.map(l => l.trim()).filter(Boolean))]
  if (labels.length === 0) return {}
  if (labels.length === 1) return { [labels[0]]: labels[0] }
  const tracker = createLoggerProgress('normalizeCategoryLabels', labels.length)

  // PHASE 1: Taxonomy Discovery (LLM)
  aiPipelineLog.info('normalize phase 1: discovery starting', { inputCount: labels.length })
  
  const response = await chatComplete(normalizeCategories.system(), normalizeCategories.user(labels), settings, 2000, {
    metricKey: 'classifier-normalize-discovery'
  })
  const umbrellas = normalizeCategories.parseUmbrellas(response)
  
  if (umbrellas.length === 0) {
    aiPipelineLog.warn('no umbrellas discovered, using original labels', { response: response.slice(0, 500) })
    return Object.fromEntries(labels.map(l => [l, l]))
  }

  aiPipelineLog.info('normalize phase 1: discovery done', { 
    umbrellaCount: umbrellas.length,
    umbrellas: umbrellas.slice(0, 10)
  })

  // PHASE 2: Assignment (LLM + Embeddings Fallback)
  aiPipelineLog.info('normalize phase 2: assignment starting')
  const mergeMap: Record<string, string> = {}
  
  try {
    const allLabelsToEmbed = [...new Set([...umbrellas, ...labels])]
    await fetchEmbeddingsBatch(
      allLabelsToEmbed.map(l => ({ 
        url: l.startsWith('http') ? l : `label:${l}`, 
        title: l, 
        domain: '' 
      })),
      settings,
      () => {}
    )

    const umbrellaEmbeddings = await Promise.all(
      umbrellas.map(async (u: string) => ({ label: u, vec: await fetchEmbedding(u, settings) }))
    )

    const MAPPING_BATCH = 40
    for (let i = 0; i < labels.length; i += MAPPING_BATCH) {
      const chunk = labels.slice(i, i + MAPPING_BATCH)
      const userMessage = `${MAP_LABELS_TO_UMBRELLAS_USER_PREFIX}${umbrellas.join(', ')}${MAP_LABELS_TO_UMBRELLAS_USER_MIDDLE}${chunk.join(', ')}`
      
      try {
        const response = await chatComplete(
          MAP_LABELS_TO_UMBRELLAS_SYSTEM,
          userMessage,
          settings,
          1000,
          { metricKey: 'normalize-mapping' }
        )

        const batchMap = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim())
        
        for (const label of chunk) {
          const target = batchMap[label]
          if (target && umbrellas.includes(target)) {
            mergeMap[label] = target
          } else {
            mergeMap[label] = await nliFallback(label, umbrellaEmbeddings, settings)
          }
        }
      } catch (err) {
        aiPipelineLog.warn('LLM batch mapping failed, using NLI fallback', { chunkSamples: chunk.slice(0, 3), err })
        for (const label of chunk) {
          mergeMap[label] = await nliFallback(label, umbrellaEmbeddings, settings)
        }
      }
      tracker.progress(chunk.length)
    }

    tracker.done()
    return mergeMap
  } catch (err) {
    aiPipelineLog.warn('normalizeCategoryLabels phase 2 failed', { err })
    tracker.done({ fallback: true })
    return Object.fromEntries(labels.map((label) => [label, label]))
  }
}

async function nliFallback(label: string, targets: {label: string, vec: number[]}[], settings: LlmSettings) {
  try {
    const vec = await fetchEmbedding(label, settings)
    let bestMatch = label
    let bestScore = -1

    for (const target of targets) {
      const score = cosineSimilarity(vec, target.vec)
      if (score > bestScore) {
        bestScore = score
        bestMatch = target.label
      }
    }
    return bestScore > 0.4 ? bestMatch : label
  } catch {
    return label
  }
}

/** Legacy collection-level consolidation for rare categories. */
export async function legacy_groupRareCategories(
  items: { url: string; category: string }[],
  settings: LlmSettings,
  maxPasses = 3,
): Promise<{ url: string; category: string }[]> {
  let current = items
    .map((item) => ({ url: item.url, category: item.category.trim() }))
    .filter((item) => item.category.length > 0)
  if (current.length === 0) return []
  const tracker = createLoggerProgress('groupRareCategories', current.length * Math.max(1, maxPasses), { maxPasses })

  const allUpdates = new Map<string, string>()

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

    if (rare.length === 0) break

    const prompt = groupRareCategoriesContract.user({
      frequent: frequent.map((label) => ({ label, count: counts.get(label) ?? 0 })),
      rare: rare.map((label) => ({ label, count: counts.get(label) ?? 0 })),
    })

    const raw = await chatComplete(
      groupRareCategoriesContract.system(),
      prompt,
      settings,
      Math.min(4000, rare.length * 50 + 300),
      {
        responseFormat: 'json',
        metricKey: 'classifier-group-rare',
        jsonSchema: RARE_GROUP_SCHEMA,
      },
    )

    let mergeMap: Record<string, string> = {}
    try {
      mergeMap = groupRareCategoriesContract.parseResponse(raw)
    } catch {
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

    if (!changed) break
  }

  if (allUpdates.size === 0) {
    tracker.done({ updates: 0 })
    return []
  }

  const updates = [...allUpdates.entries()].map(([url, category]) => ({ url, category }))
  await Promise.all(updates.map(async (update) => {
    const existing = await getCached(update.url)
    if (!existing) return
    await setCached(update.url, {
      ...existing,
      category: update.category,
      parentCategory: update.category,
      processedAt: Date.now(),
    })
  }))

  tracker.done({ updates: updates.length })
  return updates
}

/** Legacy logic to split very large categories using k-means/LLM. */
export async function legacy_splitLargeClusters(
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
      const subK = Math.max(2, Math.min(8, Math.ceil(members.length / 5)))
      const subClusters = kMeans(
        membersWithEmbeddings.map((member) => ({ url: member.url, embedding: member.embedding })),
        subK,
      )
      await legacy_classifyByClusters(
        membersWithEmbeddings,
        subClusters,
        settings,
        (updates) => {
          onProgress(updates.map((update) => ({ url: update.url, category: update.category })))
        },
        domainMap,
        signal,
        parentCategory,
      )
      tracker.progress(members.length)
      continue
    }

    const provider = settings.tasks.chat.provider
    const format = provider !== 'gemini-nano' ? 'json' : 'text'
    const useJsonOutput = format === 'json'
    const systemPrompt = classifyItem.system(format)
    const options = {
      responseFormat: 'json' as const,
      metricKey: 'classifier-split',
      jsonSchema: CATEGORY_RESPONSE_SCHEMA,
    }
    
    for (const item of members) {
      try {
        const path = urlPathSnippet(item.url)
        const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)
        const userMsg = classifyItem.user({ title: item.title, domain: item.domain, path, siteLine, parentCategory })
        const raw = await chatComplete(systemPrompt, userMsg, settings, 40, { ...options, signal })
        const category = useJsonOutput
          ? (classifyItem.parseResponse(raw, parentCategory) || parentCategory)
          : classifyItem.parseResponse(raw, parentCategory)
        const existing = await getCached(item.url)
        await setCached(item.url, { ...existing, category, parentCategory, processedAt: Date.now() })
        onProgress([{ url: item.url, category }])
      } catch (err) {
        aiPipelineLog.error('legacy_splitLargeClusters item failed', { url: item.url, err })
      } finally {
        tracker.progress(1)
      }
    }
  }
  tracker.done()
}

export async function legacy_classifyByClusters(
  items: { url: string; title: string; domain: string; embedding: number[] }[],
  clusters: ClusterResult[],
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string; parentCategory?: string; clusterId: number }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  signal?: AbortSignal,
  parentCategory?: string,
): Promise<Map<number, string>> {
  const byUrl = new Map(items.map((item) => [item.url, item]))
  const names = new Map<number, string>()
  const embedProvider = getEmbeddingProvider(settings.tasks.embedding.provider)
  const useNli = settings.tasks.classification.method === 'nli' && !!embedProvider.getEmbeddingModel(settings)

  for (const cluster of clusters) {
    if (signal?.aborted) throw new Error('Aborted')
    const representativeItems = cluster.representatives
      .map((url) => byUrl.get(url))
      .filter((item): item is typeof items[0] => Boolean(item))

    if (representativeItems.length === 0) continue

    let category = 'Other'
    if (useNli) {
      const result = await classifyVectorNli(cluster.centroid, settings)
      category = result?.label || 'Other'
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
        {
          responseFormat: 'json',
          metricKey: 'classifier-clusters',
          jsonSchema: CLUSTER_RESPONSE_SCHEMA,
          signal,
        },
      )
      const parsed = classifyCluster.parseResponse(raw)
      category = parsed.category || 'Other'
    }
    
    names.set(cluster.clusterId, category)
    const updates = cluster.members.map((url) => ({ url, category, parentCategory, clusterId: cluster.clusterId }))
    await Promise.all(updates.map(async (u: { url: string; category: string; parentCategory?: string; clusterId: number }) => {
      const existing = await getCached(u.url)
      await setCached(u.url, { ...existing, category: u.category, parentCategory: u.parentCategory, clusterId: u.clusterId, processedAt: Date.now() })
    }))
    onProgress(updates)
  }
  return names
}
