import { useCallback, useEffect, useRef, useState } from 'react'
import { applyCategoryUpdates, applyClusterIdUpdates, applyIntentUpdates, applyTagsUpdates } from '@/lib/pipeline/apply-updates'
import { saveClusterNames } from '@/lib/ai/cluster-names'
import { clearEmbeddingCache } from '@/lib/ai/embedder'
import { PipelineOrchestrator } from '@/lib/pipeline/pipeline-orchestrator'
import { detectPlatform } from '@/lib/core/platform-detection'
import { clearAllAICache, getCached, setCached } from '@/lib/core/storage'
import { normalizeUrlForCache } from '@/lib/core/url-utils'
import type { BookmarkItem, CacheEntry, KnownPlatform, LlmSettings, PageIntent, TabItem } from '@/lib/core/types'

interface UseAiPipelinesArgs {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  llmSettings: LlmSettings
  setBookmarks: React.Dispatch<React.SetStateAction<BookmarkItem[]>>
  setTabs: React.Dispatch<React.SetStateAction<TabItem[]>>
  setLlmError: (msg: string | undefined) => void
  setClusterNames: React.Dispatch<React.SetStateAction<Map<number, string>>>
  setProjectedPoints: React.Dispatch<React.SetStateAction<Map<string, [number, number]>>>
  reload: () => void
}

