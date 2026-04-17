import { useMemo, useState } from 'react'
import { AlarmClock, ExternalLink, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BookmarkItem, PageIntent } from '@/lib/core/types'
import type { ViewProps } from '@/components/views/types'
import { effectiveIntent } from '@/lib/ai/static-intent'
import {
  getStubIntent,
  getStubReadingTime,
  getStubSummary,
  getThumbnailPlaceholder,
} from '@/components/views/stubs'

type FilterMode = 'all-unread' | 'ai-intent' | 'long-reads' | 'transactional'
type SortMode = 'oldest' | 'reading-time' | 'domain' | 'category'

interface QueueItem {
  bookmark: BookmarkItem
  intent: PageIntent | undefined
  readingTime: number
  summary: string
}

export function ReadingQueueView({ bookmarks, loading }: ViewProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all-unread')
  const [sortMode, setSortMode] = useState<SortMode>('oldest')
  const [readIds, setReadIds] = useState<string[]>([])
  const [removedIds, setRemovedIds] = useState<string[]>([])

  const readSet = useMemo(() => new Set(readIds), [readIds])
  const removedSet = useMemo(() => new Set(removedIds), [removedIds])

  const items = useMemo<QueueItem[]>(() => {
    return bookmarks
      .filter((bookmark) => !removedSet.has(bookmark.id))
      .map((bookmark) => {
        const intent = effectiveIntent(bookmark) ?? getStubIntent(bookmark.url, bookmark.title || bookmark.url)
        const readingTime = getStubReadingTime(bookmark.title || bookmark.url)
        const summary = getStubSummary(bookmark.title || bookmark.url)
        return { bookmark, intent, readingTime, summary }
      })
  }, [bookmarks, removedSet])

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const unread = item.intent === 'article'
        || item.intent === 'video'
        || item.intent === 'transactional'
        || item.bookmark.lastVisited == null
        || (item.bookmark.visitCount ?? 0) <= 1

      if (filterMode === 'all-unread') return unread
      if (filterMode === 'ai-intent') return item.intent === 'article' || item.intent === 'video'
      if (filterMode === 'transactional') return item.intent === 'transactional'
      return unread && item.readingTime > 5
    })
  }, [items, filterMode])

  const sorted = useMemo(() => {
    const list = [...filtered]
    list.sort((a, b) => {
      const aRead = readSet.has(a.bookmark.id) ? 1 : 0
      const bRead = readSet.has(b.bookmark.id) ? 1 : 0
      if (aRead !== bRead) return aRead - bRead

      if (sortMode === 'oldest') return a.bookmark.dateAdded - b.bookmark.dateAdded
      if (sortMode === 'reading-time') return a.readingTime - b.readingTime
      if (sortMode === 'domain') return a.bookmark.domain.localeCompare(b.bookmark.domain)
      return (a.bookmark.category ?? '').localeCompare(b.bookmark.category ?? '')
    })
    return list
  }, [filtered, sortMode, readSet])

  async function openBookmark(url: string) {
    await chrome.tabs.create({ url })
  }

  async function removeBookmark(id: string) {
    try {
      await chrome.bookmarks.remove(id)
      setRemovedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    } catch (error) {
      console.error('Failed to remove bookmark', error)
    }
  }

  function toggleRead(id: string) {
    setReadIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading reading queue...</div>
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={filterMode === 'all-unread' ? 'default' : 'outline'} onClick={() => setFilterMode('all-unread')}>
          All unread
        </Button>
        <Button type="button" size="sm" variant={filterMode === 'ai-intent' ? 'default' : 'outline'} onClick={() => setFilterMode('ai-intent')}>
          By AI intent
        </Button>
        <Button type="button" size="sm" variant={filterMode === 'long-reads' ? 'default' : 'outline'} onClick={() => setFilterMode('long-reads')}>
          Long reads (&gt; 5 min)
        </Button>
        <Button type="button" size="sm" variant={filterMode === 'transactional' ? 'default' : 'outline'} onClick={() => setFilterMode('transactional')}>
          Transactional
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort:</span>
        <Button type="button" size="sm" variant={sortMode === 'oldest' ? 'default' : 'outline'} onClick={() => setSortMode('oldest')}>
          Oldest first
        </Button>
        <Button type="button" size="sm" variant={sortMode === 'reading-time' ? 'default' : 'outline'} onClick={() => setSortMode('reading-time')}>
          Reading time
        </Button>
        <Button type="button" size="sm" variant={sortMode === 'domain' ? 'default' : 'outline'} onClick={() => setSortMode('domain')}>
          Domain
        </Button>
        <Button type="button" size="sm" variant={sortMode === 'category' ? 'default' : 'outline'} onClick={() => setSortMode('category')}>
          Category
        </Button>
      </div>

      <div className="space-y-2">
        {sorted.map((item) => {
          const read = readSet.has(item.bookmark.id)
          const thumbnail = getThumbnailPlaceholder(item.bookmark.domain)
          return (
            <article
              key={item.bookmark.id}
              className={[
                'rounded-lg border border-border bg-card/40 p-3 transition-opacity',
                read ? 'opacity-60' : 'opacity-100',
              ].join(' ')}
            >
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-muted/50">
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                    <div className="text-xl">{thumbnail.icon}</div>
                    <div className="max-w-[90%] truncate text-xs">{thumbnail.label}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-foreground">{item.bookmark.title || item.bookmark.url}</h3>
                  <div className="text-xs text-muted-foreground">
                    {item.bookmark.domain} · {item.readingTime} min read · intent: {item.intent}
                    {item.intent === 'transactional' && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                        <AlarmClock className="h-3 w-3" />
                        time-limited
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-3 text-sm text-muted-foreground">{item.summary}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void openBookmark(item.bookmark.url)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => toggleRead(item.bookmark.id)}>
                      {read ? 'Mark unread' : 'Mark read'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void removeBookmark(item.bookmark.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          )
        })}
        {sorted.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            No items match the current reading queue filter.
          </div>
        )}
      </div>
    </section>
  )
}

