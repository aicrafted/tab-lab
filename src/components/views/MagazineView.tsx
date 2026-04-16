import { useMemo, useState } from 'react'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  getStubIsAlive,
  getStubReadingTime,
  getStubSummary,
  getThumbnailPlaceholder,
} from '@/components/views/stubs'
import { effectiveIntent } from '@/lib/ai/static-intent'
import type { PageIntent } from '@/lib/core/types'

interface MagazineCardItem {
  id: string
  title: string
  url: string
  domain: string
  category?: string
  visitCount: number
  summary: string
  readingTime: number
  featured: boolean
  intent?: PageIntent
  tags: string[]
}

interface MagazineSection {
  key: string
  label: string
  items: MagazineCardItem[]
}

export function MagazineView({ bookmarks, loading }: ViewProps) {
  const [intentFilter, setIntentFilter] = useState<'all' | 'article' | 'reference' | 'video'>('all')

  const items = useMemo<MagazineCardItem[]>(() => {
    const base = bookmarks.map((bookmark) => ({
      id: bookmark.id,
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      domain: bookmark.domain,
      category: bookmark.category,
      visitCount: bookmark.visitCount ?? 1,
      summary: getStubSummary(bookmark.title || bookmark.url),
      readingTime: getStubReadingTime(bookmark.title || bookmark.url),
      featured: false,
      intent: effectiveIntent(bookmark),
      tags: bookmark.tags ?? [],
    }))

    const sortedByVisits = [...base].sort((a, b) => b.visitCount - a.visitCount)
    const featuredCount = Math.max(1, Math.ceil(base.length * 0.1))
    const featuredSet = new Set(sortedByVisits.slice(0, featuredCount).map((item) => item.id))

    return base.map((item) => ({
      ...item,
      featured: featuredSet.has(item.id) || item.intent === 'article',
    }))
  }, [bookmarks])

  const sections = useMemo<MagazineSection[]>(() => {
    const visibleItems = intentFilter === 'all'
      ? items
      : items.filter((item) => item.intent === intentFilter)
    const hasCategory = visibleItems.some((item) => item.category && item.category.trim().length > 0)
    const grouped = new Map<string, MagazineCardItem[]>()

    for (const item of visibleItems) {
      const key = hasCategory ? (item.category?.trim() || 'Uncategorized') : item.domain
      grouped.set(key, [...(grouped.get(key) ?? []), item])
    }

    return Array.from(grouped.entries())
      .map(([key, sectionItems]) => ({
        key,
        label: key,
        items: sectionItems.sort((a, b) => b.visitCount - a.visitCount),
      }))
      .sort((a, b) => b.items.length - a.items.length)
  }, [items, intentFilter])

  async function openItem(url: string) {
    await chrome.tabs.create({ url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading magazine layout...</div>
  }

  if (items.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No bookmarks available for magazine view.</div>
  }

  return (
    <div className="space-y-6">
      <div className="max-w-[220px]">
        <Select value={intentFilter} onValueChange={(value: 'all' | 'article' | 'reference' | 'video') => setIntentFilter(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Intent filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All intents</SelectItem>
            <SelectItem value="article">Articles</SelectItem>
            <SelectItem value="reference">Reference</SelectItem>
            <SelectItem value="video">Videos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sections.map((section) => (
        <section key={section.key} className="space-y-3">
          <header className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{section.label}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {section.items.length}
            </span>
          </header>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {section.items.map((item) => {
              const thumbnail = getThumbnailPlaceholder(item.domain)
              return (
                <article
                  key={item.id}
                  className={[
                    'overflow-hidden rounded-lg border border-border bg-card/50 transition-colors hover:bg-card',
                    item.featured ? 'md:col-span-2' : '',
                  ].join(' ')}
                >
                  <button type="button" onClick={() => void openItem(item.url)} className="block w-full text-left">
                    <div className="relative aspect-video border-b border-border bg-muted/50">
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                        <div className="text-xl">{thumbnail.icon}</div>
                        <div className="max-w-[85%] truncate text-xs">{thumbnail.label}</div>
                      </div>
                    </div>

                    <div className="space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                          {item.category?.trim() || item.domain}
                        </span>
                        {item.featured && (
                          <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-yellow-300">
                            Featured
                          </span>
                        )}
                      </div>

                      <h4 className="line-clamp-2 text-sm font-semibold text-foreground">{item.title}</h4>
                      <p className="line-clamp-3 text-xs text-muted-foreground">{item.summary}</p>
                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Favicon domain={item.domain} />
                        <span className="truncate">{item.domain}</span>
                        <span>·</span>
                        <span>{item.readingTime} min</span>
                        <span>·</span>
                        <span>{item.visitCount} visits</span>
                        {!getStubIsAlive() && <span>· offline</span>}
                      </div>
                    </div>
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      ))}
      {sections.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          No bookmarks match this intent filter.
        </div>
      )}
    </div>
  )
}

