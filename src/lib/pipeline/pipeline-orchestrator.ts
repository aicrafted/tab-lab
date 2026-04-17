import type { BookmarkItem, LlmSettings, TabItem } from '../core/types'
import { PipelineRunner } from './pipeline-runner'
import { TaskRegistry } from './task-registry'
import type { AutoRunRequest, PipelineCallbacks, PipelineListener, RunContext, TaskId, TaskState } from './types'

export * from './types'

export class PipelineOrchestrator {
  private readonly registry = new TaskRegistry()
  private readonly runner: PipelineRunner
  private currentRun: RunContext | null = null
  private runSeq = 0
  private pendingAuto: AutoRunRequest | null = null

  constructor(callbacks: PipelineCallbacks) {
    this.runner = new PipelineRunner(this.registry, callbacks)
  }

  subscribe(listener: PipelineListener): () => void {
    return this.registry.subscribe(listener)
  }

  getTasks(): TaskState[] {
    return this.registry.getTasks()
  }

  getTask(id: TaskId): TaskState | undefined {
    return this.registry.getTask(id)
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

  enqueueEmbeddingPass(items: { url: string; title: string; domain: string; category?: string }[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('embedding', runId, async () => {
      await this.runner.startStandaloneEmbeddingRun(runId, items, settings)
    })
    return runId
  }

  enqueueDomainPass(domains: string[], settings: LlmSettings, force = false): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('domain', runId, async () => {
      await this.runner.startStandaloneDomainRun(runId, domains, settings, force)
    })
    return runId
  }

  enqueueLabelsPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('tags', runId, async () => {
      await this.runner.startStandaloneLabelsRun(runId, tabs, bookmarks, settings)
    })
    return runId
  }

  enqueueClassifyPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('classify', runId, async () => {
      await this.runner.startStandaloneClassifyRun(runId, tabs, bookmarks, settings)
    })
    return runId
  }

  enqueueTagsPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('tags', runId, async () => {
      await this.runner.startStandaloneTagsRun(runId, tabs, bookmarks, settings)
    })
    return runId
  }

  enqueueIntentPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('intent', runId, async () => {
      await this.runner.startStandaloneIntentRun(runId, tabs, bookmarks, settings)
    })
    return runId
  }

  enqueueNormalizePass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('normalize', runId, async () => {
      await this.runner.startStandaloneNormalizeRun(runId, tabs, bookmarks, settings)
    })
    return runId
  }

  enqueueSplitPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('split', runId, async () => {
      await this.runner.startStandaloneSplitRun(runId, tabs, bookmarks, settings)
    })
    return runId
  }

  enqueuePostProcessPass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('postprocess', runId, async () => {
      await this.runner.startStandalonePostProcessRun(runId, tabs, bookmarks, settings)
    })
    return runId
  }

  enqueueGroupRarePass(tabs: TabItem[], bookmarks: BookmarkItem[], settings: LlmSettings): number {
    const runId = ++this.runSeq
    if (this.currentRun) return runId
    void this.startStandaloneRun('grouprare', runId, async () => {
      await this.runner.startStandaloneGroupRareRun(runId, tabs, bookmarks, settings)
    })
    return runId
  }

  cancelCurrent(): void {
    if (!this.currentRun) return
    this.cancel(this.currentRun.runId)
  }

  cancel(runId: number): void {
    if (!this.currentRun || this.currentRun.runId !== runId) return
    this.currentRun.cancelled = true
    this.currentRun.abortController.abort()
    this.registry.cancelAllActive()
    this.registry.emit({ type: 'pipeline-cancelled', runId })
  }

  private async startAutoRun(req: AutoRunRequest): Promise<void> {
    const { runId, tabs, bookmarks, settings } = req
    this.currentRun = { runId, kind: 'auto', cancelled: false, abortController: new AbortController() }
    this.runner.setCurrentRun(this.currentRun)
    this.registry.clear()
    this.registry.emit({ type: 'pipeline-start', runId })
    try {
      await this.runner.executeAutoPipeline(runId, tabs, bookmarks, settings)
      if (this.isRunActive(runId)) {
        this.registry.emit({ type: 'pipeline-done', runId })
      }
    } catch (err) {
      this.handleRunError(runId, err)
    } finally {
      this.cleanupRun(runId)
      const pending = this.pendingAuto
      this.pendingAuto = null
      if (pending) void this.startAutoRun(pending)
    }
  }

  private async startStandaloneRun(kind: RunContext['kind'], runId: number, task: () => Promise<void>): Promise<void> {
    this.currentRun = { runId, kind, cancelled: false, abortController: new AbortController() }
    this.runner.setCurrentRun(this.currentRun)
    this.registry.clear()
    this.registry.emit({ type: 'pipeline-start', runId })
    try {
      await task()
      if (this.isRunActive(runId)) {
        this.registry.emit({ type: 'pipeline-done', runId })
      }
    } catch (err) {
      this.handleRunError(runId, err)
    } finally {
      this.cleanupRun(runId)
    }
  }

  private handleRunError(runId: number, err: unknown) {
    if (this.currentRun?.cancelled) {
      this.registry.emit({ type: 'pipeline-cancelled', runId })
    } else {
      const error = err instanceof Error ? err.message : String(err)
      this.registry.failAllActive(error)
      this.registry.emit({ type: 'pipeline-failed', runId, error })
    }
  }

  private cleanupRun(runId: number) {
    if (this.currentRun?.runId === runId) {
      this.currentRun = null
      this.runner.setCurrentRun(null)
    }
  }

  private isRunActive(runId: number): boolean {
    return Boolean(this.currentRun && this.currentRun.runId === runId && !this.currentRun.cancelled)
  }
}
