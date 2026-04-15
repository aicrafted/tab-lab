import { useCallback, useRef } from 'react'
import { applyCategoryUpdates, applyClusterIdUpdates, applyIntentUpdates, applyTagsUpdates } from '@/lib/apply-updates'
import { kMeans, type ClusterResult } from '@/lib/cluster'
import { saveClusterNames } from '@/lib/cluster-names'
import { checkLlmAvailability, classifyBookmarks, classifyByClusters, classifyTabs, classifyWithLmStudio, groupRareCategories, normalizeCategoryLabels, splitLargeClusters, type LlmStatus } from '@/lib/classifier'
import { clearDomainKnowledgeCache, enrichDomains, estimateDomainEnrichmentWork } from '@/lib/domain-enricher'
import { clearEmbeddingCache, fetchAndCacheEmbeddings, fetchEmbeddingsBatch, loadCachedEmbeddings, reprojectAllEmbeddings } from '@/lib/embedder'
import { classifyIntentGeminiNano, classifyIntentLmStudio } from '@/lib/intent'
import { detectPlatform } from '@/lib/platform-detection'
import { clearAllAICache, getCached, setCached } from '@/lib/storage'
import { tagWithGeminiNano, tagWithLmStudio } from '@/lib/tagger'
import type { BookmarkItem, KnownPlatform, LlmSettings, PageIntent, TabItem } from '@/lib/types'

export interface PipelineTaskProgress {
  id: string
  label: string
  done: number
  total: number
  percent: number
  status: 'running' | 'done' | 'failed'
}

const BOOKMARK_CLUSTER_OFFSET = 10_000

function createTaskLogger(
  task: string,
  label: string,
  total: number,
  onProgress?: (update: PipelineTaskProgress) => void,
) {
  const safeTotal = Math.max(1, total)
  let done = 0
  let lastLoggedPercent = -1
  let closed = false
  const startedAt = Date.now()
  console.info(`[llm:${task}] start`, { total })
  const emitRunning = () => {
    const rawPct = (done / safeTotal) * 100
    const uiPct = Math.round(rawPct * 10) / 10
    const logPct = Math.floor(rawPct)
    while (lastLoggedPercent < logPct) {
      lastLoggedPercent += 1
      if (lastLoggedPercent >= 0) {
        console.info(`[llm:${task}] progress ${done}/${safeTotal} (${lastLoggedPercent}%)`)
      }
    }
    onProgress?.({
      id: task,
      label,
      done,
      total: safeTotal,
      percent: uiPct,
      status: 'running',
    })
  }
  emitRunning()

  return {
    progress(delta: number) {
      if (closed) return
      const safeDelta = Math.max(0, Math.floor(delta))
      if (safeDelta === 0) {
        emitRunning()
        return
      }
      for (let i = 0; i < safeDelta && done < safeTotal; i += 1) {
        done += 1
        emitRunning()
      }
    },
    done(extra?: Record<string, unknown>) {
      if (closed) return
      closed = true
      done = safeTotal
      const finalRawPct = (done / safeTotal) * 100
      const finalLogPct = Math.floor(finalRawPct)
      while (lastLoggedPercent < finalLogPct) {
        lastLoggedPercent += 1
        if (lastLoggedPercent >= 0) {
          console.info(`[llm:${task}] progress ${done}/${safeTotal} (${lastLoggedPercent}%)`)
        }
      }
      console.info(`[llm:${task}] done`, {
        elapsedMs: Date.now() - startedAt,
        ...extra,
      })
      onProgress?.({
        id: task,
        label,
        done,
        total: safeTotal,
        percent: 100,
        status: 'done',
      })
    },
    failed(error: unknown) {
      if (closed) return
      closed = true
      console.error(`[llm:${task}] failed`, error)
      onProgress?.({
        id: task,
        label,
        done,
        total: safeTotal,
        percent: Math.round((done / safeTotal) * 100),
        status: 'failed',
      })
    },
  }
}

function hasChatProviderConfig(settings: LlmSettings): boolean {
  const provider = settings.tasks.chat.provider
  if (provider === 'gemini-nano') return true
  if (provider === 'webllm') return Boolean(settings.tasks.chat.model)
  if (provider === 'lmstudio') {
    return Boolean(settings.providers.lmstudio.baseUrl && settings.tasks.chat.model)
  }
  if (provider === 'openrouter') {
    return Boolean(settings.providers.openrouter.apiKey && settings.tasks.chat.model)
  }
  return false
}

function hasDomainKnowledgeProviderConfig(settings: LlmSettings): boolean {
  const provider = settings.tasks.chat.provider
  if (provider === 'gemini-nano') return false
  if (provider === 'webllm') return Boolean(settings.tasks.chat.model)
  if (provider === 'lmstudio') {
    return Boolean(settings.providers.lmstudio.baseUrl && settings.tasks.chat.model)
  }
  if (provider === 'openrouter') {
    return Boolean(settings.providers.openrouter.apiKey && settings.tasks.chat.model)
  }
  return false
}

