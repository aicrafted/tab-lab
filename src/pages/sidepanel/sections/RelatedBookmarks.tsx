import { ExternalLink } from 'lucide-react'
import { Favicon } from '@/components/Favicon'

interface BookmarkItem {
  id: string
  title: string
  url: string
  domain: string
  folder: string
}

interface TabInfo {
  id: number
  title: string
  url: string
  domain: string
  favIconUrl?: string
}

export function RelatedBookmarks({
  currentTab,
  bookmarks,
}: {
  currentTab: TabInfo
  bookmarks: BookmarkItem[]
}) {
  // Find bookmarks on the same domain
  const related = bookmarks.filter((b) => b.domain === currentTab.domain)

  if (related.length === 0) return null

  return (
    <details open className="group rounded-lg border border-[#2a2a2a] bg-[#1a1a1a]">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#888] select-none">
        Bookmarked · {related.length}
      </summary>
      <div className="space-y-0.5 px-1 pb-2">
        {related.map((bm) => (
          <BookmarkRow key={bm.id} bookmark={bm} />
        ))}
      </div>
    </details>
  )
}

function BookmarkRow({ bookmark }: { bookmark: BookmarkItem }) {
  return (
    <a
      href={bookmark.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[#888] hover:bg-[#1e1e1e] hover:text-[#f0e6d0]"
    >
      <Favicon domain={bookmark.domain} />
      <span className="flex-1 truncate" title={bookmark.title}>{bookmark.title}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
    </a>
  )
}
