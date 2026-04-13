import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { parseDomain } from '@/lib/utils'

interface SidePanelData {
  tabs: chrome.tabs.Tab[]
  bookmarks: chrome.bookmarks.BookmarkTreeNode[]
}

function flattenBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
): { id: string; title: string; url: string; domain: string }[] {
  const items: { id: string; title: string; url: string; domain: string }[] = []
  for (const node of nodes) {
    if (node.url) {
      items.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        domain: parseDomain(node.url),
      })
    }
    if (node.children) items.push(...flattenBookmarks(node.children))
  }
  return items
}

async function activateTab(tabId: number, windowId?: number) {
  await chrome.tabs.update(tabId, { active: true })
  if (windowId != null) {
    await chrome.windows.update(windowId, { focused: true })
  }
}

export function Search({
  data,
  currentTabId,
  currentWindowId,
}: {
  data: SidePanelData
  currentTabId: number
  currentWindowId: number | null
}) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    if (!query.trim()) return { sameWindow: [] as chrome.tabs.Tab[], otherWindows: [] as chrome.tabs.Tab[], bookmarks: [] as { id: string; title: string; url: string }[] }
    const q = query.toLowerCase()

    const allTabResults = data.tabs
      .filter((t) => t.id !== currentTabId && t.url)
      .filter(
        (t) =>
          (t.title?.toLowerCase().includes(q) ?? false) ||
          t.url!.toLowerCase().includes(q) ||
          parseDomain(t.url!).toLowerCase().includes(q),
      )

    const sameWindow = allTabResults.filter((t) => t.windowId === currentWindowId)
    const otherWindows = allTabResults.filter((t) => t.windowId !== currentWindowId)

    const bmItems = flattenBookmarks(data.bookmarks)
    const bmResults = bmItems
      .filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.domain.toLowerCase().includes(q),
      )
      .slice(0, 8)

    return { sameWindow, otherWindows, bookmarks: bmResults }
  }, [query, data, currentTabId, currentWindowId])

  const hasResults =
    results.sameWindow.length + results.otherWindows.length + results.bookmarks.length > 0

  return (
    <div className="px-0 pb-1">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tabs & bookmarks…"
        className="w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1.5 text-xs text-[#f0e6d0] placeholder:text-[#555] focus:border-[#60863D]/50 focus:outline-none"
      />
      {query.trim() && hasResults && (
        <div className="mt-1 space-y-0.5">
          {results.sameWindow.map((tab) => (
            <TabResult key={tab.id} tab={tab} onActivate={activateTab} />
          ))}
          {results.otherWindows.length > 0 && (
            <div className="px-2 py-1 text-[10px] text-[#555]">
              Opened in other windows
            </div>
          )}
          {results.otherWindows.map((tab) => (
            <TabResult key={tab.id} tab={tab} onActivate={activateTab} />
          ))}
          {results.bookmarks.map((bm) => (
            <BookmarkResult key={bm.id} bookmark={bm} />
          ))}
        </div>
      )}
    </div>
  )
}

function TabResult({
  tab,
  onActivate,
}: {
  tab: chrome.tabs.Tab
  onActivate: (id: number, windowId?: number) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onActivate(tab.id!, tab.windowId)}
      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs text-[#888] hover:bg-[#1e1e1e] hover:text-[#f0e6d0]"
    >
      <span className="shrink-0 text-[10px] text-[#EFBC0B]">TAB</span>
      <span className="flex-1 truncate text-left" title={tab.title}>
        {tab.title}
      </span>
    </button>
  )
}

function BookmarkResult({ bookmark }: { bookmark: { id: string; title: string; url: string } }) {
  return (
    <a
      key={bookmark.id}
      href={bookmark.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-[#888] hover:bg-[#1e1e1e] hover:text-[#f0e6d0]"
    >
      <span className="shrink-0 text-[10px] text-[#60863D]">BM</span>
      <span className="flex-1 truncate" title={bookmark.title}>
        {bookmark.title}
      </span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-30" />
    </a>
  )
}
