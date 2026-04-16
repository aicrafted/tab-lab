import { checkLlmAvailability, classifyItems, groupRareCategories, normalizeCategoryLabels, splitLargeClusters } from '../ai/classifier'
import { clearDomainKnowledgeCache, enrichDomains, estimateDomainEnrichmentWork, type DomainInfo } from '../ai/domain-enricher'
import { fetchAndCacheEmbeddings, fetchEmbeddingsBatch, loadEmbeddingsForCurrentModel, reprojectAllEmbeddings } from '../ai/embedder'
import { classifyIntentGeminiNano, classifyIntentLmStudio } from '../ai/intent'
import { aiPipelineLog } from '../core/logger'
import { getCached, setCached } from '../core/storage'
import { tagWithGeminiNano, tagWithLmStudio } from '../ai/tagger'
import type { BookmarkItem, LlmSettings, TabItem } from '../core/types'
import { ClusteringStrategy } from './clustering-strategy'
import type { PipelineCallbacks, RunContext } from './types'
import { TASK_IDS } from './types'
import type { TaskRegistry } from './task-registry'
import { getTaxonomyContext, hasChatProviderConfig, hasDomainKnowledgeProviderConfig, hasEmbeddingProviderConfig } from './utils'

const BOOKMARK_CLUSTER_OFFSET = 10_000

export class PipelineRunner {
  private readonly clustering: ClusteringStrategy

  constructor(
    private readonly registry: TaskRegistry,
    private readonly callbacks: PipelineCallbacks,
  ) {
    this.clustering = new ClusteringStrategy(callbacks, (id) => this.isRunActive(id))
  }

  private currentRun: RunContext | null = null

  setCurrentRun(run: RunContext | null) {
    this.currentRun = run
  }

  isRunActive(runId: number): boolean {
    return Boolean(this.currentRun && this.currentRun.runId === runId && !this.currentRun.cancelled)
  }

  async executeAutoPipeline(
    runId: number,
    tabs: TabItem[],
    bookmarks: BookmarkItem[],
    settings: LlmSettings,
  ): Promise<void> {
    const nanoStatus = await checkLlmAvailability(settings)
    aiPipelineLog.info('orchestrator auto evaluate provider', {
      provider: settings.tasks.chat.provider,
      status: nanoStatus,
      tabs: tabs.length,
      bookmarks: bookmarks.length,
    })

    const useNli = settings.tasks.classification.method === 'nli' && hasEmbeddingProviderConfig(settings)

    if (useNli) {
      await this.runAutoClusterFlow(runId, tabs, bookmarks, settings)
      return
    }
    if (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      await this.runAutoGeminiFlow(runId, tabs, bookmarks, settings)
      return
    }
    if (hasChatProviderConfig(settings)) {
      await this.runAutoClusterFlow(runId, tabs, bookmarks, settings)
      return
    }
    throw new Error('LLM unavailable')
  }

  async runAutoClusterFlow(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const allItems = [
      ...tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
      ...bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
    ]
    const allDomains = [...new Set(allItems.map((item) => item.domain).filter(Boolean))]
    const estimatedDomainWork = await estimateDomainEnrichmentWork(allDomains, settings)
    
    const domainsTask = this.registry.registerTask(TASK_IDS.DOMAINS, 'Auto domain knowledge', Math.max(estimatedDomainWork, 1))
    const embeddingsTask = this.registry.registerTask(TASK_IDS.EMBEDDINGS, 'Auto embeddings', allItems.length)
    const tabsTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'Auto cluster tabs', tabs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'Auto cluster bookmarks', bookmarks.length)

    const domainMap = await enrichDomains(allDomains, settings, (delta) => {
      if (!this.isRunActive(runId)) return
      domainsTask.progress(delta)
    }, this.currentRun?.abortController.signal)
    
    if (!this.isRunActive(runId)) {
      domainsTask.cancel(); embeddingsTask.cancel(); tabsTask.cancel(); bookmarksTask.cancel()
      return
    }
    domainsTask.done()
    this.callbacks.onDomainMap(domainMap)

    const embeddings = await fetchAndCacheEmbeddings(allItems, settings, (updates) => {
      if (!this.isRunActive(runId)) return
      embeddingsTask.progress(updates.length)
    }, domainMap, this.currentRun?.abortController.signal)
    
