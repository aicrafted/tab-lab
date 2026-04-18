import { useMemo, useState } from 'react'
import { Bookmark, FolderTree, Globe, Layers, Monitor } from 'lucide-react'
import { Favicon } from '@/components/Favicon'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import type { SourceFilter } from '@/components/views/types'
import type { BookmarkItem, TabItem } from '@/lib/core/types'

type GroupMode = 'category' | 'folder' | 'domain' | 'source'

interface ListViewProps {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  sourceFilter: SourceFilter
  loading: boolean
}

interface ListItem {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  category: string
  folder: string
  tabId?: number
  windowId?: number
  favIconUrl?: string
}

export function ListView({
  bookmarks,
  tabs,
  sourceFilter,
  loading,
}: ListViewProps) {
  const [groupMode, setGroupMode] = useState<GroupMode>('category')

  const items = useMemo<ListItem[]>(() => {
    const bookmarkItems: ListItem[] = sourceFilter === 'tabs'
      ? []
      : bookmarks.map((bookmark) => ({
        id: `bm-${bookmark.id}`,
        source: 'bookmark',
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        category: bookmark.category?.trim() || 'Uncategorized',
        folder: bookmark.folder?.trim() || 'Root',
      }))

    const tabItems: ListItem[] = sourceFilter === 'bookmarks'
      ? []
      : tabs.map((tab) => ({
        id: `tab-${tab.id}`,
        source: 'tab',
        title: tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        category: tab.category?.trim() || 'Uncategorized',
        folder: tab.bookmarkFolder?.trim() || 'Open tabs',
        tabId: tab.id,
        windowId: tab.windowId,
        favIconUrl: tab.favIconUrl,
      }))

    return [...bookmarkItems, ...tabItems]
  }, [bookmarks, sourceFilter, tabs])

  const groups = useMemo(() => {
    const byGroup = new Map<string, ListItem[]>()
    for (const item of items) {
      const key = groupKey(item, groupMode)
      const current = byGroup.get(key) ?? []
      current.push(item)
      byGroup.set(key, current)
    }
    return Array.from(byGroup.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, groupItems]) => ({
        name,
        items: groupItems.sort((a, b) => a.title.localeCompare(b.title)),
      }))
  }, [groupMode, items])

  async function openItem(item: ListItem) {
    if (item.source === 'tab' && item.tabId != null && item.windowId != null) {
      await chrome.tabs.update(item.tabId, { active: true })
      await chrome.windows.update(item.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: item.url })
  }

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading list view...</div>
  }

  if (items.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No items for current filters.</div>
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={groupMode} onValueChange={(value) => setGroupMode(value as GroupMode)}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <span className="truncate">Group: {groupMode}</span>
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="category" className="py-0.5 px-2 text-xs">Category</SelectItem>
            <SelectItem value="folder" className="py-0.5 px-2 text-xs">Bookmark Folder</SelectItem>
            <SelectItem value="domain" className="py-0.5 px-2 text-xs">Domain</SelectItem>
            <SelectItem value="source" className="py-0.5 px-2 text-xs">Source</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {groups.map((group) => (
          <section key={group.name} className="rounded-md border border-border/60 bg-card/20">
            <header className="flex items-center justify-between border-b border-border/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <GroupIcon mode={groupMode} />
                <h3 className="truncate text-sm font-medium text-foreground" title={group.name}>
                  {group.name}
                </h3>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{group.items.length}</span>
            </header>
            <div className="divide-y divide-border/30">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openItem(item)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-background/40"
                  title={item.url}
                >
                  <Favicon domain={item.domain} src={item.favIconUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">{item.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{item.domain}</div>
                  </div>
                  <SourceIcon source={item.source} />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function groupKey(item: ListItem, mode: GroupMode): string {
  if (mode === 'domain') return item.domain || 'Unknown domain'
  if (mode === 'folder') return item.folder || 'Root'
  if (mode === 'source') return item.source === 'tab' ? 'Open tabs' : 'Bookmarks'
  return item.category || 'Uncategorized'
}

function GroupIcon({ mode }: { mode: GroupMode }) {
  if (mode === 'domain') return <Globe className="h-3.5 w-3.5 text-muted-foreground/70" />
  if (mode === 'folder') return <FolderTree className="h-3.5 w-3.5 text-muted-foreground/70" />
  if (mode === 'source') return <Layers className="h-3.5 w-3.5 text-muted-foreground/70" />
  return <Layers className="h-3.5 w-3.5 text-muted-foreground/70" />
}

function SourceIcon({ source }: { source: 'tab' | 'bookmark' }) {
  if (source === 'tab') return <Monitor className="h-3 w-3 text-muted-foreground/70" />
  return <Bookmark className="h-3 w-3 text-muted-foreground/70" />
}
