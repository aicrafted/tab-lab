import { kMeans, type ClusterResult } from './cluster'
import { checkLlmAvailability, classifyBookmarks, classifyByClusters, classifyTabs, classifyWithLmStudio, normalizeCategoryLabels, groupRareCategories, splitLargeClusters } from './classifier'
import { clearDomainKnowledgeCache, enrichDomains, estimateDomainEnrichmentWork, type DomainInfo } from './domain-enricher'
import { fetchAndCacheEmbeddings, fetchEmbeddingsBatch, loadCachedEmbeddings, reprojectAllEmbeddings } from './embedder'
import { aiPipelineLog } from './logger'
import { classifyIntentGeminiNano, classifyIntentLmStudio } from './intent'
import { detectPlatform } from './platform-detection'
import { getCached, setCached } from './storage'
import { tagWithGeminiNano, tagWithLmStudio } from './tagger'
import type { BookmarkItem, KnownPlatform, LlmSettings, PageIntent, TabItem } from './types'

export type TaskId = string

export const TASK_IDS = {
  DOMAINS: 'domains',
  EMBEDDINGS: 'embeddings',
  CLASSIFY_TABS: 'classify-tabs',
  CLASSIFY_BOOKMARKS: 'classify-bookmarks',
  NORMALIZE_CATEGORIES: 'normalize-categories',
  TAGS_TABS: 'tags-tabs',
  TAGS_BOOKMARKS: 'tags-bookmarks',
  INTENT_TABS: 'intent-tabs',
  INTENT_BOOKMARKS: 'intent-bookmarks',
} as const

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TaskState {
  id: TaskId
  label: string
  status: TaskStatus
  done: number
  total: number
  percent: number
  error?: string
  startedAt?: number
  finishedAt?: number
}

export type PipelineEvent =
  | { type: 'task-update'; task: TaskState }
  | { type: 'pipeline-start'; runId: number }
  | { type: 'pipeline-done'; runId: number }
  | { type: 'pipeline-failed'; runId: number; error: string }
  | { type: 'pipeline-cancelled'; runId: number }

export interface PipelineCallbacks {
  onCategoryUpdate: (updates: { url: string; category: string }[], prefix: 'tab' | 'bm') => void
  onTagsUpdate: (updates: { url: string; tags: string[] }[], prefix: 'tab' | 'bm') => void
  onIntentUpdate: (updates: { url: string; intent: PageIntent }[], prefix: 'tab' | 'bm') => void
  onClusterUpdate: (updates: { url: string; clusterId: number }[], prefix: 'tab' | 'bm') => void
  onClusterNames: (names: Map<number, string>) => void
  onProjectedPoints: (points: Map<string, [number, number]>) => void
  onDomainMap: (domainMap: Map<string, DomainInfo>) => void
}

export interface TaskHandle {
  progress: (delta: number) => void
  done: (extra?: Record<string, unknown>) => void
  failed: (error: unknown) => void
  cancel: () => void
}

type Listener = (event: PipelineEvent) => void

interface AutoRunRequest {
  runId: number
  tabs: TabItem[]
  bookmarks: BookmarkItem[]
  settings: LlmSettings
}

interface RunContext {
  runId: number
  cancelled: boolean
  kind: 'auto' | 'domain' | 'embedding' | 'classify' | 'tags' | 'intent' | 'normalize' | 'split' | 'postprocess'
}

const BOOKMARK_CLUSTER_OFFSET = 10_000

function hasChatProviderConfig(settings: LlmSettings): boolean {
  const provider = settings.tasks.chat.provider
  if (provider === 'gemini-nano') return true
  if (provider === 'browser-ml') return Boolean(settings.providers.browserMl.chatModel)
  if (provider === 'lmstudio') return Boolean(settings.providers.lmstudio.baseUrl && settings.providers.lmstudio.chatModel)
  if (provider === 'openrouter') return Boolean(settings.providers.openrouter.apiKey && settings.providers.openrouter.chatModel)
  return false
}

function hasDomainKnowledgeProviderConfig(settings: LlmSettings): boolean {
  const provider = settings.tasks.chat.provider
  if (provider === 'gemini-nano') return false
  if (provider === 'browser-ml') return Boolean(settings.providers.browserMl.chatModel)
  if (provider === 'lmstudio') return Boolean(settings.providers.lmstudio.baseUrl && settings.providers.lmstudio.chatModel)
  if (provider === 'openrouter') return Boolean(settings.providers.openrouter.apiKey && settings.providers.openrouter.chatModel)
  return false
}

