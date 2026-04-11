import type { BookmarkItem, TabItem } from '@/lib/types'

export type SourceFilter = 'bookmarks' | 'tabs' | 'both'

export type ViewId =
  | 'list'
  | 'triage'
  | 'kanban'
  | 'timeline'
  | 'magazine'
  | 'treemap'
  | 'semantic'
  | 'heatmap'
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

export interface ViewProps {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  loading: boolean
  projectedPoints?: Map<string, [number, number]>
  onRunTags?: () => Promise<void>
  onRunEmbeddings?: () => Promise<void>
}

