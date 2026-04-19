import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderTree, Globe, Layers, Monitor } from 'lucide-react'
import { Favicon } from '@/components/Favicon'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import type { SourceFilter } from '@/components/views/types'
import type { BookmarkItem, TabItem } from '@/lib/core/types'

type GroupMode = 'category' | 'folder' | 'domain' | 'source' | 'window'

const GROUP_MODE_LABEL: Record<GroupMode, string> = {
  category: 'Category',
  folder: 'Bookmark Folder',
  domain: 'Domain',
  source: 'Source',
  window: 'Window',
}

const GROUP_MIN_WIDTH_PX = 280
const GROUP_COLUMN_GAP_PX = 28

interface ListViewProps {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  sourceFilter: SourceFilter
  loading: boolean
  viewMenuHost?: HTMLElement | null
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
  windowLabel?: string
  favIconUrl?: string
}

export function ListView({
  bookmarks,
  tabs,
  sourceFilter,
  loading,
  viewMenuHost = null,
}: ListViewProps) {
  const [groupMode, setGroupMode] = useState<GroupMode>(() => defaultGroupModeForSource(sourceFilter))
  const [columnCount, setColumnCount] = useState(1)
  const groupsContainerRef = useRef<HTMLDivElement | null>(null)

  const availableModes = useMemo(() => modesForSource(sourceFilter), [sourceFilter])

  useEffect(() => {
    setGroupMode(defaultGroupModeForSource(sourceFilter))
  }, [sourceFilter])

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

    const windowOrder = new Map<number, number>()
    let nextWindowIndex = 1
    for (const tab of tabs) {
      if (!windowOrder.has(tab.windowId)) {
        windowOrder.set(tab.windowId, nextWindowIndex)
        nextWindowIndex += 1
      }
    }

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
        windowLabel: `Window ${windowOrder.get(tab.windowId) ?? 0}`,
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

  useEffect(() => {
    const el = groupsContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const updateColumns = () => {
      const width = el.clientWidth
      if (!width) return
      const next = Math.max(
        1,
        Math.floor((width + GROUP_COLUMN_GAP_PX) / (GROUP_MIN_WIDTH_PX + GROUP_COLUMN_GAP_PX)),
      )
      setColumnCount(next)
    }

    updateColumns()
    const observer = new ResizeObserver(() => updateColumns())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const groupedColumns = useMemo(() => {
    const colCount = Math.max(1, columnCount)
    const columns = Array.from({ length: colCount }, () => [] as typeof groups)
    const weights = Array.from({ length: colCount }, () => 0)

    for (const group of groups) {
      let targetIdx = 0
      for (let i = 1; i < colCount; i += 1) {
        if (weights[i] < weights[targetIdx]) targetIdx = i
      }
      columns[targetIdx].push(group)
      // Rough height estimate to keep columns visually balanced.
      weights[targetIdx] += 2 + group.items.length
    }

    return columns
  }, [columnCount, groups])

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
    <section className="space-y-2">
      {(viewMenuHost
        ? createPortal((
          <div className="flex items-center gap-2 py-2">
            <Select value={groupMode} onValueChange={(value) => setGroupMode(value as GroupMode)}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <span className="truncate">Group: {GROUP_MODE_LABEL[groupMode]}</span>
              </SelectTrigger>
              <SelectContent className="text-xs">
                {availableModes.map((mode) => (
                  <SelectItem key={mode} value={mode} className="py-0.5 px-2 text-xs">
                    {GROUP_MODE_LABEL[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ), viewMenuHost)
        : (
      <div className="flex items-center gap-2">
        <Select value={groupMode} onValueChange={(value) => setGroupMode(value as GroupMode)}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <span className="truncate">Group: {GROUP_MODE_LABEL[groupMode]}</span>
          </SelectTrigger>
          <SelectContent className="text-xs">
            {availableModes.map((mode) => (
              <SelectItem key={mode} value={mode} className="py-0.5 px-2 text-xs">
                {GROUP_MODE_LABEL[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
        ))}

      <div
        ref={groupsContainerRef}
        className="grid items-start gap-x-7"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, columnCount)}, minmax(0, 1fr))` }}
      >
        {groupedColumns.map((columnGroups, columnIdx) => (
          <div key={`col-${columnIdx}`} className="min-w-0 space-y-4">
            {columnGroups.map((group) => (
              <section key={group.name} className="min-w-0">
                <header className="mb-2 flex items-center justify-between border-b border-border/45 pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <GroupIcon mode={groupMode} />
                    <h3 className="min-w-0 text-sm font-medium text-foreground" title={group.name}>
                      <GroupName mode={groupMode} name={group.name} />
                    </h3>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{group.items.length}</span>
                </header>
                <div>
                  {group.items.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void openItem(item)}
                      className={`flex w-full items-start gap-2 px-0 py-1.5 text-left text-muted-foreground/85 transition-colors hover:bg-card/20 hover:text-foreground ${index < group.items.length - 1 ? 'border-b border-border/15' : ''}`}
                      title={item.url}
                    >
                      <Favicon domain={item.domain} src={item.favIconUrl} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium leading-5 text-foreground/78">{item.title}</div>
                        <div className="truncate text-[11px] leading-4 text-muted-foreground/45">{item.domain}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function groupKey(item: ListItem, mode: GroupMode): string {
  if (mode === 'domain') return item.domain || 'Unknown domain'
  if (mode === 'folder') return item.folder || 'Root'
  if (mode === 'source') return item.source === 'tab' ? 'Open tabs' : 'Bookmarks'
  if (mode === 'window') return item.windowLabel || 'Unknown window'
  return item.category || 'Uncategorized'
}

function GroupIcon({ mode }: { mode: GroupMode }) {
  if (mode === 'domain') return <Globe className="h-3.5 w-3.5 shrink-0 self-start mt-0.5 text-muted-foreground/70" />
  if (mode === 'folder') return <FolderTree className="h-3.5 w-3.5 shrink-0 self-start mt-0.5 text-muted-foreground/70" />
  if (mode === 'window') return <Monitor className="h-3.5 w-3.5 shrink-0 self-start mt-0.5 text-muted-foreground/70" />
  if (mode === 'source') return <Layers className="h-3.5 w-3.5 shrink-0 self-start mt-0.5 text-muted-foreground/70" />
  return <Layers className="h-3.5 w-3.5 shrink-0 self-start mt-0.5 text-muted-foreground/70" />
}

function GroupName({ mode, name }: { mode: GroupMode; name: string }) {
  if (mode !== 'folder') {
    return <span className="block truncate">{name}</span>
  }

  const parts = name.split('/').map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 1) return <span className="block truncate">{name}</span>

  return (
    <span className="flex min-w-0 items-baseline gap-1 overflow-hidden">
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        return (
          <span
            key={`${part}-${index}`}
            className={isLast ? 'truncate text-foreground' : 'shrink-0 text-muted-foreground/60'}
          >
            {!isLast ? `${part}/` : part}
          </span>
        )
      })}
    </span>
  )
}

function defaultGroupModeForSource(sourceFilter: SourceFilter): GroupMode {
  if (sourceFilter === 'tabs') return 'window'
  if (sourceFilter === 'bookmarks') return 'folder'
  return 'category'
}

function modesForSource(sourceFilter: SourceFilter): GroupMode[] {
  if (sourceFilter === 'tabs') return ['window', 'category', 'domain']
  if (sourceFilter === 'bookmarks') return ['folder', 'category', 'domain']
  return ['category', 'source', 'domain', 'folder']
}