function hasEmbeddingProviderConfig(settings: LlmSettings): boolean {
  const provider = settings.tasks.embedding.provider
  if (provider === 'browser-ml') return true
  if (provider === 'lmstudio') return Boolean(settings.providers.lmstudio.baseUrl && settings.providers.lmstudio.embeddingModel)
  if (provider === 'openrouter') return Boolean(settings.providers.openrouter.apiKey && settings.providers.openrouter.embeddingModel)
  return false
}

export class PipelineOrchestrator {
  private readonly callbacks: PipelineCallbacks
  private readonly listeners = new Set<Listener>()
  private readonly tasks = new Map<TaskId, TaskState>()
  private currentRun: RunContext | null = null
  private runSeq = 0
  private pendingAuto: AutoRunRequest | null = null

  constructor(callbacks: PipelineCallbacks) {
    this.callbacks = callbacks
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getTasks(): TaskState[] {
    return [...this.tasks.values()]
  }

  getTask(id: TaskId): TaskState | undefined {
    return this.tasks.get(id)
  }

  registerTask(id: TaskId, label: string, total: number): TaskHandle {
    const safeTotal = Math.max(1, total)
    const startedAt = Date.now()
    let done = 0
    let closed = false
    let lastLoggedPercent = -1
    this.setTask({
      id,
      label,
      status: 'running',
      done,
      total: safeTotal,
      percent: 0,
      startedAt,
    })
    aiPipelineLog.info(`${id} start`, { label, total: safeTotal })

    const emitProgress = () => {
      const rawPct = (done / safeTotal) * 100
      const uiPct = Math.round(rawPct * 10) / 10
      const logPct = Math.floor(rawPct)
      while (lastLoggedPercent < logPct) {
        lastLoggedPercent += 1
        if (lastLoggedPercent >= 0) {
          aiPipelineLog.debug(`${id} progress`, { done, total: safeTotal, pct: lastLoggedPercent })
        }
      }
      this.updateTask(id, { done, total: safeTotal, percent: uiPct })
    }
    emitProgress()

    return {
      progress: (delta: number) => {
        if (closed) return
        const safeDelta = Math.max(0, Math.floor(delta))
        if (safeDelta === 0) {
          emitProgress()
          return
        }
        for (let i = 0; i < safeDelta && done < safeTotal; i += 1) {
          done += 1
          emitProgress()
        }
      },
      done: (extra?: Record<string, unknown>) => {
        if (closed) return
        closed = true
        done = safeTotal
        this.updateTask(id, {
          done,
          total: safeTotal,
          percent: 100,
          status: 'done',
          finishedAt: Date.now(),
        })
        aiPipelineLog.info(`${id} done`, {
          label,
          elapsedMs: Date.now() - startedAt,
          ...extra,
        })
      },
      failed: (error: unknown) => {
        if (closed) return
        closed = true
        const msg = error instanceof Error ? error.message : String(error)
        this.updateTask(id, {
          status: 'failed',
          finishedAt: Date.now(),
          error: msg,
        })
        aiPipelineLog.error(`${id} failed`, { label, err: msg })
      },
      cancel: () => {
        if (closed) return
        closed = true
        this.updateTask(id, { status: 'cancelled', finishedAt: Date.now() })
        aiPipelineLog.warn(`${id} cancelled`, { label })
      },
    }
  }

  enqueueAutoRun(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    const req: AutoRunRequest = { runId, tabs, bookmarks, settings }
    if (this.currentRun) {
      this.pendingAuto = req
      return runId
    }
    void this.startAutoRun(req)
    return runId
  }

  enqueueEmbeddingPass(
    items: { url: string; title: string; domain: string; category?: string }[],
    settings: LlmSettings,
  ): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneEmbeddingRun(runId, items, settings)
    return runId
  }

