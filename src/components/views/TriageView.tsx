import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FolderTree, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BookmarkItem, TabItem } from '@/lib/core/types'
import type { ViewProps } from '@/components/views/types'
import { effectiveIntent } from '@/lib/ai/static-intent'
import { formatAge, formatDate } from '@/lib/core/utils'

const STALE_BOOKMARK_AFTER_MS = 180 * 86_400_000
const STALE_TAB_AFTER_MS = 30 * 86_400_000
const TRIAGE_SECTION_MIN_WIDTH_PX = 360
const TRIAGE_COLUMN_GAP_PX = 20

interface MultiFolderEntry {
  url: string
  title: string
  domain: string
  folders: string[]
}

export function TriageView({ bookmarks, tabs, loading, sourceFilter = 'both' }: ViewProps) {
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [removedTabIds, setRemovedTabIds] = useState<number[]>([])
  const [openFolders, setOpenFolders] = useState<string[]>([])
  const [columnCount, setColumnCount] = useState(1)
  const sectionsContainerRef = useRef<HTMLDivElement | null>(null)

  const showBookmarks = sourceFilter !== 'tabs'
  const showTabs = sourceFilter !== 'bookmarks'

  const removedSet = useMemo(() => new Set(removedIds), [removedIds])
  const removedTabSet = useMemo(() => new Set(removedTabIds), [removedTabIds])

  const visibleBookmarks = useMemo(
    () => bookmarks.filter((bookmark) => !removedSet.has(bookmark.id)),
    [bookmarks, removedSet],
  )

  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !removedTabSet.has(tab.id)),
    [tabs, removedTabSet],
  )

  const duplicateBookmarks = useMemo(
    () => visibleBookmarks.filter((bookmark) => bookmark.isDuplicate === true),
    [visibleBookmarks],
  )

  const duplicateTabs = useMemo(
    () => visibleTabs.filter((tab) => tab.isDuplicate === true),
    [visibleTabs],
  )

  const alreadyBookmarked = useMemo(
    () => visibleTabs.filter((tab) => tab.isBookmarked === true),
    [visibleTabs],
  )

  const neverOpened = useMemo(
    () => visibleBookmarks.filter((bookmark) => bookmark.lastVisited == null && bookmark.visitCount == null),
    [visibleBookmarks],
  )

  const transactionalBookmarks = useMemo(
    () => visibleBookmarks.filter((bookmark) => effectiveIntent(bookmark) === 'transactional'),
    [visibleBookmarks],
  )

  const transactionalTabs = useMemo(
    () => visibleTabs.filter((tab) => effectiveIntent(tab) === 'transactional'),
    [visibleTabs],
  )

  const staleBookmarkCutoff = Date.now() - STALE_BOOKMARK_AFTER_MS
  const staleTabCutoff = Date.now() - STALE_TAB_AFTER_MS
  const staleBookmarks = useMemo(
    () => visibleBookmarks.filter((bookmark) => bookmark.lastVisited != null && bookmark.lastVisited < staleBookmarkCutoff),
    [visibleBookmarks, staleBookmarkCutoff],
  )
  const staleTabs = useMemo(
    () => visibleTabs.filter((tab) => tab.lastAccessed < staleTabCutoff),
    [visibleTabs, staleTabCutoff],
  )

  const openNow = useMemo(
    () => visibleBookmarks.filter((bookmark) => bookmark.isOpen === true),
    [visibleBookmarks],
  )

  const multiFolder = useMemo<MultiFolderEntry[]>(() => {
    const byUrl = new Map<string, { title: string; domain: string; folders: Set<string> }>()
    for (const bookmark of visibleBookmarks) {
      const entry = byUrl.get(bookmark.url) ?? {
        title: bookmark.title,
        domain: bookmark.domain,
        folders: new Set<string>(),
      }
      if (bookmark.folder) entry.folders.add(bookmark.folder)
      byUrl.set(bookmark.url, entry)
    }
    return Array.from(byUrl.entries())
      .map(([url, value]) => ({
        url,
        title: value.title,
        domain: value.domain,
        folders: Array.from(value.folders).sort((a, b) => a.localeCompare(b)),
      }))
      .filter((entry) => entry.folders.length > 1)
      .sort((a, b) => b.folders.length - a.folders.length)
  }, [visibleBookmarks])

  const sectionsCount = [
    showBookmarks ? duplicateBookmarks.length : 0,
    showBookmarks ? neverOpened.length : 0,
    (showBookmarks ? transactionalBookmarks.length : 0) + (showTabs ? transactionalTabs.length : 0),
    (showBookmarks ? staleBookmarks.length : 0) + (showTabs ? staleTabs.length : 0),
    showBookmarks ? openNow.length : 0,
    showBookmarks ? multiFolder.length : 0,
    showTabs ? duplicateTabs.length : 0,
    showTabs ? alreadyBookmarked.length : 0,
  ].reduce((sum, count) => sum + count, 0)

  const emptyMessage = sourceFilter === 'tabs'
    ? 'No triage issues found in current tabs.'
    : sourceFilter === 'bookmarks'
      ? 'No triage issues found in current bookmarks.'
      : 'No triage issues found.'

  useEffect(() => {
    const el = sectionsContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const updateColumns = () => {
      const width = el.clientWidth
      if (!width) return
      const next = Math.max(
        1,
        Math.floor((width + TRIAGE_COLUMN_GAP_PX) / (TRIAGE_SECTION_MIN_WIDTH_PX + TRIAGE_COLUMN_GAP_PX)),
      )
      setColumnCount(next)
    }

    updateColumns()
    const observer = new ResizeObserver(() => updateColumns())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  async function removeBookmark(id: string) {
    try {
      await chrome.bookmarks.remove(id)
      setRemovedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } catch (error) {
      console.error('Failed to remove bookmark', error)
    }
  }

  async function closeTab(id: number) {
    try {
      await chrome.tabs.remove(id)
      setRemovedTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } catch (error) {
      console.error('Failed to close tab', error)
    }
  }

  async function openUrl(url: string) {
    await chrome.tabs.create({ url })
  }

  async function goToOpenTab(url: string) {
    const tab = tabs.find((item) => item.url === url)
    if (!tab) {
      await openUrl(url)
      return
    }
    await activateTab(tab.id, tab.windowId)
  }

  async function activateTab(id: number, windowId: number) {
    try {
      await chrome.tabs.update(id, { active: true })
      await chrome.windows.update(windowId, { focused: true })
    } catch (error) {
      console.error('Failed to activate tab', error)
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading triage data...</div>
  }

  if (sectionsCount === 0) {
    return <div className="p-8 text-sm text-muted-foreground">{emptyMessage}</div>
  }

  const sections: Array<{ key: string; weight: number; content: JSX.Element }> = []

  if (showTabs && duplicateTabs.length > 0) {
    sections.push({
      key: 'duplicate-tabs',
      weight: 2 + duplicateTabs.length,
      content: (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Duplicate tabs ({duplicateTabs.length})
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {duplicateTabs.map((tab) => (
              <TabRow
                key={tab.id}
                tab={tab}
                actions={(
                  <Button type="button" size="sm" variant="outline" onClick={() => void closeTab(tab.id)}>
                    <X className="h-3.5 w-3.5" />
                    Close duplicate
                  </Button>
                )}
              />
            ))}
          </div>
        </details>
      ),
    })
  }

  if (showTabs && alreadyBookmarked.length > 0) {
    sections.push({
      key: 'already-bookmarked-tabs',
      weight: 2 + alreadyBookmarked.length,
      content: (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Already bookmarked ({alreadyBookmarked.length}) — these tabs are already saved in bookmarks.
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {alreadyBookmarked.map((tab) => (
              <TabRow
                key={tab.id}
                tab={tab}
                actions={(
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void activateTab(tab.id, tab.windowId)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Go to tab
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void closeTab(tab.id)}>
                      <X className="h-3.5 w-3.5" />
                      Close tab
                    </Button>
                  </div>
                )}
              />
            ))}
          </div>
        </details>
      ),
    })
  }

  if (showBookmarks && duplicateBookmarks.length > 0) {
    sections.push({
      key: 'duplicate-bookmarks',
      weight: 2 + duplicateBookmarks.length,
      content: (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Duplicate bookmarks ({duplicateBookmarks.length})
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {duplicateBookmarks.map((bookmark) => (
              <BookmarkRow
                key={bookmark.id}
                bookmark={bookmark}
                actions={(
                  <Button type="button" size="sm" variant="outline" onClick={() => void removeBookmark(bookmark.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete duplicate
                  </Button>
                )}
              />
            ))}
          </div>
        </details>
      ),
    })
  }

  if ((showBookmarks && staleBookmarks.length > 0) || (showTabs && staleTabs.length > 0)) {
    sections.push({
      key: 'stale',
      weight: 3 + (showBookmarks ? staleBookmarks.length : 0) + (showTabs ? staleTabs.length : 0),
      content: (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Stale ({(showBookmarks ? staleBookmarks.length : 0) + (showTabs ? staleTabs.length : 0)})
          </summary>
          <div className="space-y-3 border-t border-border px-3 py-3">
            {showTabs && staleTabs.length > 0 && (
              <div className="space-y-2">
                <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Tabs ({staleTabs.length})
                </p>
                {staleTabs.map((tab) => (
                  <TabRow
                    key={tab.id}
                    tab={tab}
                    actions={(
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void activateTab(tab.id, tab.windowId)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Go to tab
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void closeTab(tab.id)}>
                          <X className="h-3.5 w-3.5" />
                          Close tab
                        </Button>
                      </div>
                    )}
                  />
                ))}
              </div>
            )}

            {showBookmarks && staleBookmarks.length > 0 && (
              <div className="space-y-2">
                <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Bookmarks ({staleBookmarks.length})
                </p>
                {staleBookmarks.map((bookmark) => (
                  <BookmarkRow
                    key={bookmark.id}
                    bookmark={bookmark}
                    actions={(
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void openUrl(bookmark.url)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void removeBookmark(bookmark.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </details>
      ),
    })
  }

  if ((showBookmarks && transactionalBookmarks.length > 0) || (showTabs && transactionalTabs.length > 0)) {
    sections.push({
      key: 'transactional',
      weight: 3 + (showBookmarks ? transactionalBookmarks.length : 0) + (showTabs ? transactionalTabs.length : 0),
      content: (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            🎫 Transactional ({(showBookmarks ? transactionalBookmarks.length : 0) + (showTabs ? transactionalTabs.length : 0)}) — orders, bookings, tickets. Safe to delete when done.
          </summary>
          <div className="space-y-3 border-t border-border px-3 py-3">
            {showTabs && transactionalTabs.length > 0 && (
              <div className="space-y-2">
                <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Tabs ({transactionalTabs.length})
                </p>
                {transactionalTabs.map((tab) => (
                  <TabRow
                    key={tab.id}
                    tab={tab}
                    actions={(
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void activateTab(tab.id, tab.windowId)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Go to tab
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void closeTab(tab.id)}>
                          <X className="h-3.5 w-3.5" />
                          Close tab
                        </Button>
                      </div>
                    )}
                  />
                ))}
              </div>
            )}

            {showBookmarks && transactionalBookmarks.length > 0 && (
              <div className="space-y-2">
                <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Bookmarks ({transactionalBookmarks.length})
                </p>
                {transactionalBookmarks.map((bookmark) => (
                  <BookmarkRow
                    key={bookmark.id}
                    bookmark={bookmark}
                    actions={(
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void openUrl(bookmark.url)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void removeBookmark(bookmark.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </details>
      ),
    })
  }

  if (showBookmarks && neverOpened.length > 0) {
    sections.push({
      key: 'never-opened',
      weight: 2 + neverOpened.length,
      content: (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Never opened ({neverOpened.length})
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {neverOpened.map((bookmark) => (
              <BookmarkRow
                key={bookmark.id}
                bookmark={bookmark}
                actions={(
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void openUrl(bookmark.url)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void removeBookmark(bookmark.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                )}
              />
            ))}
          </div>
        </details>
      ),
    })
  }

  if (showBookmarks && openNow.length > 0) {
    sections.push({
      key: 'open-now',
      weight: 2 + openNow.length,
      content: (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Open right now ({openNow.length})
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {openNow.map((bookmark) => (
              <BookmarkRow
                key={bookmark.id}
                bookmark={bookmark}
                actions={(
                  <Button type="button" size="sm" variant="outline" onClick={() => void goToOpenTab(bookmark.url)}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Go to tab
                  </Button>
                )}
              />
            ))}
          </div>
        </details>
      ),
    })
  }

  if (showBookmarks && multiFolder.length > 0) {
    sections.push({
      key: 'multi-folder',
      weight: 2 + multiFolder.length,
      content: (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            In multiple folders ({multiFolder.length})
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {multiFolder.map((entry) => {
              const expanded = openFolders.includes(entry.url)
              return (
                <div key={entry.url} className="rounded-md border border-border bg-background/50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{entry.title || entry.url}</div>
                      <div className="truncate text-xs text-muted-foreground">{entry.domain}</div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setOpenFolders((prev) =>
                          prev.includes(entry.url) ? prev.filter((url) => url !== entry.url) : [...prev, entry.url],
                        )
                      }
                    >
                      <FolderTree className="h-3.5 w-3.5" />
                      {expanded ? 'Hide folders' : 'Show folders'}
                    </Button>
                  </div>
                  {expanded && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {entry.folders.map((folder) => (
                        <span key={folder} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {folder}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </details>
      ),
    })
  }

  const columns = Array.from({ length: Math.max(1, columnCount) }, () => [] as typeof sections)
  const weights = Array.from({ length: Math.max(1, columnCount) }, () => 0)
  for (const section of sections) {
    let targetIdx = 0
    for (let i = 1; i < columns.length; i += 1) {
      if (weights[i] < weights[targetIdx]) targetIdx = i
    }
    columns[targetIdx].push(section)
    weights[targetIdx] += section.weight
  }

  return (
    <div
      ref={sectionsContainerRef}
      className="grid items-start gap-x-5"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, columnCount)}, minmax(0, 1fr))` }}
    >
      {columns.map((columnSections, columnIdx) => (
        <div key={`triage-col-${columnIdx}`} className="min-w-0 space-y-3">
          {columnSections.map((section) => (
            <div key={section.key} className="min-w-0">
              {section.content}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function BookmarkRow({ bookmark, actions }: { bookmark: BookmarkItem; actions: JSX.Element }) {
  return (
    <div className="rounded-md border border-border bg-background/50 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{bookmark.title || bookmark.url}</div>
          <div className="truncate text-xs text-muted-foreground">{bookmark.domain}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span>Added {formatDate(bookmark.dateAdded)}</span>
            {bookmark.lastVisited != null && <span>Last visited {formatAge(bookmark.lastVisited)}</span>}
            {bookmark.visitCount != null && <span>{bookmark.visitCount} visits</span>}
          </div>
        </div>
        {actions}
      </div>
    </div>
  )
}

function TabRow({ tab, actions }: { tab: TabItem; actions: JSX.Element }) {
  return (
    <div className="rounded-md border border-border bg-background/50 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{tab.title || tab.url}</div>
          <div className="truncate text-xs text-muted-foreground">{tab.domain}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span>Last accessed {formatAge(tab.lastAccessed)}</span>
            {tab.visitCount != null && <span>{tab.visitCount} visits</span>}
          </div>
        </div>
        {actions}
      </div>
    </div>
  )
}
