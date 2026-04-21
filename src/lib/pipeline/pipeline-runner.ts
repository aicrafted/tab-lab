import { classifyItems, splitLargeClusters, analyzeItemsTwoPass, urlPathSnippet, domainSiteLine } from '../ai/classifier'
import { checkLlmAvailability } from '../ai/setup'
import { analyzeMetadata, type PageIntent } from '../ai/prompts'
import { chatComplete } from '../ai/llm'
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
      await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings, false, this.currentRun?.abortController.signal)
      normalizeTask.progress(2)
      normalizeTask.done()
    }

    if (!this.isRunActive(runId)) return
    await this.runTagsAndIntents(runId, tabs, bookmarks, settings, domainMap)
  }

  async runAutoGeminiFlow(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const allDomains = [...new Set(unifiedDocs.map((item) => item.domain).filter(Boolean))]

    // Phase 1: Enrich Domains (for siteLine context)
    const domainsTask = this.registry.registerTask(TASK_IDS.DOMAINS, 'Auto domain knowledge', allDomains.length)
    const domainMap = await enrichDomains(allDomains, settings, (delta) => {
      if (!this.isRunActive(runId)) return
      domainsTask.progress(delta)
    }, this.currentRun?.abortController.signal)
    domainsTask.done()
    this.callbacks.onDomainMap(domainMap)

    // Phase 2: Full Analysis (Combined)
    const tabsTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'Analyzing pages', unifiedDocs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'Analyzing bookmarks', 1)
    
    // To keep UI tasks moving, we create sub-tasks for tags/intent but they progress in parallel
    const tagsTask = this.registry.registerTask(TASK_IDS.TAGS_TABS, 'Extracting tags', unifiedDocs.length)
    const intentTask = this.registry.registerTask(TASK_IDS.INTENT_TABS, 'Detecting intent', unifiedDocs.length)

    await analyzeItemsTwoPass(
      unifiedDocs.map((doc) => ({ url: doc.url, title: doc.title, domain: doc.domain })),
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        const count = updates.length
        tabsTask.progress(count)
        tagsTask.progress(count)
        intentTask.progress(count)

        this.callbacks.onCategoryUpdate(updates.map(u => ({ url: u.url, category: u.category, parentCategory: u.parentCategory })))
        this.callbacks.onTagsUpdate(updates.map(u => ({ url: u.url, tags: u.tags })))
        this.callbacks.onIntentUpdate(updates.map(u => ({ url: u.url, intent: u.intent })))
      },
      domainMap,
      this.currentRun?.abortController.signal,
    )
    tabsTask.done()
    bookmarksTask.done()
    tagsTask.done()
    intentTask.done()

    if (!this.isRunActive(runId)) return

    // Phase 3: Post-processing (Categorization polish)
    const normalizeTask = this.registry.registerTask(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 2)
    await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings, false, this.currentRun?.abortController.signal)
    normalizeTask.progress(2)
    normalizeTask.done()
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
    skipRareMerge = false,
    signal?: AbortSignal,
  ): Promise<void> {
    const uniqueUrls = [...new Set([...tabItems, ...bookmarkItems].map((item) => normalizeUrlForCache(item.url)))]
    const entries = await Promise.all(uniqueUrls.map(async (url) => ({ url, entry: await getCached(url) })))
    const allLabels = entries.map(({ entry }) => entry?.category).filter(Boolean) as string[]
    const counts = allLabels.reduce((acc, l) => {
      acc[l] = (acc[l] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    const labelsWithCounts = Object.entries(counts).map(([label, count]) => ({ label, count }))
    if (labelsWithCounts.length <= 1) return

    const tracker = createLoggerProgress('normalizeCategoriesStep', 2)
    
    const NORMALIZE_MAX_COUNT = 1000
    
    // Phase 1: Normalize/Merge
    // Use the frequency-aware consolidation logic (Synonym/Acronym merging)
    const mapping = await refineCategoryLabels(labelsWithCounts, settings, NORMALIZE_MAX_COUNT, signal)
    
    // Convert to item format for applyRefinedCategories
    const itemData = entries.map(({ url, entry }) => ({
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
    const tabsTask = this.registry.registerTask(TASK_IDS.CLASSIFY_TABS, 'Analyzing pages', unifiedDocs.length)
    const bookmarksTask = this.registry.registerTask(TASK_IDS.CLASSIFY_BOOKMARKS, 'Analyzing bookmarks', 1)
    
    // Additional tasks to show progress for tags/intent in UI
    const tagsTask = this.registry.registerTask(TASK_IDS.TAGS_TABS, 'Extracting tags', unifiedDocs.length)
    const intentTask = this.registry.registerTask(TASK_IDS.INTENT_TABS, 'Detecting intent', unifiedDocs.length)

    try {
      const allDomains = [...new Set(unifiedDocs.map(d => d.domain).filter(Boolean))]
      const domainMap = await enrichDomains(allDomains, settings, undefined, this.currentRun?.abortController.signal)
      this.callbacks.onDomainMap(domainMap)

      await classifyItems(
        unifiedDocs.map((doc) => ({ url: doc.url, title: doc.title, domain: doc.domain })),
        settings,
        (updates) => {
          if (!this.isRunActive(runId)) return
          tabsTask.progress(updates.length)
          this.callbacks.onCategoryUpdate(updates)
        },
        domainMap,
        this.currentRun?.abortController.signal,
      )

      if (!this.isRunActive(runId)) { 
        tabsTask.cancel(); bookmarksTask.cancel(); tagsTask.cancel(); intentTask.cancel()
        return 
      }
      tabsTask.done()
      bookmarksTask.done()
      tagsTask.done()
      intentTask.done()
    } catch (err) {
      tabsTask.failed(err)
      bookmarksTask.failed(err)
      tagsTask.failed(err)
      intentTask.failed(err)
      throw err
    }
  }

  async startStandaloneLabelsRun(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const unifiedDocs = this.buildUnifiedDocs(tabs, bookmarks)
    const tagsTask = this.registry.registerTask(TASK_IDS.TAGS_TABS, 'LLM labels (tags+intent)', unifiedDocs.length)
    const intentTask = this.registry.registerTask(TASK_IDS.INTENT_TABS, 'LLM intent pages', 0) // progress tracked by tagsTask for simplicity

    try {
      const allDomains = [...new Set(unifiedDocs.map(d => d.domain).filter(Boolean))]
      const domainMap = await enrichDomains(allDomains, settings, undefined, this.currentRun?.abortController.signal)
      this.callbacks.onDomainMap(domainMap)

      const options = {
        responseFormat: 'json' as const,
        ...(settings.tasks.chat.provider === 'browser-ml' ? { disableThinking: true } : {}),
      }

      const BATCH = 5
      for (let i = 0; i < unifiedDocs.length; i += BATCH) {
        if (!this.isRunActive(runId)) break
        const batch = unifiedDocs.slice(i, i + BATCH)
        const tagUpdates: { url: string; tags: string[] }[] = []
        const intentUpdates: { url: string; intent: PageIntent | undefined }[] = []

        await Promise.all(batch.map(async (item) => {
          try {
            const path = urlPathSnippet(item.url)
            const siteLine = domainSiteLine(item.domain, domainMap, settings.localNetworks)
            const userMsg = analyzeMetadata.user({ title: item.title, domain: item.domain, path, siteLine })
            const raw = await chatComplete(analyzeMetadata.system(), userMsg, settings, 512, { ...options, metricKey: 'standalone-labels', signal: this.currentRun?.abortController.signal })
            const meta = analyzeMetadata.parseResponse(raw)

            const existing = await getCached(item.url)
            await setCached(item.url, {
              ...existing,
              category: existing?.category ?? 'Other',
              tags: meta.tags,
              intent: meta.intent,
              processedAt: Date.now(),
            })

            tagUpdates.push({ url: item.url, tags: meta.tags })
            intentUpdates.push({ url: item.url, intent: meta.intent })
          } catch (err) {
            aiPipelineLog.error('standalone labels item failed', { url: item.url, err })
          } finally {
            tagsTask.progress(1)
          }
        }))

        if (tagUpdates.length > 0) this.callbacks.onTagsUpdate(tagUpdates)
        if (intentUpdates.length > 0) this.callbacks.onIntentUpdate(intentUpdates)
      }

      if (!this.isRunActive(runId)) {
        tagsTask.cancel()
        intentTask.cancel()
        return
      }
      tagsTask.done()
      intentTask.done()
    } catch (err) {
      tagsTask.failed(err)
      intentTask.failed(err)
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
      const counts = entries.reduce((acc, { entry }) => {
        const label = entry?.category?.trim()
        if (label) acc[label] = (acc[label] || 0) + 1
        return acc
      }, {} as Record<string, number>)
      const labelsWithCounts = Object.entries(counts).map(([label, count]) => ({ label, count }))

      const NORMALIZE_MAX_COUNT = 1000
      aiPipelineLog.info('standalone normalize start', { totalLabels: labelsWithCounts.length })
      const mergeMap = await refineCategoryLabels(labelsWithCounts, settings, NORMALIZE_MAX_COUNT)

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