export function useAiPipelines({
  bookmarks,
  tabs,
  llmSettings,
  setBookmarks,
  setTabs,
  setLlmError,
  setClusterNames,
  setProjectedPoints,
  reload,
}: UseAiPipelinesArgs) {
  const tabsRef = useRef<TabItem[]>(tabs)
  const bookmarksRef = useRef<BookmarkItem[]>(bookmarks)
  const [orchestrator, setOrchestrator] = useState<PipelineOrchestrator | null>(null)
  const orchestratorRef = useRef<PipelineOrchestrator | null>(null)

  tabsRef.current = tabs
  bookmarksRef.current = bookmarks

  const handleStopPipeline = useCallback(async () => {
    orchestratorRef.current?.cancelCurrent()
    setLlmError('Pipeline stopped by user')
  }, [setLlmError])

  const applyTabCategoryBatch = useCallback((updates: { url: string; category: string; parentCategory?: string }[]) => {
    setTabs((prev) => applyCategoryUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkCategoryBatch = useCallback((updates: { url: string; category: string; parentCategory?: string }[]) => {
    setBookmarks((prev) => applyCategoryUpdates(prev, updates))
  }, [setBookmarks])

  const applyTabTagsBatch = useCallback((updates: { url: string; tags: string[] }[]) => {
    setTabs((prev) => applyTagsUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkTagsBatch = useCallback((updates: { url: string; tags: string[] }[]) => {
    setBookmarks((prev) => applyTagsUpdates(prev, updates))
  }, [setBookmarks])

  const applyTabIntentBatch = useCallback((updates: { url: string; intent: PageIntent | undefined }[]) => {
    setTabs((prev) => applyIntentUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkIntentBatch = useCallback((updates: { url: string; intent: PageIntent | undefined }[]) => {
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
    domainMap: Map<string, import('@/lib/ai/domain-enricher').DomainInfo>,
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

  const applyPlatformsFromCurrentDomainMap = useCallback((domainMap: Map<string, import('@/lib/ai/domain-enricher').DomainInfo>) => {
    applyPlatformsFromDomainMap(tabsRef.current, bookmarksRef.current, domainMap)
  }, [applyPlatformsFromDomainMap])

  useEffect(() => {
    const orchestrator = new PipelineOrchestrator({
      onCategoryUpdate: (updates) => {
        applyTabCategoryBatch(updates)
        applyBookmarkCategoryBatch(updates)
      },
      onTagsUpdate: (updates) => {
        applyTabTagsBatch(updates)
        applyBookmarkTagsBatch(updates)
      },
      onIntentUpdate: (updates) => {
        applyTabIntentBatch(updates)
        applyBookmarkIntentBatch(updates)
      },
      onClusterUpdate: (updates) => {
        applyTabClusterBatch(updates)
        applyBookmarkClusterBatch(updates)
      },
      onClusterNames: (names) => {
        setClusterNames((prev) => {
          const next = new Map(prev)
          for (const [clusterId, name] of names.entries()) next.set(clusterId, name)
          void saveClusterNames(next)
          return next
        })
      },
      onProjectedPoints: (points) => {
        setProjectedPoints(points)
      },
      onDomainMap: (domainMap) => {
        applyPlatformsFromCurrentDomainMap(domainMap)
      },
    })

    const unsubscribe = orchestrator.subscribe((event) => {
      if (event.type === 'pipeline-failed') {
        setLlmError(event.error)
        return
      }
      if (event.type === 'pipeline-start') {
        setLlmError(undefined)
      }
    })

    orchestratorRef.current = orchestrator
    setOrchestrator(orchestrator)
    return () => {
      unsubscribe()
      orchestratorRef.current = null
      setOrchestrator(null)
    }
  }, [
    applyBookmarkCategoryBatch,
    applyBookmarkClusterBatch,
    applyBookmarkIntentBatch,
    applyBookmarkTagsBatch,
    applyPlatformsFromCurrentDomainMap,
    applyTabCategoryBatch,
    applyTabClusterBatch,
    applyTabIntentBatch,
    applyTabTagsBatch,
    setClusterNames,
    setLlmError,
    setProjectedPoints,
  ])

  const runEmbeddingPass = useCallback(async (
    tb: TabItem[],
    bm: BookmarkItem[],
    settings: LlmSettings,
  ) => {
    const allItems = [
      ...tb.map(t => ({ url: t.url, title: t.title || t.url, domain: t.domain, category: t.category })),
      ...bm.map(b => ({ url: b.url, title: b.title || b.url, domain: b.domain, category: b.category })),
    ]
    orchestratorRef.current?.enqueueEmbeddingPass(allItems, settings)
  }, [])

  const runAutoAiPipeline = useCallback(async (
    tb: TabItem[],
    bm: BookmarkItem[],
    _tabsWithCache: TabItem[],
  ) => {
    orchestratorRef.current?.enqueueAutoRun(tb, bm, llmSettings)
  }, [llmSettings])

  const handleClearCache = useCallback(async () => {
    if (!confirm('Clear all cached AI data (categories, tags, intents, embeddings)?')) return
    await clearAllAICache()
    await saveClusterNames(new Map())
    setClusterNames(new Map())
    setProjectedPoints(new Map())
    reload()
  }, [reload, setClusterNames, setProjectedPoints])

  const runDomainKnowledgePass = useCallback(async (forceRefresh: boolean) => {
    const allDomains = [...new Set([
      ...tabs.map((item) => item.domain),
      ...bookmarks.map((item) => item.domain),
    ].filter(Boolean))]
    orchestratorRef.current?.enqueueDomainPass(allDomains, llmSettings, forceRefresh)
  }, [bookmarks, llmSettings, tabs])

  const handleRunDomainKnowledge = useCallback(async () => {
    await runDomainKnowledgePass(false)
  }, [runDomainKnowledgePass])

  const handleRedomainKnowledge = useCallback(async () => {
    if (!confirm('Rebuild domain knowledge cache? This clears only cached domain descriptions.')) return
    await runDomainKnowledgePass(true)
  }, [runDomainKnowledgePass])

  const clearCacheFields = useCallback(async (
    tabItems: { url: string }[],
    bookmarkItems: { url: string }[],
    fields: Partial<CacheEntry>,
  ) => {
    const urls = [...new Set([...tabItems, ...bookmarkItems].map((item) => normalizeUrlForCache(item.url)))]
    await Promise.all(urls.map(async (url) => {
      const existing = await getCached(url)
      if (!existing) return
      await setCached(url, {
        ...existing,
        ...fields,
        processedAt: Date.now(),
      })
    }))
  }, [])

  const clearCategoryCache = useCallback(async () => {
    await clearCacheFields(tabs, bookmarks, {
      category: '',
      parentCategory: undefined,
      clusterId: undefined,
    })
  }, [bookmarks, clearCacheFields, tabs])

  const clearTagsCache = useCallback(async () => {
    await clearCacheFields(tabs, bookmarks, {
      tags: undefined,
    })
  }, [bookmarks, clearCacheFields, tabs])

  const clearIntentCache = useCallback(async () => {
    await clearCacheFields(tabs, bookmarks, {
      intent: undefined,
    })
  }, [bookmarks, clearCacheFields, tabs])

  const handleClassify = useCallback(async () => {
    orchestratorRef.current?.enqueueClassifyPass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, tabs])

  const handleRunIntent = useCallback(async () => {
    orchestratorRef.current?.enqueueIntentPass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, tabs])

  const handleRunTags = useCallback(async () => {
    orchestratorRef.current?.enqueueTagsPass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, tabs])

  const handlePostProcessCategories = useCallback(async () => {
    orchestratorRef.current?.enqueuePostProcessPass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, tabs])

  const handleNormalizeCategories = useCallback(async () => {
    orchestratorRef.current?.enqueueNormalizePass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, tabs])

  const handleGroupRareCategories = useCallback(async () => {
    orchestratorRef.current?.enqueueGroupRarePass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, tabs])

  const handleSplitCategories = useCallback(async () => {
    orchestratorRef.current?.enqueueSplitPass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, tabs])

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
    orchestrator,
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
    handlePostProcessCategories,
    handleNormalizeCategories,
    handleGroupRareCategories,
    handleSplitCategories,
    handleRunTags,
    handleRetag,
    handleReembedAll,
    handleStopPipeline,
  }
}