  enqueueDomainPass(domains: string[], settings: LlmSettings, force = false): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneDomainRun(runId, domains, settings, force)
    return runId
  }

  enqueueClassifyPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneClassifyRun(runId, tabs, bookmarks, settings)
    return runId
  }

  enqueueTagsPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneTagsRun(runId, tabs, bookmarks, settings)
    return runId
  }

  enqueueIntentPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneIntentRun(runId, tabs, bookmarks, settings)
    return runId
  }

  enqueueNormalizePass(tabs: TabItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneNormalizeRun(runId, tabs, settings)
    return runId
  }

  enqueueSplitPass(tabs: TabItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneSplitRun(runId, tabs, settings)
    return runId
  }

  enqueuePostProcessPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandalonePostProcessRun(runId, tabs, bookmarks, settings)
    return runId
  }

  cancelCurrent(): void {
    if (!this.currentRun) return
    this.cancel(this.currentRun.runId)
  }

  cancel(runId: number): void {
    if (!this.currentRun || this.currentRun.runId !== runId) return
    this.currentRun.cancelled = true
    for (const task of this.tasks.values()) {
      if (task.status === 'running' || task.status === 'pending') {
        this.updateTask(task.id, { status: 'cancelled', finishedAt: Date.now() })
      }
    }
    this.emit({ type: 'pipeline-cancelled', runId })
  }

  private emit(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private isRunActive(runId: number): boolean {
    return Boolean(this.currentRun && this.currentRun.runId === runId && !this.currentRun.cancelled)
  }

  private clearTasks(): void {
    this.tasks.clear()
  }

  private setTask(task: TaskState): void {
    this.tasks.set(task.id, task)
    this.emit({ type: 'task-update', task })
  }

  private updateTask(id: TaskId, patch: Partial<TaskState>): void {
    const existing = this.tasks.get(id)
    if (!existing) return
    const next = { ...existing, ...patch }
    this.tasks.set(id, next)
    this.emit({ type: 'task-update', task: next })
  }

  private createTaskTracker(id: TaskId, label: string, total: number) {
    return this.registerTask(id, label, total)
  }

  private async startAutoRun(req: AutoRunRequest): Promise<void> {
    const { runId, tabs, bookmarks, settings } = req
    this.currentRun = { runId, kind: 'auto', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })
    try {
      await this.executeAutoPipeline(runId, tabs, bookmarks, settings)
      if (this.isRunActive(runId)) {
        this.emit({ type: 'pipeline-done', runId })
      }
    } catch (err) {
      if (this.currentRun?.cancelled) {
        this.emit({ type: 'pipeline-cancelled', runId })
      } else {
        const error = err instanceof Error ? err.message : String(err)
        for (const task of this.tasks.values()) {
          if (task.status === 'running' || task.status === 'pending') {
            this.updateTask(task.id, { status: 'failed', finishedAt: Date.now(), error })
          }
        }
        this.emit({ type: 'pipeline-failed', runId, error })
      }
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
      const pending = this.pendingAuto
      this.pendingAuto = null
      if (pending) void this.startAutoRun(pending)
    }
  }

  private async executeAutoPipeline(
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

    if (settings.providers.browserMl.classificationMethod === 'nli' && settings.tasks.embedding.provider === 'browser-ml') {
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

  private async runAutoClusterFlow(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const allItems = [
      ...tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
      ...bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
    ]
    const allDomains = [...new Set(allItems.map((item) => item.domain).filter(Boolean))]
    const estimatedDomainWork = await estimateDomainEnrichmentWork(allDomains)
    const domainsTask = this.createTaskTracker(TASK_IDS.DOMAINS, 'Auto domain knowledge', Math.max(estimatedDomainWork, 1))
    const embeddingsTask = this.createTaskTracker(TASK_IDS.EMBEDDINGS, 'Auto embeddings', allItems.length)
    const tabsTask = this.createTaskTracker(TASK_IDS.CLASSIFY_TABS, 'Auto cluster tabs', tabs.length)
    const bookmarksTask = this.createTaskTracker(TASK_IDS.CLASSIFY_BOOKMARKS, 'Auto cluster bookmarks', bookmarks.length)

    const domainMap = await enrichDomains(allDomains, settings, (delta) => {
      if (!this.isRunActive(runId)) return
      domainsTask.progress(delta)
    })
    if (!this.isRunActive(runId)) {
      domainsTask.cancel(); embeddingsTask.cancel(); tabsTask.cancel(); bookmarksTask.cancel()
      return
    }
    domainsTask.done()
    this.callbacks.onDomainMap(domainMap)

    const embeddings = await fetchAndCacheEmbeddings(allItems, settings, (updates) => {
      if (!this.isRunActive(runId)) return
      embeddingsTask.progress(updates.length)
    }, domainMap)
    if (!this.isRunActive(runId)) {
      embeddingsTask.cancel(); tabsTask.cancel(); bookmarksTask.cancel()
      return
    }
    embeddingsTask.done()

    const tabItems = tabs
      .map((t) => ({ url: t.url, title: t.title, domain: t.domain, embedding: embeddings.get(t.url) }))
      .filter((item): item is { url: string; title: string; domain: string; embedding: number[] } => Boolean(item.embedding))
    if (tabItems.length > 0) {
      const uniquePlatformCount = new Set(
        tabItems.map((item) => detectPlatform(item.domain, domainMap)).filter((platform): platform is KnownPlatform => platform !== undefined),
      ).size
      const k = Math.max(3, Math.min(150, Math.max(Math.ceil(tabItems.length / 8), uniquePlatformCount)))
      const clusters = kMeans(tabItems.map(({ url, embedding }) => ({ url, embedding })), k)
      const names = await classifyByClusters(tabItems, clusters, 'tab', settings, (updates) => {
        if (!this.isRunActive(runId)) return
        tabsTask.progress(updates.length)
        this.callbacks.onCategoryUpdate(updates, 'tab')
        this.callbacks.onClusterUpdate(updates.map((u) => ({ url: u.url, clusterId: u.clusterId })), 'tab')
      }, domainMap)
      this.callbacks.onClusterNames(names)
    }
    tabsTask.done()

    const bookmarkItems = bookmarks
      .map((b) => ({ url: b.url, title: b.title, domain: b.domain, embedding: embeddings.get(b.url) }))
      .filter((item): item is { url: string; title: string; domain: string; embedding: number[] } => Boolean(item.embedding))
    if (bookmarkItems.length > 0) {
      const uniquePlatformCount = new Set(
        bookmarkItems.map((item) => detectPlatform(item.domain, domainMap)).filter((platform): platform is KnownPlatform => platform !== undefined),
      ).size
      const k = Math.max(3, Math.min(150, Math.max(Math.ceil(bookmarkItems.length / 8), uniquePlatformCount)))
      const clusters = kMeans(bookmarkItems.map(({ url, embedding }) => ({ url, embedding })), k)
      const bookmarkClusters: ClusterResult[] = clusters.map((cluster) => ({ ...cluster, clusterId: cluster.clusterId + BOOKMARK_CLUSTER_OFFSET }))
      const names = await classifyByClusters(bookmarkItems, bookmarkClusters, 'bm', settings, (updates) => {
        if (!this.isRunActive(runId)) return
        bookmarksTask.progress(updates.length)
        this.callbacks.onCategoryUpdate(updates, 'bm')
        this.callbacks.onClusterUpdate(updates.map((u) => ({ url: u.url, clusterId: u.clusterId })), 'bm')
      }, domainMap)
      this.callbacks.onClusterNames(names)
    }
    bookmarksTask.done()

    const normalizeTask = this.createTaskTracker(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 2)
    await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
    normalizeTask.progress(2)
    normalizeTask.done()

    await this.runTagsAndIntents(runId, tabs, bookmarks, settings, domainMap)
  }

  private async runAutoGeminiFlow(runId: number, tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): Promise<void> {
    const tabsTask = this.createTaskTracker(TASK_IDS.CLASSIFY_TABS, 'Auto classify tabs', tabs.length)
    const bookmarksTask = this.createTaskTracker(TASK_IDS.CLASSIFY_BOOKMARKS, 'Auto classify bookmarks', bookmarks.length)

    await classifyTabs(tabs, (updates) => {
      if (!this.isRunActive(runId)) return
      tabsTask.progress(updates.length)
      this.callbacks.onCategoryUpdate(updates, 'tab')
    }, settings)
    if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
    tabsTask.done()

    await classifyBookmarks(bookmarks, (updates) => {
      if (!this.isRunActive(runId)) return
      bookmarksTask.progress(updates.length)
      this.callbacks.onCategoryUpdate(updates, 'bm')
    }, settings)
    if (!this.isRunActive(runId)) { bookmarksTask.cancel(); return }
    bookmarksTask.done()

    const normalizeTask = this.createTaskTracker(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 2)
    await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
    normalizeTask.progress(2)
    normalizeTask.done()

    await this.runTagsAndIntents(runId, tabs, bookmarks, settings)
  }

  private async runTagsAndIntents(
    runId: number,
    tabs: TabItem[],
    bookmarks: BookmarkItem[],
    settings: LlmSettings,
    domainMap?: Map<string, DomainInfo>,
  ): Promise<void> {
    const tagsTabsTask = this.createTaskTracker(TASK_IDS.TAGS_TABS, 'Tags tabs', tabs.length)
    const tagsBookmarksTask = this.createTaskTracker(TASK_IDS.TAGS_BOOKMARKS, 'Tags bookmarks', bookmarks.length)
    const intentTabsTask = this.createTaskTracker(TASK_IDS.INTENT_TABS, 'Intent tabs', tabs.length)
    const intentBookmarksTask = this.createTaskTracker(TASK_IDS.INTENT_BOOKMARKS, 'Intent bookmarks', bookmarks.length)

    if (settings.tasks.chat.provider === 'gemini-nano') {
      await tagWithGeminiNano(tabs, 'tab', (updates) => {
        if (!this.isRunActive(runId)) return
        tagsTabsTask.progress(updates.length)
        this.callbacks.onTagsUpdate(updates, 'tab')
      })
      tagsTabsTask.done()
      await tagWithGeminiNano(bookmarks, 'bm', (updates) => {
        if (!this.isRunActive(runId)) return
        tagsBookmarksTask.progress(updates.length)
        this.callbacks.onTagsUpdate(updates, 'bm')
      })
      tagsBookmarksTask.done()

      await classifyIntentGeminiNano(tabs, 'tab', (updates) => {
        if (!this.isRunActive(runId)) return
        intentTabsTask.progress(updates.length)
        this.callbacks.onIntentUpdate(updates, 'tab')
      })
      intentTabsTask.done()
      await classifyIntentGeminiNano(bookmarks, 'bm', (updates) => {
        if (!this.isRunActive(runId)) return
        intentBookmarksTask.progress(updates.length)
        this.callbacks.onIntentUpdate(updates, 'bm')
      })
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
      },
    )
    tagsTabsTask.done()
    await tagWithLmStudio(
      bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
      'bm',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        tagsBookmarksTask.progress(updates.length)
        this.callbacks.onTagsUpdate(updates, 'bm')
      },
    )
    tagsBookmarksTask.done()

    await classifyIntentLmStudio(
      tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
      'tab',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        intentTabsTask.progress(updates.length)
        this.callbacks.onIntentUpdate(updates, 'tab')
      },
      domainMap,
    )
    intentTabsTask.done()
    await classifyIntentLmStudio(
      bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
      'bm',
      settings,
      (updates) => {
        if (!this.isRunActive(runId)) return
        intentBookmarksTask.progress(updates.length)
        this.callbacks.onIntentUpdate(updates, 'bm')
      },
      domainMap,
    )
    intentBookmarksTask.done()
  }

  private async normalizeCategoriesAfterClassification(tabItems: { url: string }[], bookmarkItems: { url: string }[], settings: LlmSettings): Promise<void> {
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

  private async startStandaloneClassifyRun(
    runId: number,
    tabs: TabItem[],
    bookmarks: BookmarkItem[],
    settings: LlmSettings,
  ): Promise<void> {
    this.currentRun = { runId, kind: 'classify', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })

    const tabsTask = this.createTaskTracker(TASK_IDS.CLASSIFY_TABS, 'LLM classifying tabs', tabs.length)
    const bookmarksTask = this.createTaskTracker(TASK_IDS.CLASSIFY_BOOKMARKS, 'LLM classifying bookmarks', bookmarks.length)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      if (settings.providers.browserMl.classificationMethod === 'nli' && settings.tasks.embedding.provider === 'browser-ml') {
        await classifyWithLmStudio(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onCategoryUpdate(updates, 'tab')
          },
        )
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyWithLmStudio(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onCategoryUpdate(updates, 'bm')
          },
        )
      } else if (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        await classifyTabs(tabs, (updates) => {
          if (!this.isRunActive(runId)) return
          tabsTask.progress(updates.length)
          this.callbacks.onCategoryUpdate(updates, 'tab')
        }, settings)
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyBookmarks(bookmarks, (updates) => {
          if (!this.isRunActive(runId)) return
          bookmarksTask.progress(updates.length)
          this.callbacks.onCategoryUpdate(updates, 'bm')
        }, settings)
      } else if (hasChatProviderConfig(settings)) {
        await classifyWithLmStudio(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onCategoryUpdate(updates, 'tab')
          },
        )
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyWithLmStudio(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onCategoryUpdate(updates, 'bm')
          },
        )
      } else {
        throw new Error('LLM unavailable')
      }

      if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
      tabsTask.done()
      bookmarksTask.done()

      const normalizeTask = this.createTaskTracker(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 2)
      await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
      normalizeTask.progress(2)
      normalizeTask.done()

      if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
    } catch (err) {
      tabsTask.failed(err)
      bookmarksTask.failed(err)
      this.emit({ type: 'pipeline-failed', runId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
    }
  }

  private async startStandaloneTagsRun(
    runId: number,
    tabs: TabItem[],
    bookmarks: BookmarkItem[],
    settings: LlmSettings,
  ): Promise<void> {
    this.currentRun = { runId, kind: 'tags', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })
    const tabsTask = this.createTaskTracker(TASK_IDS.TAGS_TABS, 'LLM tagging tabs', tabs.length)
    const bookmarksTask = this.createTaskTracker(TASK_IDS.TAGS_BOOKMARKS, 'LLM tagging bookmarks', bookmarks.length)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      if (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        await tagWithGeminiNano(tabs, 'tab', (updates) => {
          if (!this.isRunActive(runId)) return
          tabsTask.progress(updates.length)
          this.callbacks.onTagsUpdate(updates, 'tab')
        })
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await tagWithGeminiNano(bookmarks, 'bm', (updates) => {
          if (!this.isRunActive(runId)) return
          bookmarksTask.progress(updates.length)
          this.callbacks.onTagsUpdate(updates, 'bm')
        })
      } else if (hasChatProviderConfig(settings)) {
        await tagWithLmStudio(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onTagsUpdate(updates, 'tab')
          },
        )
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await tagWithLmStudio(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onTagsUpdate(updates, 'bm')
          },
        )
      } else {
        throw new Error('LLM unavailable')
      }

      if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
      tabsTask.done()
      bookmarksTask.done()
      if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
    } catch (err) {
      tabsTask.failed(err)
      bookmarksTask.failed(err)
      this.emit({ type: 'pipeline-failed', runId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
    }
  }

  private async startStandaloneIntentRun(
    runId: number,
    tabs: TabItem[],
    bookmarks: BookmarkItem[],
    settings: LlmSettings,
  ): Promise<void> {
    this.currentRun = { runId, kind: 'intent', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })
    const tabsTask = this.createTaskTracker(TASK_IDS.INTENT_TABS, 'LLM intent tabs', tabs.length)
    const bookmarksTask = this.createTaskTracker(TASK_IDS.INTENT_BOOKMARKS, 'LLM intent bookmarks', bookmarks.length)
    try {
      const nanoStatus = await checkLlmAvailability(settings)
      if (settings.providers.browserMl.classificationMethod === 'nli' && settings.tasks.embedding.provider === 'browser-ml') {
        await classifyIntentLmStudio(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates, 'tab')
          },
        )
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyIntentLmStudio(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates, 'bm')
          },
        )
      } else if (settings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
        await classifyIntentGeminiNano(tabs, 'tab', (updates) => {
          if (!this.isRunActive(runId)) return
          tabsTask.progress(updates.length)
          this.callbacks.onIntentUpdate(updates, 'tab')
        })
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyIntentGeminiNano(bookmarks, 'bm', (updates) => {
          if (!this.isRunActive(runId)) return
          bookmarksTask.progress(updates.length)
          this.callbacks.onIntentUpdate(updates, 'bm')
        })
      } else if (hasChatProviderConfig(settings)) {
        await classifyIntentLmStudio(
          tabs.map((t) => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            tabsTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates, 'tab')
          },
        )
        if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
        await classifyIntentLmStudio(
          bookmarks.map((b) => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          settings,
          (updates) => {
            if (!this.isRunActive(runId)) return
            bookmarksTask.progress(updates.length)
            this.callbacks.onIntentUpdate(updates, 'bm')
          },
        )
      } else {
        throw new Error('LLM unavailable')
      }

      if (!this.isRunActive(runId)) { tabsTask.cancel(); bookmarksTask.cancel(); return }
      tabsTask.done()
      bookmarksTask.done()
      if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
    } catch (err) {
      tabsTask.failed(err)
      bookmarksTask.failed(err)
      this.emit({ type: 'pipeline-failed', runId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
    }
  }

  private async startStandaloneNormalizeRun(runId: number, tabs: TabItem[], settings: LlmSettings): Promise<void> {
    this.currentRun = { runId, kind: 'normalize', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })
    const task = this.createTaskTracker(TASK_IDS.NORMALIZE_CATEGORIES, 'Normalize categories', 1)
    try {
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')

      const allLabels = [...new Set(tabs.map((t) => t.category).filter(Boolean) as string[])]
      if (allLabels.length <= 1) {
        task.done()
        if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
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
      const writes = updates.map((u) =>
        setCached('tab', u.url, { category: u.category, parentCategory: u.category, processedAt: Date.now() }),
      )
      await Promise.all(writes)
      if (updates.length > 0) this.callbacks.onCategoryUpdate(updates, 'tab')
      aiPipelineLog.info('pass2 merge categories done', { changes: updates.length })
      task.done()
      if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
    } catch (err) {
      task.failed(err)
      this.emit({ type: 'pipeline-failed', runId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
    }
  }

  private async startStandaloneSplitRun(runId: number, tabs: TabItem[], settings: LlmSettings): Promise<void> {
    this.currentRun = { runId, kind: 'split', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })
    const task = this.createTaskTracker('split-large-categories', 'Split large categories', 1)
    try {
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')
      const allDomains = [...new Set(tabs.map((item) => item.domain).filter(Boolean))]
      const domainMap = await enrichDomains(allDomains, settings)
      const embeddings = await loadCachedEmbeddings()
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
      if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
    } catch (err) {
      task.failed(err)
      this.emit({ type: 'pipeline-failed', runId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
    }
  }

  private async startStandalonePostProcessRun(
    runId: number,
    tabs: TabItem[],
    bookmarks: BookmarkItem[],
    settings: LlmSettings,
  ): Promise<void> {
    this.currentRun = { runId, kind: 'postprocess', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })
    const task = this.createTaskTracker(TASK_IDS.NORMALIZE_CATEGORIES, 'Post-process categories', 1)
    try {
      if (!hasChatProviderConfig(settings)) throw new Error('LLM unavailable')
      await this.normalizeCategoriesAfterClassification(tabs, bookmarks, settings)
      task.done()
      if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
    } catch (err) {
      task.failed(err)
      this.emit({ type: 'pipeline-failed', runId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
    }
  }

  private async startStandaloneEmbeddingRun(
    runId: number,
    items: { url: string; title: string; domain: string; category?: string }[],
    settings: LlmSettings,
  ): Promise<void> {
    this.currentRun = { runId, kind: 'embedding', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })
    const task = this.createTaskTracker(TASK_IDS.EMBEDDINGS, 'LLM calc embeddings', items.length)
    try {
      if (!hasEmbeddingProviderConfig(settings)) throw new Error('Embedding provider unavailable')
      await fetchEmbeddingsBatch(items, settings, (updates) => task.progress(updates.length))
      const points = await reprojectAllEmbeddings()
      this.callbacks.onProjectedPoints(points)
      task.done()
      if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
    } catch (err) {
      task.failed(err)
      this.emit({ type: 'pipeline-failed', runId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
    }
  }

  private async startStandaloneDomainRun(runId: number, domains: string[], settings: LlmSettings, force: boolean): Promise<void> {
    this.currentRun = { runId, kind: 'domain', cancelled: false }
    this.clearTasks()
    this.emit({ type: 'pipeline-start', runId })
    const estimatedWork = await estimateDomainEnrichmentWork(domains)
    const task = this.createTaskTracker(TASK_IDS.DOMAINS, 'LLM domain knowledge', Math.max(estimatedWork, 1))
    try {
      if (!hasDomainKnowledgeProviderConfig(settings)) throw new Error('Domain enrichment provider unavailable')
      if (force) await clearDomainKnowledgeCache()
      const domainMap = await enrichDomains(domains, settings, (delta) => task.progress(delta))
      this.callbacks.onDomainMap(domainMap)
      task.done()
      if (this.isRunActive(runId)) this.emit({ type: 'pipeline-done', runId })
    } catch (err) {
      task.failed(err)
      this.emit({ type: 'pipeline-failed', runId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.currentRun?.runId === runId) this.currentRun = null
    }
  }
}
