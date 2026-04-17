import { checkLlmAvailability, classifyItems, splitLargeClusters } from '../ai/classifier'
import { refineCategoryLabels, applyRefinedCategories } from '../ai/post-processor'
import { legacy_groupRareCategories } from '../ai/category-post-processor-legacy'
import { clearDomainKnowledgeCache, enrichDomains, estimateDomainEnrichmentWork, type DomainInfo } from '../ai/domain-enricher'
import { fetchAndCacheEmbeddings, fetchEmbeddingsBatch, loadEmbeddingsForCurrentModel, reprojectAllEmbeddings } from '../ai/embedder'
import { classifyIntentGeminiNano, classifyIntentLmStudio } from '../ai/intent'
import { classifyVectorNli } from '../ai/nli-engine'
import { aiPipelineLog } from '../core/logger'
import { createLoggerProgress } from '../core/progress'
import { getCached, setCached } from '../core/storage'
import { normalizeUrlForCache, titleDedupeKey } from '../core/url-utils'
import { tagWithGeminiNano, tagWithLmStudio } from '../ai/tagger'
import type { BookmarkItem, LlmSettings, TabItem } from '../core/types'
import { ClusteringStrategy } from './clustering-strategy'
import type { PipelineCallbacks, RunContext, TaskHandle } from './types'
import { TASK_IDS } from './types'
import type { TaskRegistry } from './task-registry'
import { hasChatProviderConfig, hasDomainKnowledgeProviderConfig, hasEmbeddingProviderConfig } from './utils'

