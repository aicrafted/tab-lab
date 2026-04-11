import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'

type SourceMode = 'bookmarks' | 'tabs' | 'both'
type GroupMode = 'category' | 'domain' | 'tag'

interface KanbanCard {
  key: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  category?: string
  visitCount?: number
  favIconUrl?: string
  tabId?: number
  windowId?: number
  tags: string[]
}

interface KanbanColumn {
  id: string
  label: string
  cards: KanbanCard[]
}

export function KanbanView({ bookmarks, tabs, loading }: ViewProps) {
  const [source, setSource] = useState<SourceMode>('both')
  const [groupMode, setGroupMode] = useState<GroupMode>('category')

  const cards = useMemo<KanbanCard[]>(() => {
    const result: KanbanCard[] = []

    if (source === 'bookmarks' || source === 'both') {
      for (const bookmark of bookmarks) {
        result.push({
          key: `bm-${bookmark.id}`,
          source: 'bookmark',
          title: bookmark.title,
          url: bookmark.url,
          domain: bookmark.domain,
          category: bookmark.category,
          visitCount: bookmark.visitCount,
          tags: bookmark.tags ?? [],
        })
      }
    }

    if (source === 'tabs' || source === 'both') {
      for (const tab of tabs) {
        result.push({
          key: `tab-${tab.id}`,
          source: 'tab',
          title: tab.title,
          url: tab.url,
          domain: tab.domain,
          category: tab.category,
          visitCount: tab.visitCount,
          favIconUrl: tab.favIconUrl,
          tabId: tab.id,
          windowId: tab.windowId,
          tags: tab.tags ?? [],
        })
      }
    }

    return result
  }, [bookmarks, tabs, source])

  const columns = useMemo<KanbanColumn[]>(() => {
    const byColumn = new Map<string, KanbanCard[]>()
    const hasCategory = cards.some((card) => (card.category?.trim().length ?? 0) > 0)

    if (groupMode === 'tag') {
      const tagCounts = new Map<string, number>()
      for (const card of cards) {
        for (const tag of new Set(card.tags)) {
          if (!tag) continue
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
        }
      }
      const topTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 15)
        .map(([tag]) => tag)

      for (const tag of topTags) {
        byColumn.set(
          tag,
          cards.filter((card) => card.tags.includes(tag)),
        )
      }
    } else if (groupMode === 'category' && hasCategory) {
      for (const card of cards) {
        const key = card.category?.trim() || 'Uncategorized'
        byColumn.set(key, [...(byColumn.get(key) ?? []), card])
      }
    } else {
      const domainCounts = new Map<string, number>()
      for (const card of cards) {
        domainCounts.set(card.domain, (domainCounts.get(card.domain) ?? 0) + 1)
      }
      const topDomains = new Set(
        Array.from(domainCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([domain]) => domain),
      )
      for (const card of cards) {
        const key = topDomains.has(card.domain) ? card.domain : 'Other'
        byColumn.set(key, [...(byColumn.get(key) ?? []), card])
      }
    }

    return Array.from(byColumn.entries())
      .map(([id, columnCards]) => ({
        id,
        label: id,
        cards: [...columnCards].sort((a, b) => (b.visitCount ?? 0) - (a.visitCount ?? 0)),
      }))
      .filter((column) => column.cards.length > 0)
      .sort((a, b) => b.cards.length - a.cards.length)
  }, [cards, groupMode])

  async function openCard(card: KanbanCard) {
    if (card.source === 'tab' && card.tabId != null && card.windowId != null) {
      await chrome.tabs.update(card.tabId, { active: true })
      await chrome.windows.update(card.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: card.url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading kanban data...</div>
  }

  if (cards.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No bookmarks or tabs to render.</div>
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={source === 'bookmarks' ? 'default' : 'outline'} onClick={() => setSource('bookmarks')}>
          Bookmarks
        </Button>
        <Button type="button" size="sm" variant={source === 'tabs' ? 'default' : 'outline'} onClick={() => setSource('tabs')}>
          Tabs
        </Button>
        <Button type="button" size="sm" variant={source === 'both' ? 'default' : 'outline'} onClick={() => setSource('both')}>
          Both
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Group by:</span>
        <Button type="button" size="sm" variant={groupMode === 'category' ? 'default' : 'outline'} onClick={() => setGroupMode('category')}>
          Category
        </Button>
        <Button type="button" size="sm" variant={groupMode === 'domain' ? 'default' : 'outline'} onClick={() => setGroupMode('domain')}>
          Domain
        </Button>
        <Button type="button" size="sm" variant={groupMode === 'tag' ? 'default' : 'outline'} onClick={() => setGroupMode('tag')}>
          Tag
        </Button>
      </div>
      {groupMode === 'tag' && (
        <div className="text-xs text-muted-foreground">
          A card can appear in multiple columns.
        </div>
      )}

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-start gap-3">
          {columns.map((column) => (
            <section key={column.id} className="w-72 shrink-0 rounded-md border border-border bg-card/40">
              <header className="flex items-center justify-between border-b border-border px-3 py-2">
                <h3 className="truncate text-sm font-semibold text-foreground">{column.label}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{column.cards.length}</span>
              </header>
              <div className="max-h-[calc(100vh-22rem)] space-y-2 overflow-y-auto p-2">
                {column.cards.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => void openCard(card)}
                    className="w-full rounded-md border border-border bg-background/70 p-2 text-left transition-colors hover:bg-background"
                  >
                    <div className="flex items-start gap-2">
                      <Favicon domain={card.domain} src={card.favIconUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm font-medium text-foreground">{card.title || card.url}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {card.domain} · {card.visitCount ?? 0} visits
                        </div>
                      </div>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </div>
                    {card.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {card.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}

