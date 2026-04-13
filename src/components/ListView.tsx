import { CombinedListTable } from '@/components/CombinedListTable'
import type { SourceFilter } from '@/components/views/types'
import type { BookmarkItem, LlmSettings, TabItem } from '@/lib/types'

interface ListViewProps {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  sourceFilter: SourceFilter
  settings: LlmSettings
  loading: boolean
  onDeleteBookmark: (id: string) => Promise<void>
  onExport?: () => Promise<void>
  onCloseTab: (id: number) => Promise<void>
  onActivateTab: (id: number) => Promise<void>
  viewMenuHost?: HTMLElement | null
}

export function ListView({
  bookmarks,
  tabs,
  sourceFilter,
  settings,
  loading,
  onDeleteBookmark,
  onExport,
  onCloseTab,
  onActivateTab,
  viewMenuHost,
}: ListViewProps) {
  return (
    <CombinedListTable
      bookmarks={bookmarks}
      tabs={tabs}
      sourceFilterLabel={sourceFilter}
      settings={settings}
      loading={loading}
      onDeleteBookmark={(id) => void onDeleteBookmark(id)}
      onCloseTab={(id) => void onCloseTab(id)}
      onActivateTab={(id) => void onActivateTab(id)}
      onExport={onExport}
      menuHost={viewMenuHost}
    />
  )
}
