import { BookmarksTable } from '@/components/BookmarksTable'
import { CombinedListTable } from '@/components/CombinedListTable'
import { TabsTable } from '@/components/TabsTable'
import type { SourceFilter } from '@/components/views/types'
import type { BookmarkItem, LlmSettings, TabItem } from '@/lib/core/types'

interface ListViewProps {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  localUrlSet: Set<string>
  sourceFilter: SourceFilter
  settings: LlmSettings
  loading: boolean
  onDeleteBookmark: (id: string) => Promise<void>
  onCloseTab: (id: number) => Promise<void>
  onActivateTab: (id: number) => Promise<void>
  viewMenuHost?: HTMLElement | null
}

export function ListView({
  bookmarks,
  tabs,
  localUrlSet,
  sourceFilter,
  settings,
  loading,
  onDeleteBookmark,
  onCloseTab,
  onActivateTab,
  viewMenuHost,
}: ListViewProps) {
  if (sourceFilter === 'bookmarks') {
    return (
      <BookmarksTable
        data={bookmarks}
        localUrlSet={localUrlSet}
        settings={settings}
        loading={loading}
        onDelete={(id) => void onDeleteBookmark(id)}
        menuHost={viewMenuHost}
      />
    )
  }

  if (sourceFilter === 'tabs') {
    return (
      <TabsTable
        data={tabs}
        localUrlSet={localUrlSet}
        settings={settings}
        loading={loading}
        onClose={(id) => void onCloseTab(id)}
        onActivate={(id) => void onActivateTab(id)}
        menuHost={viewMenuHost}
      />
    )
  }

  return (
    <CombinedListTable
      bookmarks={bookmarks}
      tabs={tabs}
      localUrlSet={localUrlSet}
      sourceFilterLabel={sourceFilter}
      settings={settings}
      loading={loading}
      onDeleteBookmark={(id) => void onDeleteBookmark(id)}
      onCloseTab={(id) => void onCloseTab(id)}
      onActivateTab={(id) => void onActivateTab(id)}
      menuHost={viewMenuHost}
    />
  )
}
