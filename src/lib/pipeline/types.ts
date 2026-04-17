import type { DomainInfo } from '../ai/domain-enricher'
import type { BookmarkItem, LlmSettings, PageIntent, TabItem } from '../core/types'

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
  onCategoryUpdate: (updates: { url: string; category: string; parentCategory?: string }[]) => void
  onTagsUpdate: (updates: { url: string; tags: string[] }[]) => void
  onIntentUpdate: (updates: { url: string; intent: PageIntent }[]) => void
  onClusterUpdate: (updates: { url: string; clusterId: number }[]) => void
  onClusterNames: (names: Map<number, string>) => void
  onProjectedPoints: (points: Map<string, [number, number]>) => void
  onDomainMap: (domainMap: Map<string, DomainInfo>) => void
}

export interface TaskHandle {
  id: TaskId
  progress: (delta: number) => void
  done: (extra?: Record<string, unknown>) => void
  failed: (error: unknown) => void
  cancel: () => void
}

export type PipelineListener = (event: PipelineEvent) => void

export interface RunContext {
  runId: number
  cancelled: boolean
  kind: 'auto' | 'domain' | 'embedding' | 'classify' | 'tags' | 'intent' | 'normalize' | 'split' | 'postprocess' | 'grouprare'
  abortController: AbortController
}

export interface AutoRunRequest {
  runId: number
  tabs: TabItem[]
  bookmarks: BookmarkItem[]
  settings: LlmSettings
}
