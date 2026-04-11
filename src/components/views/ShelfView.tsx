import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { colorFromKey, getStubReadingTime, getStubSummary } from '@/components/views/stubs'
import type { ViewProps } from '@/components/views/types'

type ShelfMode = 'category' | 'tag'
type SortMode = 'reading-time' | 'date-added' | 'visit-count'

interface Book {
  id: string
  title: string
  url: string
  domain: string
  category: string
  tags: string[]
  readingTime: number
  summary: string
  visitCount: number
  dateAdded: number
  color: string
}

interface HoverState {
  x: number
  y: number
  book: Book
}

export function ShelfView({ bookmarks, tabs, loading }: ViewProps) {
  const [shelfMode, setShelfMode] = useState<ShelfMode>('category')
  const [sortMode, setSortMode] = useState<SortMode>('reading-time')
  const [hover, setHover] = useState<HoverState | null>(null)

  const books = useMemo<Book[]>(() => {
    const fromBookmarks = bookmarks.map((bookmark) => ({
      id: `bm-${bookmark.id}`,
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      domain: bookmark.domain,
      category: bookmark.category?.trim() || 'Uncategorized',
      tags: bookmark.tags ?? [],
      readingTime: getStubReadingTime(bookmark.title || bookmark.url),
      summary: getStubSummary(bookmark.title || bookmark.url),
      visitCount: bookmark.visitCount ?? 0,
      dateAdded: bookmark.dateAdded,
      color: colorFromKey(bookmark.domain),
    }))
    const fromTabs = tabs.map((tab) => ({
      id: `tab-${tab.id}`,
      title: tab.title || tab.url,
      url: tab.url,
      domain: tab.domain,
      category: tab.category?.trim() || 'Uncategorized',
      tags: tab.tags ?? [],
      readingTime: getStubReadingTime(tab.title || tab.url),
      summary: getStubSummary(tab.title || tab.url),
      visitCount: tab.visitCount ?? 0,
      dateAdded: tab.lastAccessed,
      color: colorFromKey(tab.domain),
    }))
    return [...fromBookmarks, ...fromTabs]
  }, [bookmarks, tabs])

  const shelves = useMemo(() => {
    const byShelf = new Map<string, Book[]>()
    for (const book of books) {
      const key = shelfMode === 'category' ? book.category : (book.tags[0] || 'Untagged')
      byShelf.set(key, [...(byShelf.get(key) ?? []), book])
    }

    const sortedShelves = Array.from(byShelf.entries())
      .map(([label, items]) => {
        const sortedItems = [...items].sort((a, b) => {
          if (sortMode === 'reading-time') return b.readingTime - a.readingTime
          if (sortMode === 'date-added') return b.dateAdded - a.dateAdded
          return b.visitCount - a.visitCount
        })
        return { label, books: sortedItems }
      })
      .sort((a, b) => b.books.length - a.books.length || a.label.localeCompare(b.label))

    return sortedShelves
  }, [books, shelfMode, sortMode])

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading shelves...</div>
  }

  if (books.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No pages available for shelf view.</div>
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Shelf mode:</span>
        <Button type="button" size="sm" variant={shelfMode === 'category' ? 'default' : 'outline'} onClick={() => setShelfMode('category')}>By category</Button>
        <Button type="button" size="sm" variant={shelfMode === 'tag' ? 'default' : 'outline'} onClick={() => setShelfMode('tag')}>By tag</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort books:</span>
        <Button type="button" size="sm" variant={sortMode === 'reading-time' ? 'default' : 'outline'} onClick={() => setSortMode('reading-time')}>Reading time</Button>
        <Button type="button" size="sm" variant={sortMode === 'date-added' ? 'default' : 'outline'} onClick={() => setSortMode('date-added')}>Date added</Button>
        <Button type="button" size="sm" variant={sortMode === 'visit-count' ? 'default' : 'outline'} onClick={() => setSortMode('visit-count')}>Visit count</Button>
      </div>

      <div className="space-y-6">
        {shelves.map((shelf) => {
          const width = Math.max(8, Math.min(18, Math.floor(760 / Math.max(1, shelf.books.length))))
          return (
            <div key={shelf.label}>
              <div className="mb-1 text-xs text-muted-foreground">{shelf.label} ({shelf.books.length})</div>
              <div className="relative rounded-sm border-b-4 border-[hsl(30_40%_40%)] bg-[hsl(30_30%_85%)] px-2">
                <div className="flex items-end gap-px overflow-x-auto pb-0 pt-1">
                  {shelf.books.map((book) => {
                    const height = clamp(40 + book.readingTime * 3, 40, 120)
                    return (
                      <button
                        key={book.id}
                        type="button"
                        style={{ height, width, backgroundColor: book.color }}
                        className="shrink-0 cursor-pointer rounded-t-sm opacity-90 hover:opacity-100 hover:ring-1 hover:ring-foreground"
                        onMouseMove={(event) => setHover({ x: event.clientX, y: event.clientY, book })}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => void chrome.tabs.create({ url: book.url })}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <div className="line-clamp-2 font-medium text-foreground">{hover.book.title}</div>
          <div className="text-muted-foreground">{hover.book.domain} · {hover.book.readingTime} min</div>
          <div className="line-clamp-2 text-muted-foreground">{hover.book.summary}</div>
        </div>
      )}
    </section>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}


