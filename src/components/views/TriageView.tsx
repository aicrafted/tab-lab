import { useMemo, useState } from 'react'
import { ExternalLink, FolderTree, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BookmarkItem } from '@/lib/core/types'
import type { ViewProps } from '@/components/views/types'
import { effectiveIntent } from '@/lib/ai/static-intent'
import { formatAge, formatDate } from '@/lib/core/utils'

const STALE_AFTER_MS = 180 * 86_400_000

interface MultiFolderEntry {
  url: string
  title: string
  domain: string
  folders: string[]
}

export function TriageView({ bookmarks, tabs, loading }: ViewProps) {
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [openFolders, setOpenFolders] = useState<string[]>([])

  const removedSet = useMemo(() => new Set(removedIds), [removedIds])

  const visibleBookmarks = useMemo(
    () => bookmarks.filter((bookmark) => !removedSet.has(bookmark.id)),
    [bookmarks, removedSet],
  )

  const duplicates = useMemo(
    () => visibleBookmarks.filter((bookmark) => bookmark.isDuplicate === true),
    [visibleBookmarks],
  )

  const neverOpened = useMemo(
    () => visibleBookmarks.filter((bookmark) => bookmark.lastVisited == null && bookmark.visitCount == null),
    [visibleBookmarks],
  )

  const transactional = useMemo(
    () => visibleBookmarks.filter((bookmark) => effectiveIntent(bookmark) === 'transactional'),
    [visibleBookmarks],
  )

  const staleCutoff = Date.now() - STALE_AFTER_MS
  const stale = useMemo(
    () => visibleBookmarks.filter((bookmark) => bookmark.lastVisited != null && bookmark.lastVisited < staleCutoff),
    [visibleBookmarks, staleCutoff],
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
    duplicates.length,
    neverOpened.length,
    transactional.length,
    stale.length,
    openNow.length,
    multiFolder.length,
  ].reduce((sum, count) => sum + count, 0)

  async function removeBookmark(id: string) {
    try {
      await chrome.bookmarks.remove(id)
      setRemovedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } catch (error) {
      console.error('Failed to remove bookmark', error)
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
    await chrome.tabs.update(tab.id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading triage data...</div>
  }

  if (sectionsCount === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No triage issues found in current bookmarks.</div>
  }

  return (
    <div className="space-y-3">
      {duplicates.length > 0 && (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Duplicates ({duplicates.length})
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {duplicates.map((bookmark) => (
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
      )}

      {neverOpened.length > 0 && (
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
      )}

      {transactional.length > 0 && (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            🎫 Transactional ({transactional.length}) — orders, bookings, tickets. Safe to delete when done.
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {transactional.map((bookmark) => (
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
      )}

      {stale.length > 0 && (
        <details open className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Stale ({stale.length})
          </summary>
          <div className="space-y-2 border-t border-border px-3 py-3">
            {stale.map((bookmark) => (
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
      )}

      {openNow.length > 0 && (
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
      )}

      {multiFolder.length > 0 && (
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
      )}
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

