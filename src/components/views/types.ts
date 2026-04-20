import type { BookmarkItem, TabItem, LlmSettings } from '@/lib/core/types'

export type SourceFilter = 'bookmarks' | 'tabs' | 'both'

export type ViewId =
  | 'list'
  | 'table'
  | 'triage'
  | 'kanban'
  | 'timeline'
  | 'magazine'
  | 'treemap'
  | 'semantic'
  | 'domain-graph'
  | 'reading-queue'
  | 'tag-constellation'
  | 'personal-radar'
  | 'topic-river'
  | 'domain-drill-down'
  | 'focus-rings'
  | 'tag-cooccurrence'
  | 'shelf-view'
  | 'overlap-explorer'
  | 'shadow-map'
  | 'session-story'
  | 'settings-llm'
  | 'settings-knowledge'
  | 'settings-advanced'

export interface ViewProps {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  sourceFilter?: SourceFilter
  loading: boolean
  projectedPoints?: Map<string, [number, number]>
  clusterNames?: Map<number, string>
  onRunTags?: () => Promise<void>
  onRunEmbeddings?: () => Promise<void>
  llmSettings?: LlmSettings
  onSaveSettings?: (settings: LlmSettings) => Promise<void>
  viewMenuHost?: HTMLElement | null
}
