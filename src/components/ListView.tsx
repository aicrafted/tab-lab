import { BookmarksTable } from '@/components/BookmarksTable'
import { TabsTable } from '@/components/TabsTable'
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
  if (sourceFilter === 'bookmarks') {
    return (
      <BookmarksTable
        data={bookmarks}
        settings={settings}
        loading={loading}
        onDelete={(id) => void onDeleteBookmark(id)}
        onExport={onExport}
        menuHost={viewMenuHost}
      />
    )
  }

  if (sourceFilter === 'tabs') {
    return (
      <TabsTable
        data={tabs}
        settings={settings}
        loading={loading}
        onClose={(id) => void onCloseTab(id)}
        onActivate={(id) => void onActivateTab(id)}
        menuHost={viewMenuHost}
      />
    )
  }

  return (
    <div className="space-y-5">
      <TabsTable
        data={tabs}
        settings={settings}
        loading={loading}
        onClose={(id) => void onCloseTab(id)}
        onActivate={(id) => void onActivateTab(id)}
      />
      <BookmarksTable
        data={bookmarks}
        settings={settings}
        loading={loading}
        onDelete={(id) => void onDeleteBookmark(id)}
        onExport={onExport}
      />
    </div>
  )
}
