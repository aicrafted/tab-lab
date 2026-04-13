import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Favicon } from '@/components/Favicon'
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

export function Search({
  data,
  currentTabId,
}: {
  data: SidePanelData
  currentTabId: number
}) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()

    const tabResults = data.tabs
      .filter((t) => t.id !== currentTabId && t.url)
      .filter(
        (t) =>
          (t.title?.toLowerCase().includes(q) ?? false) ||
          t.url!.toLowerCase().includes(q) ||
          parseDomain(t.url!).toLowerCase().includes(q),
      )
      .slice(0, 8)

    const bmItems = flattenBookmarks(data.bookmarks)
    const bmResults = bmItems
      .filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.domain.toLowerCase().includes(q),
      )
      .slice(0, 8)

    return { tabs: tabResults, bookmarks: bmResults }
  }, [query, data, currentTabId])

  const hasResults = (results.tabs?.length ?? 0) + (results.bookmarks?.length ?? 0) > 0

  return (
    <details open className="group rounded-lg border border-[#2a2a2a] bg-[#1a1a1a]">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#888] select-none">
        Search
      </summary>
      <div className="px-2 pb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tabs & bookmarks…"
          className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-xs text-[#f0e6d0] placeholder:text-[#555] focus:border-[#60863D]/50 focus:outline-none"
        />
        {query.trim() && hasResults && (
          <div className="mt-1 space-y-0.5">
            {results.tabs?.map((tab) => (
              <button
                key={`t-${tab.id}`}
                type="button"
                onClick={() => void chrome.tabs.update(tab.id, { active: true })}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs text-[#888] hover:bg-[#1e1e1e] hover:text-[#f0e6d0]"
              >
                <span className="shrink-0 text-[10px] text-[#EFBC0B]">TAB</span>
                <span className="flex-1 truncate text-left" title={tab.title}>
                  {tab.title}
                </span>
              </button>
            ))}
            {results.bookmarks?.map((bm) => (
              <a
                key={`b-${bm.id}`}
                href={bm.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-[#888] hover:bg-[#1e1e1e] hover:text-[#f0e6d0]"
              >
                <span className="shrink-0 text-[10px] text-[#60863D]">BM</span>
                <span className="flex-1 truncate" title={bm.title}>
                  {bm.title}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-30" />
              </a>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
