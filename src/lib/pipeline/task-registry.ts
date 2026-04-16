import { aiPipelineLog } from '../core/logger'
import type { PipelineEvent, PipelineListener, TaskHandle, TaskId, TaskState } from './types'

export class TaskRegistry {
  private readonly tasks = new Map<TaskId, TaskState>()
  private readonly listeners = new Set<PipelineListener>()

  subscribe(listener: PipelineListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  getTasks(): TaskState[] {
    return [...this.tasks.values()]
  }

  getTask(id: TaskId): TaskState | undefined {
    return this.tasks.get(id)
  }

  clear(): void {
    this.tasks.clear()
  }

  setTask(task: TaskState): void {
    this.tasks.set(task.id, task)
    this.emit({ type: 'task-update', task })
  }

  updateTask(id: TaskId, patch: Partial<TaskState>): void {
    const existing = this.tasks.get(id)
    if (!existing) return
    const next = { ...existing, ...patch }
    this.tasks.set(id, next)
    this.emit({ type: 'task-update', task: next })
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
      id,
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

  cancelAllActive(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'running' || task.status === 'pending') {
        this.updateTask(task.id, { status: 'cancelled', finishedAt: Date.now() })
      }
    }
  }

  failAllActive(error: string): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'running' || task.status === 'pending') {
        this.updateTask(task.id, { status: 'failed', finishedAt: Date.now(), error })
      }
    }
  }
}