    if (!this.isRunActive(runId)) {
      embeddingsTask.cancel(); tabsTask.cancel(); bookmarksTask.cancel()
      return
    }
    embeddingsTask.done()

    const tabItems = tabs
      .map((t) => ({ url: t.url, title: t.title, domain: t.domain, embedding: embeddings.get(t.url) }))
      .filter((item): item is { url: string; title: string; domain: string; embedding: number[] } => Boolean(item.embedding))

    if (tabItems.length > 0) {
      await this.clustering.runTwoPassClustering(runId, tabItems, 'tab', settings, tabsTask, domainMap, 0, this.currentRun?.abortController.signal)
    }
    tabsTask.done()

    const bookmarkItems = bookmarks
      .map((b) => ({ url: b.url, title: b.title, domain: b.domain, embedding: embeddings.get(b.url) }))
      .filter((item): item is { url: string; title: string; domain: string; embedding: number[] } => Boolean(item.embedding))

    if (bookmarkItems.length > 0) {
      await this.clustering.runTwoPassClustering(runId, bookmarkItems, 'bm', settings, bookmarksTask, domainMap, BOOKMARK_CLUSTER_OFFSET, this.currentRun?.abortController.signal)
    }
    bookmarksTask.done()

    const normalizeTask = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 2)
    await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
    normalizeTask.progress(2)
    normalizeTask.done()

    await this.runTagsAndIntents(runId, tabs, bookmarks, settings, domainMap)
  }

  async runAutoGeminiFlow(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const tabsTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'Auto classify tabs', tabs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'Auto classify bookmarks', bookmarks.length)

    const { candidates, taxonomyCentroidsMap } = await getTaxonomyContext()

    await classifyItems(
      tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
      'tab',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        tabsTask.progress(updates.length)
        this.callbacks.onCategoryUpdate(updates, 'tab')
      }, undefined, this.currentRun?.abortController.signal, taxonomyCentroidsMap, candidates)
    
    if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
    tabsTask.done()

    await classifyItems(
      bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
      'bm',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        bookmarksTask.progress(updates.length)
        this.callbacks.onCategoryUpdate(updates, 'bm')
      }, undefined, this.currentRun?.abortController.signal, taxonomyCentroidsMap, candidates)
    
    if (!this.isRunActive(runId)) { bookmarksTask.cancel(); return }
    bookmarksTask.done()

    const normalizeTask = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 2)
    await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
    normalizeTask.progress(2)
    normalizeTask.done()

    await this.runTagsAndIntents(runId, tabs, bookmarks, settings)
  }

  async runTagsAndIntents(
    runId: number,
    tabs: TabItem[],
    bookmarks: BookmarkItem[],
    settings: LlmSettings,
    domainMap?: Map<string, DomainInfo>,
  ): Promise<void> {
    const tagsTabsTask = this.registry.registerTask(TASK_IDS.TAGS_TABS, 'Tags tabs', tabs.length)
    const tagsBookmarksTask = this.registry.registerTask(TASK_IDS.TAGS_BOOKMARKS, 'Tags bookmarks', bookmarks.length)
    const intentTabsTask = this.registry.registerTask(TASK_IDS.INTENT_TABS, 'Intent tabs', tabs.length)
    const intentBookmarksTask = this.registry.registerTask(TASK_IDS.INTENT_BOOKMARKS, 'Intent bookmarks', bookmarks.length)

    if (settings.tasks.chat.provider === 'gemini-nano') {
      await tagWithGeminiNano(tabs, 'tab', (updates) => {
        if (!this.isRunActive(runId)) return
        tagsTabsTask.progress(updates.length)
        this.callbacks.onTagsUpdate(updates, 'tab')
      }, this.currentRun?.abortController.signal)
      tagsTabsTask.done()
      await tagWithGeminiNano(bookmarks, 'bm', (updates) => {
        if (!this.isRunActive(runId)) return
        tagsBookmarksTask.progress(updates.length)
        this.callbacks.onTagsUpdate(updates, 'bm')
      }, this.currentRun?.abortController.signal)
      tagsBookmarksTask.done()

      await classifyIntentGeminiNano(tabs, 'tab', (updates) => {
        if (!this.isRunActive(runId)) return
        intentTabsTask.progress(updates.length)
        this.callbacks.onIntentUpdate(updates, 'tab')
      }, this.currentRun?.abortController.signal)
      intentTabsTask.done()
      await classifyIntentGeminiNano(bookmarks, 'bm', (updates) => {
        if (!this.isRunActive(runId)) return
        intentBookmarksTask.progress(updates.length)
        this.callbacks.onIntentUpdate(updates, 'bm')
      }, this.currentRun?.abortController.signal)
      intentBookmarksTask.done()
      return
    }

    await tagWithLmStudio(
      tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
      'tab',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        tagsTabsTask.progress(updates.length)
        this.callbacks.onTagsUpdate(updates, 'tab')
      }, this.currentRun?.abortController.signal)
    tagsTabsTask.done()
    
    await tagWithLmStudio(
      bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
      'bm',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        tagsBookmarksTask.progress(updates.length)
        this.callbacks.onTagsUpdate(updates, 'bm')
      }, this.currentRun?.abortController.signal)
    tagsBookmarksTask.done()

    await classifyIntentLmStudio(
      tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
      'tab',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        intentTabsTask.progress(updates.length)
        this.callbacks.onIntentUpdate(updates, 'tab')
      }, domainMap, this.currentRun?.abortController.signal)
    intentTabsTask.done()
    
    await classifyIntentLmStudio(
      bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
      'bm',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        intentBookmarksTask.progress(updates.length)
        this.callbacks.onIntentUpdate(updates, 'bm')
      }, domainMap, this.currentRun?.abortController.signal)
    intentBookmarksTask.done()
  }

  async normalizeCategoriesAfterClassification(tabItems: { url: string }[], bookmarkItems: { url: string }[], settings: LlmSettings): Promise<void> {
    const [tabEntries, bookmarkEntries] = await Promise.all([
      Promise.all(tabItems.map(async (item) => ({ url: item.url, entry: await getCached('tab', item.url) }))),
      Promise.all(bookmarkItems.map(async (item) => ({ url: item.url, entry: await getCached('bm', item.url) }))),
    ])

    const labels = [...new Set([
      ...tabEntries.map(({ entry }) => entry?.category).filter(Boolean),
      ...bookmarkEntries.map(({ entry }) => entry?.category).filter(Boolean),
    ] as string[])]
    if (labels.length <= 1) return

    const mergeMap = await normalizeCategoryLabels(labels, settings)
    const tabUpdates: { url: string; category: string }[] = []
    const bookmarkUpdates: { url: string; category: string }[] = []
    const cacheWrites: Promise<void>[] = []

    for (const { url, entry } of tabEntries) {
      const from = entry?.category
      if (!from) continue
      const to = mergeMap[from] ?? from
      if (to === from) continue
      tabUpdates.push({ url, category: to })
      cacheWrites.push(setCached('tab', url, { ...entry, category: to, processedAt: Date.now() }))
    }
    for (const { url, entry } of bookmarkEntries) {
      const from = entry?.category
      if (!from) continue
      const to = mergeMap[from] ?? from
      if (to === from) continue
      bookmarkUpdates.push({ url, category: to })
      cacheWrites.push(setCached('bm', url, { ...entry, category: to, processedAt: Date.now() }))
    }

    await Promise.all(cacheWrites)
    if (tabUpdates.length > 0) this.callbacks.onCategoryUpdate(tabUpdates, 'tab')
    if (bookmarkUpdates.length > 0) this.callbacks.onCategoryUpdate(bookmarkUpdates, 'bm')

    const tabCategoryItems = tabEntries
      .map(({ url, entry }) => (entry?.category ? ({ url, category: mergeMap[entry.category] ?? entry.category }) : null))
      .filter((item): item is { url: string; category: string } => Boolean(item))
    const bookmarkCategoryItems = bookmarkEntries
      .map(({ url, entry }) => (entry?.category ? ({ url, category: mergeMap[entry.category] ?? entry.category }) : null))
      .filter((item): item is { url: string; category: string } => Boolean(item))

    const [rareTabUpdates, rareBookmarkUpdates] = await Promise.all([
      groupRareCategories(tabCategoryItems, 'tab', settings),
      groupRareCategories(bookmarkCategoryItems, 'bm', settings),
    ])
    if (rareTabUpdates.length > 0) this.callbacks.onCategoryUpdate(rareTabUpdates, 'tab')
    if (rareBookmarkUpdates.length > 0) this.callbacks.onCategoryUpdate(rareBookmarkUpdates, 'bm')
  }

  async startStandaloneClassifyRun(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const tabsTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'LLM classifying tabs', tabs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'LLM classifying bookmarks', bookmarks.length)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      const useNli = settings.tasks.classification.method === 'nli' && hasEmbeddingProviderConfig(settings)
      const { candidates, taxonomyCentroidsMap } = await getTaxonomyContext()

      if (useNli || (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) || hasChatProviderConfig(settings)) {
        await classifyItems(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onCategoryUpdate(updates, 'tab')
          }, undefined, this.currentRun?.abortController.signal, taxonomyCentroidsMap, candidates)
        
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        
        await classifyItems(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onCategoryUpdate(updates, 'bm')
          }, undefined, this.currentRun?.abortController.signal, taxonomyCentroidsMap, candidates)
      } else {
        throw new Error('LLM unavailable')
      }

      if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
      tabsTask.done()
      bookmarksTask.done()

      const normalizeTask = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 2)
      await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
      normalizeTask.progress(2)
      normalizeTask.done()
    } catch (err) {
      tabsTask.failed(err)
      bookmarksTask.failed(err)
      throw err
    }
  }

  async startStandaloneTagsRun(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const tabsTask = this.registry.registerTask(TASK_IDS.TAGS_TABS, 'LLM tagging tabs', tabs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.TAGS_BOOKMARKS, 'LLM tagging bookmarks', bookmarks.length)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      if (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        await tagWithGeminiNano(tabs, 'tab', (updates) => {
          if (!this.isRunActive(runId)) return
          tabsTask.progress(updates.length)
          this.callbacks.onTagsUpdate(updates, 'tab')
        }, this.currentRun?.abortController.signal)
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await tagWithGeminiNano(bookmarks, 'bm', (updates) => {
          if (!this.isRunActive(runId)) return
          bookmarksTask.progress(updates.length)
          this.callbacks.onTagsUpdate(updates, 'bm')
        }, this.currentRun?.abortController.signal)
      } else if (hasChatProviderConfig(settings)) {
        await tagWithLmStudio(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onTagsUpdate(updates, 'tab')
          }, this.currentRun?.abortController.signal)
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await tagWithLmStudio(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onTagsUpdate(updates, 'bm')
          }, this.currentRun?.abortController.signal)
      } else {
        throw new Error('LLM unavailable')
      }

      if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
      tabsTask.done()
      bookmarksTask.done()
    } catch (err) {
      tabsTask.failed(err)
      bookmarksTask.failed(err)
      throw err
    }
  }

  async startStandaloneIntentRun(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const tabsTask = this.registry.registerTask(TASK_IDS.INTENT_TABS, 'LLM intent tabs', tabs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.INTENT_BOOKMARKS, 'LLM intent bookmarks', bookmarks.length)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      const useNli = settings.tasks.classification.method === 'nli' && hasEmbeddingProviderConfig(settings)
      
      if (useNli) {
        await classifyIntentLmStudio(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates, 'tab')
          }, undefined, this.currentRun?.abortController.signal)
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyIntentLmStudio(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates, 'bm')
          }, undefined, this.currentRun?.abortController.signal)
      } else if (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        await classifyIntentGeminiNano(tabs, 'tab', (updates) => {
          if (!this.isRunActive(runId)) return
          tabsTask.progress(updates.length)
          this.callbacks.onIntentUpdate(updates, 'tab')
        }, this.currentRun?.abortController.signal)
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyIntentGeminiNano(bookmarks, 'bm', (updates) => {
          if (!this.isRunActive(runId)) return
          bookmarksTask.progress(updates.length)
          this.callbacks.onIntentUpdate(updates, 'bm')
        }, this.currentRun?.abortController.signal)
      } else if (hasChatProviderConfig(settings)) {
        await classifyIntentLmStudio(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates, 'tab')
          }, undefined, this.currentRun?.abortController.signal)
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyIntentLmStudio(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates, 'bm')
          }, undefined, this.currentRun?.abortController.signal)
      } else {
        throw new Error('LLM unavailable')
      }

      if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
      tabsTask.done()
      bookmarksTask.done()
    } catch (err) {
      tabsTask.failed(err)
      bookmarksTask.failed(err)
      throw err
    }
  }

  async startStandaloneNormalizeRun(_runId: number, tabs: TabItem[], settings: LlmSettings): Promise<void> {
    const task = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 1)
    try {
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')

      const allLabels = [...new Set(tabs.map((t) => t.category).filter(Boolean) as string[])]
      if (allLabels.length <= 1) {
        task.done()
        return
      }

      aiPipelineLog.info('pass2 merge categories start', { totalLabels: allLabels.length, labels: allLabels })
      const mergeMap = await normalizeCategoryLabels(allLabels, settings)
      const updates = tabs
        .filter((t) => Boolean(t.category))
        .map((t) => {
          const from = t.category as string
          const to = mergeMap[from] ?? from
          return from === to ? null : { url: t.url, category: to }
        })
        .filter((item): item is { url: string; category: string } => Boolean(item))
      const writes = updates.map((u) => setCached('tab', u.url, { category: u.category, processedAt: Date.now() }))
      await Promise.all(writes)
      if (updates.length > 0) this.callbacks.onCategoryUpdate(updates, 'tab')
      aiPipelineLog.info('pass2 merge categories done', { changes: updates.length })
      task.done()
    } catch (err) {
      task.failed(err)
      throw err
    }
  }

  async startStandaloneSplitRun(runId: number, tabs: TabItem[], settings: LlmSettings): Promise<void> {
    const task = this.registry.registerTask('split-large-categories', 'Split large categories', 1)
    try {
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')
      const allDomains = [...new Set(tabs.map((item) => item.domain).filter(Boolean))]
      const domainMap = await enrichDomains(allDomains, settings)
      const embeddings = await loadEmbeddingsForCurrentModel(settings)
      await splitLargeClusters(
        tabs.map((t) => ({
          url: t.url,
          title: t.title,
          domain: t.domain,
          category: t.category ?? '',
        })),
        'tab',
        settings,
        (updates) => {
          if (!this.isRunActive(runId)) return
          this.callbacks.onCategoryUpdate(updates, 'tab')
        },
        domainMap,
        embeddings,
        this.currentRun?.abortController.signal,
      )

      const tabCategoryItems = (await Promise.all(
        tabs.map(async (tab) => {
          const entry = await getCached('tab', tab.url)
          const category = entry?.category?.trim()
          return category ? { url: tab.url, category } : null
        }),
      )).filter((item): item is { url: string; category: string } => Boolean(item))
      const rareUpdates = await groupRareCategories(tabCategoryItems, 'tab', settings)
      if (rareUpdates.length > 0) this.callbacks.onCategoryUpdate(rareUpdates, 'tab')

      task.done()
    } catch (err) {
      task.failed(err)
      throw err
    }
  }

  async startStandalonePostProcessRun(_runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const task = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Post-process categories', 1)
    try {
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')
      await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
      task.done()
    } catch (err) {
      task.failed(err)
      throw err
    }
  }

  async startStandaloneEmbeddingRun(_runId: number, items: { url: string; title: string; domain: string; category?: string }[], settings: LlmSettings): Promise<void> {
    const task = this.registry.registerTask(TASK_IDS.EMBEDDINGS, 'LLM calc embeddings', items.length)
    try {
      if (!hasEmbeddingProviderConfig(settings)) throw new Error('Embedding provider unavailable')
      await fetchEmbeddingsBatch(items, settings, (updates) => task.progress(updates.length), this.currentRun?.abortController.signal)
      const points = await reprojectAllEmbeddings(settings)
      this.callbacks.onProjectedPoints(points)
      task.done()
    } catch (err) {
      task.failed(err)
      throw err
    }
  }

  async startStandaloneDomainRun(_runId: number, domains: string[], settings: LlmSettings, force: boolean): Promise<void> {
    const estimatedWork = await estimateDomainEnrichmentWork(domains, settings)
    const task = this.registry.registerTask(TASK_IDS.DOMAINS, 'LLM domain knowledge', Math.max(estimatedWork, 1))
    try {
      if (!hasDomainKnowledgeProviderConfig(settings)) throw new Error('Domain enrichment provider unavailable')
      if (force) await clearDomainKnowledgeCache()
      const domainMap = await enrichDomains(domains, settings, (delta) => task.progress(delta), this.currentRun?.abortController.signal)
      this.callbacks.onDomainMap(domainMap)
      task.done()
    } catch (err) {
      task.failed(err)
      throw err
    }
  }
}