interface UseAiPipelinesArgs {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  llmSettings: LlmSettings
  setBookmarks: React.Dispatch<React.SetStateAction<BookmarkItem[]>>
  setTabs: React.Dispatch<React.SetStateAction<TabItem[]>>
  setLlmStatus: React.Dispatch<React.SetStateAction<LlmStatus>>
  setLlmError: (msg: string | undefined) => void
  setClusterNames: React.Dispatch<React.SetStateAction<Map<number, string>>>
  setProjectedPoints: React.Dispatch<React.SetStateAction<Map<string, [number, number]>>>
  reload: () => void
  onTaskProgress?: (update: PipelineTaskProgress) => void
}

export function useAiPipelines({
  bookmarks,
  tabs,
  llmSettings,
  setBookmarks,
  setTabs,
  setLlmStatus,
  setLlmError,
  setClusterNames,
  setProjectedPoints,
  reload,
  onTaskProgress,
}: UseAiPipelinesArgs) {
  const activeRunIdRef = useRef<number>(0)
  const runSeqRef = useRef<number>(0)

  const beginRun = useCallback(() => {
    const id = ++runSeqRef.current
    activeRunIdRef.current = id
    return id
  }, [])

  const isRunActive = useCallback((id: number) => activeRunIdRef.current === id, [])

  const finishRun = useCallback((id: number) => {
    if (activeRunIdRef.current === id) {
      activeRunIdRef.current = 0
    }
  }, [])

  const handleStopPipeline = useCallback(async () => {
    activeRunIdRef.current = 0
    setLlmError('Pipeline stopped by user')
    setLlmStatus('ready')
  }, [setLlmError, setLlmStatus])

  const applyTabCategoryBatch = useCallback((updates: { url: string; category: string }[]) => {
    setTabs((prev) => applyCategoryUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkCategoryBatch = useCallback((updates: { url: string; category: string }[]) => {
    setBookmarks((prev) => applyCategoryUpdates(prev, updates))
  }, [setBookmarks])

  const applyTabTagsBatch = useCallback((updates: { url: string; tags: string[] }[]) => {
    setTabs((prev) => applyTagsUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkTagsBatch = useCallback((updates: { url: string; tags: string[] }[]) => {
    setBookmarks((prev) => applyTagsUpdates(prev, updates))
  }, [setBookmarks])

  const applyTabIntentBatch = useCallback((updates: { url: string; intent: PageIntent }[]) => {
    setTabs((prev) => applyIntentUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkIntentBatch = useCallback((updates: { url: string; intent: PageIntent }[]) => {
    setBookmarks((prev) => applyIntentUpdates(prev, updates))
  }, [setBookmarks])

  const applyTabClusterBatch = useCallback((updates: { url: string; clusterId: number }[]) => {
    setTabs((prev) => applyClusterIdUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkClusterBatch = useCallback((updates: { url: string; clusterId: number }[]) => {
    setBookmarks((prev) => applyClusterIdUpdates(prev, updates))
  }, [setBookmarks])

  const applyPlatformsFromDomainMap = useCallback((
    tb: { url: string; domain: string }[],
    bm: { url: string; domain: string }[],
    domainMap: Map<string, import('@/lib/domain-enricher').DomainInfo>,
  ) => {
    const tabPlatforms = new Map<string, KnownPlatform>()
    for (const item of tb) {
      const platform = detectPlatform(item.domain, domainMap)
      if (platform) tabPlatforms.set(item.url, platform)
    }
    if (tabPlatforms.size > 0) {
      setTabs((prev) => {
        let changed = false
        const next = prev.map((item) => {
          const platform = tabPlatforms.get(item.url)
          if (!platform || item.platform === platform) return item
          changed = true
          return { ...item, platform }
        })
        return changed ? next : prev
      })
    }

    const bookmarkPlatforms = new Map<string, KnownPlatform>()
    for (const item of bm) {
      const platform = detectPlatform(item.domain, domainMap)
      if (platform) bookmarkPlatforms.set(item.url, platform)
    }
    if (bookmarkPlatforms.size > 0) {
      setBookmarks((prev) => {
        let changed = false
        const next = prev.map((item) => {
          const platform = bookmarkPlatforms.get(item.url)
          if (!platform || item.platform === platform) return item
          changed = true
          return { ...item, platform }
        })
        return changed ? next : prev
      })
    }
  }, [setBookmarks, setTabs])

  const runEmbeddingPass = useCallback(async (
    tb: TabItem[],
    bm: BookmarkItem[],
    settings: LlmSettings,
  ) => {
    const runId = beginRun()
    const embeddingProvider = settings.tasks.embedding.provider
    if (embeddingProvider === 'lmstudio' && !settings.tasks.embedding.model) return
    if (embeddingProvider === 'openrouter' && (!settings.providers.openrouter.apiKey || !settings.tasks.embedding.model)) return

    const allItems = [
      ...tb.map(t => ({ url: t.url, title: t.title || t.url, domain: t.domain, category: t.category })),
      ...bm.map(b => ({ url: b.url, title: b.title || b.url, domain: b.domain, category: b.category })),
    ]

    const embeddingLog = createTaskLogger('embeddings', 'LLM calc embeddings', allItems.length, onTaskProgress)
    try {
      await fetchEmbeddingsBatch(allItems, settings, (updates) => {
        if (!isRunActive(runId)) return
        embeddingLog.progress(updates.length)
      })
      if (!isRunActive(runId)) return

      const map = await reprojectAllEmbeddings()
      if (!isRunActive(runId)) return
      embeddingLog.done({ projectedPoints: map.size })
      if (map.size > 0) setProjectedPoints(map)
    } catch (err) {
      embeddingLog.failed(err)
      if (!isRunActive(runId)) return
      setLlmError(String(err))
      setLlmStatus('error')
    } finally {
      finishRun(runId)
    }
  }, [beginRun, finishRun, isRunActive, onTaskProgress, setLlmError, setLlmStatus, setProjectedPoints])

  const normalizeCategoriesAfterClassification = useCallback(async (
    tabItems: { url: string }[],
    bookmarkItems: { url: string }[],
  ) => {
    try {
      const [tabEntries, bookmarkEntries] = await Promise.all([
        Promise.all(tabItems.map(async (item) => ({ url: item.url, entry: await getCached('tab', item.url) }))),
        Promise.all(bookmarkItems.map(async (item) => ({ url: item.url, entry: await getCached('bm', item.url) }))),
      ])

      const labels = [...new Set([
        ...tabEntries.map(({ entry }) => entry?.category).filter(Boolean),
        ...bookmarkEntries.map(({ entry }) => entry?.category).filter(Boolean),
      ] as string[])]
      if (labels.length <= 1) return

      const mergeMap = await normalizeCategoryLabels(labels, llmSettings)
      const tabUpdates: { url: string; category: string }[] = []
      const bookmarkUpdates: { url: string; category: string }[] = []
      const cacheWrites: Promise<void>[] = []

      for (const { url, entry } of tabEntries) {
        const from = entry?.category
        if (!from) continue
        const to = mergeMap[from] ?? from
        if (to === from) continue
        tabUpdates.push({ url, category: to })
        cacheWrites.push(setCached('tab', url, { ...entry, category: to, parentCategory: to, processedAt: Date.now() }))
      }

      for (const { url, entry } of bookmarkEntries) {
        const from = entry?.category
        if (!from) continue
        const to = mergeMap[from] ?? from
        if (to === from) continue
        bookmarkUpdates.push({ url, category: to })
        cacheWrites.push(setCached('bm', url, { ...entry, category: to, parentCategory: to, processedAt: Date.now() }))
      }

      await Promise.all(cacheWrites)
      if (tabUpdates.length > 0) applyTabCategoryBatch(tabUpdates)
      if (bookmarkUpdates.length > 0) applyBookmarkCategoryBatch(bookmarkUpdates)

      const tabCategoryItems = tabEntries
        .map(({ url, entry }) => {
          const from = entry?.category
          if (!from) return null
          return { url, category: mergeMap[from] ?? from }
        })
        .filter((item): item is { url: string; category: string } => Boolean(item))
      const bookmarkCategoryItems = bookmarkEntries
        .map(({ url, entry }) => {
          const from = entry?.category
          if (!from) return null
          return { url, category: mergeMap[from] ?? from }
        })
        .filter((item): item is { url: string; category: string } => Boolean(item))

      const [rareTabUpdates, rareBookmarkUpdates] = await Promise.all([
        groupRareCategories(tabCategoryItems, 'tab', llmSettings),
        groupRareCategories(bookmarkCategoryItems, 'bm', llmSettings),
      ])
      if (rareTabUpdates.length > 0) applyTabCategoryBatch(rareTabUpdates)
      if (rareBookmarkUpdates.length > 0) applyBookmarkCategoryBatch(rareBookmarkUpdates)
    } catch (err) {
      console.warn('[llm] post-classification category normalization skipped', err)
    }
  }, [applyBookmarkCategoryBatch, applyTabCategoryBatch, llmSettings])

  const runAutoAiPipeline = useCallback(async (
    tb: TabItem[],
    bm: BookmarkItem[],
    _tabsWithCache: TabItem[],
  ) => {
    const nanoStatus = await checkLlmAvailability(llmSettings)
    console.info('[llm:auto] evaluate provider', {
      provider: llmSettings.tasks.chat.provider,
      status: nanoStatus,
      tabs: tb.length,
      bookmarks: bm.length,
    })

    if (llmSettings.tasks.classification.method === 'nli' && llmSettings.tasks.embedding.provider === 'transformers') {
      const allItems = [
        ...tb.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
        ...bm.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
      ]
      const allDomains = [...new Set(allItems.map((item) => item.domain).filter(Boolean))]
      const embedLog = createTaskLogger('auto-embed', 'Auto embeddings', allItems.length, onTaskProgress)
      const tabsLog = createTaskLogger('auto-cluster-tabs', 'Auto cluster tabs', tb.length, onTaskProgress)
      const bookmarksLog = createTaskLogger('auto-cluster-bookmarks', 'Auto cluster bookmarks', bm.length, onTaskProgress)
      setLlmStatus('classifying')
      try {
        const domainMap = await enrichDomains(allDomains, llmSettings)
        applyPlatformsFromDomainMap(tb, bm, domainMap)
        const embeddings = await fetchAndCacheEmbeddings(allItems, llmSettings, (updates) => {
          embedLog.progress(updates.length)
        }, domainMap)
        embedLog.done()

        const tabItems = tb
          .map((t) => ({ url: t.url, title: t.title, domain: t.domain, embedding: embeddings.get(t.url) }))
          .filter((item): item is { url: string; title: string; domain: string; embedding: number[] } => Boolean(item.embedding))
        if (tabItems.length > 0) {
          const uniquePlatformCount = new Set(
            tabItems
              .map((item) => detectPlatform(item.domain, domainMap))
              .filter((platform): platform is KnownPlatform => platform !== undefined),
          ).size
          const k = Math.max(3, Math.min(150, Math.max(
            Math.ceil(tabItems.length / 8),
            uniquePlatformCount,
          )))
          const clusters = kMeans(tabItems.map(({ url, embedding }) => ({ url, embedding })), k)
          const names = await classifyByClusters(tabItems, clusters, 'tab', llmSettings, (updates) => {
            tabsLog.progress(updates.length)
            applyTabCategoryBatch(updates)
            applyTabClusterBatch(updates)
          }, domainMap)
          setClusterNames((prev) => {
            const next = new Map(prev)
            for (const [clusterId, name] of names.entries()) next.set(clusterId, name)
            void saveClusterNames(next)
            return next
          })
        }

        const bookmarkItems = bm
          .map((b) => ({ url: b.url, title: b.title, domain: b.domain, embedding: embeddings.get(b.url) }))
          .filter((item): item is { url: string; title: string; domain: string; embedding: number[] } => Boolean(item.embedding))
        if (bookmarkItems.length > 0) {
          const uniquePlatformCount = new Set(
            bookmarkItems
              .map((item) => detectPlatform(item.domain, domainMap))
              .filter((platform): platform is KnownPlatform => platform !== undefined),
          ).size
          const k = Math.max(3, Math.min(150, Math.max(
            Math.ceil(bookmarkItems.length / 8),
            uniquePlatformCount,
          )))
          const clusters = kMeans(bookmarkItems.map(({ url, embedding }) => ({ url, embedding })), k)
          const bookmarkClusters: ClusterResult[] = clusters.map((cluster) => ({
            ...cluster,
            clusterId: cluster.clusterId + BOOKMARK_CLUSTER_OFFSET,
          }))
          const names = await classifyByClusters(bookmarkItems, bookmarkClusters, 'bm', llmSettings, (updates) => {
            bookmarksLog.progress(updates.length)
            applyBookmarkCategoryBatch(updates)
            applyBookmarkClusterBatch(updates)
          }, domainMap)
          setClusterNames((prev) => {
            const next = new Map(prev)
            for (const [clusterId, name] of names.entries()) next.set(clusterId, name)
            void saveClusterNames(next)
            return next
          })
        }

        tabsLog.done()
        bookmarksLog.done()
        await normalizeCategoriesAfterClassification(tb, bm)
        setLlmStatus('ready')
        void classifyIntentLmStudio(
          tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          applyTabIntentBatch,
          domainMap,
        )
        void classifyIntentLmStudio(
          bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          applyBookmarkIntentBatch,
          domainMap,
        )
      } catch (err) {
        embedLog.failed(err)
        tabsLog.failed(err)
        bookmarksLog.failed(err)
        setLlmError(String(err))
        setLlmStatus('error')
      }
      return
    }

    if (llmSettings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      setLlmStatus('classifying')
      void classifyTabs(tb, (updates) => {
        applyTabCategoryBatch(updates)
      }).then(() =>
        classifyBookmarks(bm, (updates) => {
          applyBookmarkCategoryBatch(updates)
        }).then(() => {
          void normalizeCategoriesAfterClassification(tb, bm)
          setLlmStatus('ready')
          void tagWithGeminiNano(tb, 'tab', (updates) => {
            applyTabTagsBatch(updates)
          })
          void tagWithGeminiNano(bm, 'bm', (updates) => {
            applyBookmarkTagsBatch(updates)
          })
          void classifyIntentGeminiNano(tb, 'tab', (updates) => {
            applyTabIntentBatch(updates)
          })
          void classifyIntentGeminiNano(bm, 'bm', (updates) => {
            applyBookmarkIntentBatch(updates)
          })
        }),
      )
      return
    }

    if (hasChatProviderConfig(llmSettings)) {
      const allItems = [
        ...tb.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
        ...bm.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
      ]
      const allDomains = [...new Set(allItems.map((item) => item.domain).filter(Boolean))]
      const embedLog = createTaskLogger('auto-embed', 'Auto embeddings', allItems.length, onTaskProgress)
      const tabsLog = createTaskLogger('auto-cluster-tabs', 'Auto cluster tabs', tb.length, onTaskProgress)
      const bookmarksLog = createTaskLogger('auto-cluster-bookmarks', 'Auto cluster bookmarks', bm.length, onTaskProgress)
      setLlmStatus('classifying')
      try {
        const domainMap = await enrichDomains(allDomains, llmSettings)
        applyPlatformsFromDomainMap(tb, bm, domainMap)
        const embeddings = await fetchAndCacheEmbeddings(allItems, llmSettings, (updates) => {
          embedLog.progress(updates.length)
        }, domainMap)
        embedLog.done()

        const tabItems = tb
          .map((t) => ({ url: t.url, title: t.title, domain: t.domain, embedding: embeddings.get(t.url) }))
          .filter((item): item is { url: string; title: string; domain: string; embedding: number[] } => Boolean(item.embedding))
        if (tabItems.length > 0) {
          const uniquePlatformCount = new Set(
            tabItems
              .map((item) => detectPlatform(item.domain, domainMap))
              .filter((platform): platform is KnownPlatform => platform !== undefined),
          ).size
          const k = Math.max(3, Math.min(150, Math.max(
            Math.ceil(tabItems.length / 8),
            uniquePlatformCount,
          )))
          const clusters = kMeans(tabItems.map(({ url, embedding }) => ({ url, embedding })), k)
          const names = await classifyByClusters(tabItems, clusters, 'tab', llmSettings, (updates) => {
            tabsLog.progress(updates.length)
            applyTabCategoryBatch(updates)
            applyTabClusterBatch(updates)
          }, domainMap)
          setClusterNames((prev) => {
            const next = new Map(prev)
            for (const [clusterId, name] of names.entries()) next.set(clusterId, name)
            void saveClusterNames(next)
            return next
          })
        }

        const bookmarkItems = bm
          .map((b) => ({ url: b.url, title: b.title, domain: b.domain, embedding: embeddings.get(b.url) }))
          .filter((item): item is { url: string; title: string; domain: string; embedding: number[] } => Boolean(item.embedding))
        if (bookmarkItems.length > 0) {
          const uniquePlatformCount = new Set(
            bookmarkItems
              .map((item) => detectPlatform(item.domain, domainMap))
              .filter((platform): platform is KnownPlatform => platform !== undefined),
          ).size
          const k = Math.max(3, Math.min(150, Math.max(
            Math.ceil(bookmarkItems.length / 8),
            uniquePlatformCount,
          )))
          const clusters = kMeans(bookmarkItems.map(({ url, embedding }) => ({ url, embedding })), k)
          const bookmarkClusters: ClusterResult[] = clusters.map((cluster) => ({
            ...cluster,
            clusterId: cluster.clusterId + BOOKMARK_CLUSTER_OFFSET,
          }))
          const names = await classifyByClusters(bookmarkItems, bookmarkClusters, 'bm', llmSettings, (updates) => {
            bookmarksLog.progress(updates.length)
            applyBookmarkCategoryBatch(updates)
            applyBookmarkClusterBatch(updates)
          }, domainMap)
          setClusterNames((prev) => {
            const next = new Map(prev)
            for (const [clusterId, name] of names.entries()) next.set(clusterId, name)
            void saveClusterNames(next)
            return next
          })
        }

        tabsLog.done()
        bookmarksLog.done()
        await normalizeCategoriesAfterClassification(tb, bm)
        setLlmStatus('ready')
        void tagWithLmStudio(
          tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          applyTabTagsBatch,
        )
        void tagWithLmStudio(
          bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          applyBookmarkTagsBatch,
        )
        void classifyIntentLmStudio(
          tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          applyTabIntentBatch,
          domainMap,
        )
        void classifyIntentLmStudio(
          bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          applyBookmarkIntentBatch,
          domainMap,
        )

      } catch {
        setLlmStatus('unavailable')
      }
      return
    }

    setLlmStatus('unavailable')
  }, [
    applyPlatformsFromDomainMap,
    applyBookmarkCategoryBatch,
    applyBookmarkClusterBatch,
    applyBookmarkIntentBatch,
    applyBookmarkTagsBatch,
    applyTabCategoryBatch,
    applyTabClusterBatch,
    applyTabIntentBatch,
    applyTabTagsBatch,
    llmSettings,
    normalizeCategoriesAfterClassification,
    runEmbeddingPass,
    setClusterNames,
    setLlmError,
    setLlmStatus,
  ])

  const handleClearCache = useCallback(async () => {
    if (!confirm('Clear all cached AI data (categories, tags, intents, embeddings)?')) return
    await clearAllAICache()
    await saveClusterNames(new Map())
    setClusterNames(new Map())
    setProjectedPoints(new Map())
    reload()
  }, [reload, setClusterNames, setProjectedPoints])

  const runDomainKnowledgePass = useCallback(async (forceRefresh: boolean) => {
    const runId = beginRun()
    if (!hasDomainKnowledgeProviderConfig(llmSettings)) {
      setLlmStatus('unavailable')
      return
    }
    const allDomains = [...new Set([
      ...tabs.map((item) => item.domain),
      ...bookmarks.map((item) => item.domain),
    ].filter(Boolean))]
    const estimatedWork = await estimateDomainEnrichmentWork(allDomains)
    const domainsLog = createTaskLogger(
      'manual-domains',
      'LLM domain knowledge',
      Math.max(estimatedWork, 1),
      onTaskProgress,
    )
    setLlmStatus('classifying')
    try {
      if (forceRefresh) await clearDomainKnowledgeCache()
      const domainMap = await enrichDomains(allDomains, llmSettings, (delta) => {
        if (!isRunActive(runId)) return
        domainsLog.progress(delta)
      })
      if (!isRunActive(runId)) return
      applyPlatformsFromDomainMap(tabs, bookmarks, domainMap)
      if (!isRunActive(runId)) return
      domainsLog.done()
      setLlmStatus('ready')
    } catch (err) {
      domainsLog.failed(err)
      if (!isRunActive(runId)) return
      setLlmError(String(err))
      setLlmStatus('error')
    } finally {
      finishRun(runId)
    }
  }, [applyPlatformsFromDomainMap, beginRun, bookmarks, finishRun, isRunActive, llmSettings, onTaskProgress, setLlmError, setLlmStatus, tabs])

  const handleRunDomainKnowledge = useCallback(async () => {
    await runDomainKnowledgePass(false)
  }, [runDomainKnowledgePass])

  const handleRedomainKnowledge = useCallback(async () => {
    if (!confirm('Rebuild domain knowledge cache? This clears only cached domain descriptions.')) return
    await runDomainKnowledgePass(true)
  }, [runDomainKnowledgePass])

  const clearCategoryCache = useCallback(async () => {
    const clearPrefix = async (
      prefix: 'tab' | 'bm',
      items: { url: string }[],
    ) => {
      await Promise.all(items.map(async (item) => {
        const existing = await getCached(prefix, item.url)
        if (!existing) return
        await setCached(prefix, item.url, {
          ...existing,
          category: '',
          parentCategory: undefined,
          clusterId: undefined,
          processedAt: Date.now(),
        })
      }))
    }

    await Promise.all([
      clearPrefix('tab', tabs),
      clearPrefix('bm', bookmarks),
    ])
  }, [bookmarks, tabs])

  const clearTagsCache = useCallback(async () => {
    const clearPrefix = async (
      prefix: 'tab' | 'bm',
      items: { url: string }[],
    ) => {
      await Promise.all(items.map(async (item) => {
        const existing = await getCached(prefix, item.url)
        if (!existing) return
        await setCached(prefix, item.url, {
          ...existing,
          tags: undefined,
          processedAt: Date.now(),
        })
      }))
    }

    await Promise.all([
      clearPrefix('tab', tabs),
      clearPrefix('bm', bookmarks),
    ])
  }, [bookmarks, tabs])

  const clearIntentCache = useCallback(async () => {
    const clearPrefix = async (
      prefix: 'tab' | 'bm',
      items: { url: string }[],
    ) => {
      await Promise.all(items.map(async (item) => {
        const existing = await getCached(prefix, item.url)
        if (!existing) return
        await setCached(prefix, item.url, {
          ...existing,
          intent: undefined,
          processedAt: Date.now(),
        })
      }))
    }

    await Promise.all([
      clearPrefix('tab', tabs),
      clearPrefix('bm', bookmarks),
    ])
  }, [bookmarks, tabs])

  const handleClassify = useCallback(async () => {
    const runId = beginRun()
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-classify-tabs', 'LLM classifying tabs', tabs.length, onTaskProgress)
    const bookmarksLog = createTaskLogger('manual-classify-bookmarks', 'LLM classifying bookmarks', bookmarks.length, onTaskProgress)
    try {
      if (llmSettings.tasks.classification.method === 'nli' && llmSettings.tasks.embedding.provider === 'transformers') {
        setLlmStatus('classifying')
        await classifyWithLmStudio(
          tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            tabsLog.progress(updates.length)
            applyTabCategoryBatch(updates)
          },
        )
        if (!isRunActive(runId)) return
        await classifyWithLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            bookmarksLog.progress(updates.length)
            applyBookmarkCategoryBatch(updates)
          },
        )
      } else if (llmSettings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        setLlmStatus('classifying')
        await classifyTabs(tabs, (updates) => {
          if (!isRunActive(runId)) return
          tabsLog.progress(updates.length)
          applyTabCategoryBatch(updates)
        })
        if (!isRunActive(runId)) return
        await classifyBookmarks(bookmarks, (updates) => {
          if (!isRunActive(runId)) return
          bookmarksLog.progress(updates.length)
          applyBookmarkCategoryBatch(updates)
        })
      } else if (hasChatProviderConfig(llmSettings)) {
        setLlmStatus('classifying')
        await classifyWithLmStudio(
          tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            tabsLog.progress(updates.length)
            applyTabCategoryBatch(updates)
          },
        )
        if (!isRunActive(runId)) return
        await classifyWithLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            bookmarksLog.progress(updates.length)
            applyBookmarkCategoryBatch(updates)
          },
        )
      } else {
        setLlmStatus('unavailable')
        return
      }

      if (!isRunActive(runId)) return
      await normalizeCategoriesAfterClassification(tabs, bookmarks)
      if (!isRunActive(runId)) return
      tabsLog.done()
      bookmarksLog.done()
      setLlmStatus('ready')
    } catch (err) {
      tabsLog.failed(err)
      bookmarksLog.failed(err)
      if (!isRunActive(runId)) return
      setLlmError(String(err))
      setLlmStatus('error')
    } finally {
      finishRun(runId)
    }
  }, [
    applyBookmarkCategoryBatch,
    applyTabCategoryBatch,
    beginRun,
    bookmarks,
    finishRun,
    isRunActive,
    llmSettings,
    normalizeCategoriesAfterClassification,
    onTaskProgress,
    setLlmError,
    setLlmStatus,
    tabs,
  ])

  const handleRunIntent = useCallback(async () => {
    const runId = beginRun()
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-intent-tabs', 'LLM intent tabs', tabs.length, onTaskProgress)
    const bookmarksLog = createTaskLogger('manual-intent-bookmarks', 'LLM intent bookmarks', bookmarks.length, onTaskProgress)

    try {
      if (llmSettings.tasks.classification.method === 'nli' && llmSettings.tasks.embedding.provider === 'transformers') {
        setLlmStatus('classifying')
        await classifyIntentLmStudio(
          tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            tabsLog.progress(updates.length)
            applyTabIntentBatch(updates)
          },
        )
        if (!isRunActive(runId)) return
        await classifyIntentLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            bookmarksLog.progress(updates.length)
            applyBookmarkIntentBatch(updates)
          },
        )
      } else if (llmSettings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        setLlmStatus('classifying')
        await classifyIntentGeminiNano(tabs, 'tab', (updates) => {
          if (!isRunActive(runId)) return
          tabsLog.progress(updates.length)
          applyTabIntentBatch(updates)
        })
        if (!isRunActive(runId)) return
        await classifyIntentGeminiNano(bookmarks, 'bm', (updates) => {
          if (!isRunActive(runId)) return
          bookmarksLog.progress(updates.length)
          applyBookmarkIntentBatch(updates)
        })
      } else if (hasChatProviderConfig(llmSettings)) {
        setLlmStatus('classifying')
        await classifyIntentLmStudio(
          tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            tabsLog.progress(updates.length)
            applyTabIntentBatch(updates)
          },
        )
        if (!isRunActive(runId)) return
        await classifyIntentLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            bookmarksLog.progress(updates.length)
            applyBookmarkIntentBatch(updates)
          },
        )
      } else {
        setLlmStatus('unavailable')
        return
      }

      if (!isRunActive(runId)) return
      tabsLog.done()
      bookmarksLog.done()
      setLlmStatus('ready')
    } catch (err) {
      tabsLog.failed(err)
      bookmarksLog.failed(err)
      if (!isRunActive(runId)) return
      setLlmError(String(err))
      setLlmStatus('error')
    } finally {
      finishRun(runId)
    }
  }, [
    applyBookmarkIntentBatch,
    applyTabIntentBatch,
    beginRun,
    bookmarks,
    finishRun,
    isRunActive,
    llmSettings,
    onTaskProgress,
    setLlmError,
    setLlmStatus,
    tabs,
  ])

  const handlePass2 = useCallback(async () => {
    if (!hasChatProviderConfig(llmSettings)) return
    setLlmStatus('normalizing')
    try {
      const allLabels = [...new Set(tabs.map(t => t.category).filter(Boolean) as string[])]
      if (allLabels.length <= 1) { setLlmStatus('ready'); return }

      console.group('[Pass 2] Merge categories')
      console.log('Input labels:', allLabels)

      const mergeMap = await normalizeCategoryLabels(allLabels, llmSettings)
      console.log('Merge map:', mergeMap)

      const changes = Object.entries(mergeMap).filter(([from, to]) => from !== to)
      console.log('Changes:', changes)

      setTabs(prev =>
        prev.map(t => ({
          ...t,
          category: t.category ? mergeMap[t.category] ?? t.category : t.category,
          parentCategory: t.category ? mergeMap[t.category] ?? t.category : t.parentCategory,
        })),
      )

      const affectedCount = tabs.filter(t => t.category && mergeMap[t.category] !== t.category).length
      console.log(`Affected ${affectedCount} tabs`)

      await Promise.all(
        Object.entries(mergeMap)
          .filter(([from, to]) => from !== to)
          .flatMap(([from, to]) =>
            tabs.filter(t => t.category === from).map(t =>
              setCached('tab', t.url, { category: to, parentCategory: to, processedAt: Date.now() }),
            ),
          ),
      )

      if (changes.length === 0) {
        console.log('No merges needed')
      }

      console.groupEnd()
    } catch (err) {
      console.error('[Pass 2] Failed:', err)
    }
    setLlmStatus('ready')
  }, [llmSettings, setLlmStatus, setTabs, tabs])

  const handlePass3 = useCallback(async () => {
    if (!hasChatProviderConfig(llmSettings)) return
    setLlmStatus('normalizing')
    try {
      const allDomains = [...new Set(tabs.map((item) => item.domain).filter(Boolean))]
      const domainMap = await enrichDomains(allDomains, llmSettings)
      const embeddings = await loadCachedEmbeddings()
      const categoryCounts = new Map<string, number>()
      for (const t of tabs) {
        if (t.category) categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1)
      }
      const large = [...categoryCounts.entries()].filter(([, c]) => c > 15)
      console.group('[Pass 3] Split large categories')
      console.log('Categories to split:', large)

      await splitLargeClusters(
        tabs.map(t => ({
          url: t.url,
          title: t.title,
          domain: t.domain,
          category: t.category ?? '',
        })),
        'tab',
        llmSettings,
        (updates) => {
          console.log('Split batch updates:', updates.map(u => u.category))
          applyTabCategoryBatch(updates)
        },
        domainMap,
        embeddings,
      )
      const tabCategoryItems = (await Promise.all(
        tabs.map(async (tab) => {
          const entry = await getCached('tab', tab.url)
          const category = entry?.category?.trim()
          return category ? { url: tab.url, category } : null
        }),
      )).filter((item): item is { url: string; category: string } => Boolean(item))
      const rareUpdates = await groupRareCategories(tabCategoryItems, 'tab', llmSettings)
      if (rareUpdates.length > 0) applyTabCategoryBatch(rareUpdates)
      console.groupEnd()
    } catch (err) {
      console.error('[Pass 3] Failed:', err)
    }
    setLlmStatus('ready')
  }, [applyTabCategoryBatch, llmSettings, setLlmStatus, tabs])

  const handleRunTags = useCallback(async () => {
    const runId = beginRun()
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-tags-tabs', 'LLM tagging tabs', tabs.length, onTaskProgress)
    const bookmarksLog = createTaskLogger('manual-tags-bookmarks', 'LLM tagging bookmarks', bookmarks.length, onTaskProgress)

    try {
      if (llmSettings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        setLlmStatus('classifying')
        await tagWithGeminiNano(tabs, 'tab', (updates) => {
          if (!isRunActive(runId)) return
          tabsLog.progress(updates.length)
          applyTabTagsBatch(updates)
        })
        if (!isRunActive(runId)) return
        await tagWithGeminiNano(bookmarks, 'bm', (updates) => {
          if (!isRunActive(runId)) return
          bookmarksLog.progress(updates.length)
          applyBookmarkTagsBatch(updates)
        })
      } else if (hasChatProviderConfig(llmSettings)) {
        setLlmStatus('classifying')
        await tagWithLmStudio(
          tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            tabsLog.progress(updates.length)
            applyTabTagsBatch(updates)
          },
        )
        if (!isRunActive(runId)) return
        await tagWithLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            if (!isRunActive(runId)) return
            bookmarksLog.progress(updates.length)
            applyBookmarkTagsBatch(updates)
          },
        )
      } else {
        setLlmStatus('unavailable')
        return
      }

      if (!isRunActive(runId)) return
      tabsLog.done()
      bookmarksLog.done()
      setLlmStatus('ready')
    } catch (err) {
      tabsLog.failed(err)
      bookmarksLog.failed(err)
      if (!isRunActive(runId)) return
      setLlmError(String(err))
      setLlmStatus('error')
    } finally {
      finishRun(runId)
    }
  }, [
    applyBookmarkTagsBatch,
    applyTabTagsBatch,
    beginRun,
    bookmarks,
    finishRun,
    isRunActive,
    llmSettings,
    onTaskProgress,
    setLlmError,
    setLlmStatus,
    tabs,
  ])

  const handlePostProcessCategories = useCallback(async () => {
    const runId = beginRun()
    if (!hasChatProviderConfig(llmSettings)) {
      setLlmStatus('unavailable')
      finishRun(runId)
      return
    }
    setLlmStatus('normalizing')
    try {
      await normalizeCategoriesAfterClassification(tabs, bookmarks)
      if (!isRunActive(runId)) return
      setLlmStatus('ready')
    } catch (err) {
      if (!isRunActive(runId)) return
      setLlmError(String(err))
      setLlmStatus('error')
    } finally {
      finishRun(runId)
    }
  }, [
    beginRun,
    bookmarks,
    finishRun,
    isRunActive,
    llmSettings,
    normalizeCategoriesAfterClassification,
    setLlmError,
    setLlmStatus,
    tabs,
  ])

  const handleReclassify = useCallback(async () => {
    if (!confirm('Re-classify all pages? This clears only cached categories and cluster assignments.')) return
    await clearCategoryCache()
      setTabs((prev) => prev.map((item) => ({ ...item, category: undefined, parentCategory: undefined, clusterId: undefined })))
      setBookmarks((prev) => prev.map((item) => ({ ...item, category: undefined, parentCategory: undefined, clusterId: undefined })))
    setClusterNames(new Map())
    await saveClusterNames(new Map())
    await handleClassify()
  }, [clearCategoryCache, handleClassify, setBookmarks, setClusterNames, setTabs])

  const handleRetag = useCallback(async () => {
    if (!confirm('Re-run tags for all pages? This clears only cached tags.')) return
    await clearTagsCache()
    setTabs((prev) => prev.map((item) => ({ ...item, tags: undefined })))
    setBookmarks((prev) => prev.map((item) => ({ ...item, tags: undefined })))
    await handleRunTags()
  }, [clearTagsCache, handleRunTags, setBookmarks, setTabs])

  const handleReintent = useCallback(async () => {
    if (!confirm('Re-run intent classification for all pages? This clears only cached intents.')) return
    await clearIntentCache()
    setTabs((prev) => prev.map((item) => ({ ...item, intent: undefined })))
    setBookmarks((prev) => prev.map((item) => ({ ...item, intent: undefined })))
    await handleRunIntent()
  }, [clearIntentCache, handleRunIntent, setBookmarks, setTabs])

  const handleReembedAll = useCallback(async () => {
    if (!confirm('Re-embed all pages using the new text format? This clears cached embeddings first.')) return
    await clearEmbeddingCache()
    setProjectedPoints(new Map())
    await runEmbeddingPass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, runEmbeddingPass, setProjectedPoints, tabs])

  return {
    applyTabCategoryBatch,
    applyBookmarkCategoryBatch,
    applyTabTagsBatch,
    applyBookmarkTagsBatch,
    applyTabIntentBatch,
    applyBookmarkIntentBatch,
    runEmbeddingPass,
    runAutoAiPipeline,
    handleClearCache,
    handleClassify,
    handleRunDomainKnowledge,
    handleRedomainKnowledge,
    handleReclassify,
    handleRunIntent,
    handleReintent,
    handlePass2,
    handlePass3,
    handlePostProcessCategories,
    handleRunTags,
    handleRetag,
    handleReembedAll,
    handleStopPipeline,
  }
}