type PageDoc = { url: string; title: string; domain: string; staticIntent?: TabItem['staticIntent'] }

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

  private buildUnifiedDocs(tabs: TabItem[], bookmarks: BookmarkItem[]): PageDoc[] {
    // Phase 1: dedup by full cache key (catches exact-URL duplicates: same tab + bookmark)
    const byUrl = new Map<string, PageDoc>()
    for (const t of tabs) {
      const key = normalizeUrlForCache(t.url)
      if (!byUrl.has(key)) {
        byUrl.set(key, { url: key, title: t.title, domain: t.domain, staticIntent: t.staticIntent })
      }
    }
    for (const b of bookmarks) {
      const key = normalizeUrlForCache(b.url)
      if (!byUrl.has(key)) {
        byUrl.set(key, { url: key, title: b.title, domain: b.domain, staticIntent: b.staticIntent })
      }
    }

    // Phase 2: dedup by (path + title) — removes near-duplicates with different tracking params
    const seen = new Map<string, PageDoc>()
    for (const doc of byUrl.values()) {
      const tk = titleDedupeKey(doc.url, doc.title)
      if (!seen.has(tk)) {
        seen.set(tk, doc)
      }
    }
    return [...seen.values()]
  }

  private async runTags(
    runId: number,
    items: { url: string; title: string; domain: string }[],
    settings: LlmSettings,
    task: TaskHandle,
  ): Promise<void> {
    if (settings.tasks.chat.provider === 'gemini-nano') {
      await tagWithGeminiNano(items, (updates) => {
        if (!this.isRunActive(runId)) return
        task.progress(updates.length)
        this.callbacks.onTagsUpdate(updates)
      }, this.currentRun?.abortController.signal)
    } else {
      await tagWithLmStudio(
        items.map((item) => ({ url: item.url, title: item.title, domain: item.domain })),
        settings,
        (updates) => {
          if (!this.isRunActive(runId)) return
          task.progress(updates.length)
          this.callbacks.onTagsUpdate(updates)
        },
        this.currentRun?.abortController.signal,
      )
    }
    task.done()
  }

  private async runIntent(
    runId: number,
    items: { url: string; title: string; domain: string; staticIntent?: TabItem['staticIntent'] }[],
    settings: LlmSettings,
    task: TaskHandle,
    domainMap?: Map<string, DomainInfo>,
  ): Promise<void> {
    if (settings.tasks.chat.provider === 'gemini-nano') {
      await classifyIntentGeminiNano(items, (updates) => {
        if (!this.isRunActive(runId)) return
        task.progress(updates.length)
        this.callbacks.onIntentUpdate(updates)
      }, this.currentRun?.abortController.signal)
    } else {
      await classifyIntentLmStudio(
        items.map((item) => ({ url: item.url, title: item.title, domain: item.domain, staticIntent: item.staticIntent })),
        settings,
        (updates) => {
          if (!this.isRunActive(runId)) return
          task.progress(updates.length)
          this.callbacks.onIntentUpdate(updates)
        },
        domainMap,
        this.currentRun?.abortController.signal,
      )
    }
    task.done()
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
      await this.runNliDirectFlow(runId, tabs, bookmarks, settings)
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

  private async runNliDirectFlow(
    runId: number,
    tabs: TabItem[],
    bookmarks: BookmarkItem[],
    settings: LlmSettings,
  ): Promise<void> {
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const allDomains = [...new Set(unifiedDocs.map((item) => item.domain).filter(Boolean))]
    const estimatedDomainWork = await estimateDomainEnrichmentWork(allDomains, settings)

    const domainsTask = this.registry.registerTask(TASK_IDS.DOMAINS, 'Auto domain knowledge', Math.max(estimatedDomainWork, 1))
    const embeddingsTask = this.registry.registerTask(TASK_IDS.EMBEDDINGS, 'Auto embeddings', unifiedDocs.length)
    const classifyTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'NLI classify pages', unifiedDocs.length)
    const noopBookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'NLI classify bookmarks', 1)

    const domainMap = await enrichDomains(allDomains, settings, (delta) => {
      if (!this.isRunActive(runId)) return
      domainsTask.progress(delta)
    }, this.currentRun?.abortController.signal)

    if (!this.isRunActive(runId)) {
      domainsTask.cancel(); embeddingsTask.cancel(); classifyTask.cancel(); noopBookmarksTask.cancel()
      return
    }
    domainsTask.done()
    this.callbacks.onDomainMap(domainMap)

    const embeddings = await fetchAndCacheEmbeddings(unifiedDocs, settings, (updates) => {
      if (!this.isRunActive(runId)) return
      embeddingsTask.progress(updates.length)
    }, domainMap, this.currentRun?.abortController.signal)

    if (!this.isRunActive(runId)) {
      embeddingsTask.cancel(); classifyTask.cancel(); noopBookmarksTask.cancel()
      return
    }
    embeddingsTask.done()

    const updates: { url: string; category: string }[] = []
    const FLUSH_SIZE = 25
    for (const item of unifiedDocs) {
      if (!this.isRunActive(runId)) {
        classifyTask.cancel()
        noopBookmarksTask.cancel()
        return
      }
      const embedding = embeddings.get(item.url)
      if (!embedding) {
        classifyTask.progress(1)
        continue
      }
      const result = await classifyVectorNli(embedding, settings)
      if (result) {
        const existing = await getCached(item.url)
        await setCached(item.url, {
          ...existing,
          category: result.label,
          parentCategory: result.label,
          processedAt: Date.now(),
        })
        updates.push({ url: item.url, category: result.label })
      }
      classifyTask.progress(1)
      if (updates.length >= FLUSH_SIZE) {
        this.callbacks.onCategoryUpdate([...updates])
        updates.length = 0
      }
    }
    if (updates.length > 0) this.callbacks.onCategoryUpdate(updates)

    classifyTask.done()
    noopBookmarksTask.done()

    if (!this.isRunActive(runId)) return
    await this.runTagsAndIntents(runId, tabs, bookmarks, settings, domainMap)
  }

  async runAutoClusterFlow(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const allDomains = [...new Set(unifiedDocs.map((item) => item.domain).filter(Boolean))]
    const estimatedDomainWork = await estimateDomainEnrichmentWork(allDomains, settings)

    const domainsTask = this.registry.registerTask(TASK_IDS.DOMAINS, 'Auto domain knowledge', Math.max(estimatedDomainWork, 1))
    const embeddingsTask = this.registry.registerTask(TASK_IDS.EMBEDDINGS, 'Auto embeddings', unifiedDocs.length)
    const tabsTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'Auto cluster pages', unifiedDocs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'Auto cluster bookmarks', 1)

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

    const embeddings = await fetchAndCacheEmbeddings(unifiedDocs, settings, (updates) => {
      if (!this.isRunActive(runId)) return
      embeddingsTask.progress(updates.length)
    }, domainMap, this.currentRun?.abortController.signal)
    
    if (!this.isRunActive(runId)) {
      embeddingsTask.cancel(); tabsTask.cancel(); bookmarksTask.cancel()
      return
    }
    embeddingsTask.done()

    const clusterItems = unifiedDocs
      .map((item) => ({ ...item, embedding: embeddings.get(item.url) }))
      .filter((item): item is { url: string; title: string; domain: string; staticIntent?: TabItem['staticIntent']; embedding: number[] } => Boolean(item.embedding))

    if (clusterItems.length > 0) {
      await this.clustering.runTwoPassClustering(
        runId,
        clusterItems,
        settings,
        tabsTask,
        domainMap,
        this.currentRun?.abortController.signal,
      )
    }
    tabsTask.done()
    bookmarksTask.done()

    if (!this.isRunActive(runId)) return

    const useNli = settings.tasks.classification.method === 'nli' && hasEmbeddingProviderConfig(settings)
    if (!useNli) {
      const normalizeTask = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 2)
      await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
      normalizeTask.progress(2)
      normalizeTask.done()
    }

    await this.runTagsAndIntents(runId, tabs, bookmarks, settings, domainMap)
  }

  async runAutoGeminiFlow(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const tabsTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'Auto classify pages', unifiedDocs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'Auto classify bookmarks', 1)


    await classifyItems(
      unifiedDocs.map((doc) => ({ url: doc.url, title: doc.title, domain: doc.domain })),
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        tabsTask.progress(updates.length)
        this.callbacks.onCategoryUpdate(updates)
      },
      undefined,
      this.currentRun?.abortController.signal,
    )
    tabsTask.done()
    bookmarksTask.done()

    if (!this.isRunActive(runId)) return

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
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const tagsTabsTask = this.registry.registerTask(TASK_IDS.TAGS_TABS, 'Tags pages', unifiedDocs.length)
    const tagsBookmarksTask = this.registry.registerTask(TASK_IDS.TAGS_BOOKMARKS, 'Tags bookmarks', 1)
    const intentTabsTask = this.registry.registerTask(TASK_IDS.INTENT_TABS, 'Intent pages', unifiedDocs.length)
    const intentBookmarksTask = this.registry.registerTask(TASK_IDS.INTENT_BOOKMARKS, 'Intent bookmarks', 1)

    const runIdStr = String(runId)
    aiPipelineLog.debug('parallelizing tags and intents', { runId: runIdStr, tabs: tabs.length, bookmarks: bookmarks.length })

    await Promise.all([
      this.runTags(runId, unifiedDocs, settings, tagsTabsTask),
      this.runIntent(runId, unifiedDocs, settings, intentTabsTask, domainMap),
    ])
    tagsBookmarksTask.done()
    intentBookmarksTask.done()
  }

  async normalizeCategoriesAfterClassification(
    tabItems: { url: string }[], 
    bookmarkItems: { url: string }[], 
    settings: LlmSettings,
    skipRareMerge = false
  ): Promise<void> {
    const uniqueUrls = [...new Set([...tabItems, ...bookmarkItems].map((item) => normalizeUrlForCache(item.url)))]
    const entries = await Promise.all(uniqueUrls.map(async (url) => ({ url, entry: await getCached(url) })))
    const items = new Map(entries.map(e => [e.url, e.entry]))
    const labels = [...new Set(entries.map(({ entry }) => entry?.category).filter(Boolean) as string[])]
    if (labels.length <= 1) return

    const tracker = createLoggerProgress('normalizeCategoriesStep', 2)
    
    // Phase 1: Normalize/Merge
    // Use the new single-level refinement logic
    const mapping = await refineCategoryLabels(labels, settings)
    
    // Convert to item format for applyRefinedCategories
    const itemData = [...items.entries()].map(([url, entry]) => ({
      url,
      originalCategory: entry?.category?.trim() || 'Other'
    }))

    await applyRefinedCategories(
      itemData,
      mapping,
      (updates) => this.callbacks.onCategoryUpdate(updates)
    )
    tracker.progress(1)

    if (skipRareMerge) {
      aiPipelineLog.info('normalizeCategories: skipping rare merge as requested')
      tracker.done()
      return
    }

    // Phase 2: Group Rare
    aiPipelineLog.info('skipping legacy rare category grouping')
    tracker.done()
  }

  async startStandaloneClassifyRun(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const tabsTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'LLM classifying pages', unifiedDocs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'LLM classifying bookmarks', 1)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      const useNli = settings.tasks.classification.method === 'nli' && hasEmbeddingProviderConfig(settings)

      if (useNli || (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) || hasChatProviderConfig(settings)) {
        await classifyItems(
          unifiedDocs.map((doc) => ({ url: doc.url, title: doc.title, domain: doc.domain })),
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onCategoryUpdate(updates)
          },
          undefined,
          this.currentRun?.abortController.signal,
        )
        tabsTask.done()
        bookmarksTask.done()
      } else {
        throw new Error('LLM unavailable')
      }

      if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
    } catch (err) {
      tabsTask.failed(err)
      bookmarksTask.failed(err)
      throw err
    }
  }

  async startStandaloneTagsRun(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const tabsTask = this.registry.registerTask(TASK_IDS.TAGS_TABS, 'LLM tagging pages', unifiedDocs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.TAGS_BOOKMARKS, 'LLM tagging bookmarks', 1)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      if (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        await tagWithGeminiNano(unifiedDocs, (updates) => {
          if (!this.isRunActive(runId)) return
          tabsTask.progress(updates.length)
          this.callbacks.onTagsUpdate(updates)
        }, this.currentRun?.abortController.signal)
        tabsTask.done()
        bookmarksTask.done()
      } else if (hasChatProviderConfig(settings)) {
        await tagWithLmStudio(
          unifiedDocs.map((doc) => ({ url: doc.url, title: doc.title, domain: doc.domain })),
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onTagsUpdate(updates)
          },
          this.currentRun?.abortController.signal,
        )
        tabsTask.done()
        bookmarksTask.done()
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
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const tabsTask = this.registry.registerTask(TASK_IDS.INTENT_TABS, 'LLM intent pages', unifiedDocs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.INTENT_BOOKMARKS, 'LLM intent bookmarks', 1)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      const useNli = settings.tasks.classification.method === 'nli' && hasEmbeddingProviderConfig(settings)

      if (useNli) {
        await classifyIntentLmStudio(
          unifiedDocs.map((doc) => ({ url: doc.url, title: doc.title, domain: doc.domain, staticIntent: doc.staticIntent })),
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates)
          },
          undefined,
          this.currentRun?.abortController.signal,
        )
        tabsTask.done()
        bookmarksTask.done()
      } else if (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        await classifyIntentGeminiNano(
          unifiedDocs.map((doc) => ({ url: doc.url, title: doc.title, domain: doc.domain, staticIntent: doc.staticIntent })),
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates)
          },
          this.currentRun?.abortController.signal,
        )
        tabsTask.done()
        bookmarksTask.done()
      } else if (hasChatProviderConfig(settings)) {
        await classifyIntentLmStudio(
          unifiedDocs.map((doc) => ({ url: doc.url, title: doc.title, domain: doc.domain, staticIntent: doc.staticIntent })),
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates)
          },
          undefined,
          this.currentRun?.abortController.signal,
        )
        tabsTask.done()
        bookmarksTask.done()
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

  async startStandaloneNormalizeRun(_runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const task = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 1)
    try {
      const useNli = settings.tasks.classification.method === 'nli' && hasEmbeddingProviderConfig(settings)
      if (useNli) {
        task.done()
        return
      }
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')

      const allItems = [...tabs, ...bookmarks]
      const uniqueUrls = [...new Set(allItems.map((item) => normalizeUrlForCache(item.url)))]
      const entries = await Promise.all(uniqueUrls.map(async (url) => ({ url, entry: await getCached(url) })))
      const allLabels = [...new Set(entries.map(({ entry }) => entry?.category).filter(Boolean) as string[])]

      if (allLabels.length <= 1) {
        task.done()
        return
      }

      aiPipelineLog.info('standalone normalize start', { totalLabels: allLabels.length, labels: allLabels })
      const mergeMap = await refineCategoryLabels(allLabels, settings)

      const urlToCategory = new Map<string, string>()
      for (const { url, entry } of entries) {
        if (entry?.category) urlToCategory.set(url, entry.category)
      }

      const updates = allItems
        .map((t) => {
          const normalizedUrl = normalizeUrlForCache(t.url)
          const from = urlToCategory.get(normalizedUrl)
          if (!from) return null
          const to = mergeMap[from] ?? from
          return from === to ? null : { url: t.url, category: to }
        })
        .filter((item): item is { url: string; category: string } => Boolean(item))

      const writes = updates.map((u) => {
         const normalizedUrl = normalizeUrlForCache(u.url)
         const entry = urlToCategory.has(normalizedUrl) ? { category: urlToCategory.get(normalizedUrl) } : {}
         return setCached(normalizedUrl, { ...entry, category: u.category, processedAt: Date.now() })
      })
      await Promise.all(writes)
      if (updates.length > 0) this.callbacks.onCategoryUpdate(updates)
      aiPipelineLog.info('pass2 merge categories done', { changes: updates.length })
      task.done()
    } catch (err) {
      task.failed(err)
      throw err
    }
  }

  async startStandaloneSplitRun(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const task = this.registry.registerTask('split-large-categories', 'Split large categories', 1)
    try {
      const useNli = settings.tasks.classification.method === 'nli' && hasEmbeddingProviderConfig(settings)
      if (useNli) {
        task.done()
        return
      }
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')
      const allItems = [...tabs, ...bookmarks]
      const allDomains = [...new Set(allItems.map((item) => item.domain).filter(Boolean))]
      const domainMap = await enrichDomains(allDomains, settings)
      const embeddings = await loadEmbeddingsForCurrentModel(settings)
      await splitLargeClusters(
        allItems.map((t) => ({
          url: normalizeUrlForCache(t.url),
          title: t.title,
          domain: t.domain,
          category: t.category ?? '',
        })),
        settings,
        (updates) => {
          if (!this.isRunActive(runId)) return
          this.callbacks.onCategoryUpdate(updates)
        },
        domainMap,
        embeddings,
        this.currentRun?.abortController.signal,
      )

      const allCategoryItems = (await Promise.all(
        allItems.map(async (item) => {
          const normalizedUrl = normalizeUrlForCache(item.url)
          const entry = await getCached(normalizedUrl)
          const category = entry?.category?.trim()
          return category ? { url: normalizedUrl, category } : null
        }),
      )).filter((item): item is { url: string; category: string } => Boolean(item))
      const rareUpdates = await legacy_groupRareCategories(allCategoryItems, settings)
      if (rareUpdates.length > 0) this.callbacks.onCategoryUpdate(rareUpdates)

      task.done()
    } catch (err) {
      task.failed(err)
      throw err
    }
  }

  async startStandalonePostProcessRun(_runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const task = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Post-process categories', 2)
    try {
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')
      await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
      task.done()
    } catch (err) {
      task.failed(err)
      throw err
    }
  }

  async startStandaloneGroupRareRun(_runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const task = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Group rare categories', 1)
    try {
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')
      const allItems = [...tabs, ...bookmarks]
      const uniqueUrls = [...new Set(allItems.map((item) => normalizeUrlForCache(item.url)))]
      const entries = await Promise.all(uniqueUrls.map(async (url) => ({ url, entry: await getCached(url) })))
      const categoryItems = entries
        .map(({ url, entry }) => (entry?.category ? { url, category: entry.category } : null))
        .filter((item): item is { url: string; category: string } => Boolean(item))
      
      const updates = await legacy_groupRareCategories(categoryItems, settings)
      if (updates.length > 0) this.callbacks.onCategoryUpdate(updates)
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
