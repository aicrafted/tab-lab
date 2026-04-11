import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'

interface Page {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  favIconUrl?: string
  tags: string[]
  tabId?: number
  windowId?: number
}

interface CellData {
  count: number
  pages: Page[]
}

interface HoverState {
  x: number
  y: number
  rowTag: string
  colTag: string
  cell: CellData
}

export function TagCooccurrenceView({ bookmarks, tabs, loading, onRunTags }: ViewProps) {
  const [highlightTag, setHighlightTag] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ rowTag: string; colTag: string; cell: CellData } | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  const pages = useMemo<Page[]>(() => {
    const result: Page[] = []
    for (const bookmark of bookmarks) {
      result.push({
        id: `bm-${bookmark.id}`,
        source: 'bookmark',
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        tags: bookmark.tags ?? [],
      })
    }
    for (const tab of tabs) {
      result.push({
        id: `tab-${tab.id}`,
        source: 'tab',
        title: tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        favIconUrl: tab.favIconUrl,
        tags: tab.tags ?? [],
        tabId: tab.id,
        windowId: tab.windowId,
      })
    }
    return result
  }, [bookmarks, tabs])

  const model = useMemo(() => {
    const tagCounts = new Map<string, number>()
    for (const page of pages) {
      for (const tag of new Set(page.tags)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
    const initial = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([tag]) => tag)
    const topSet = new Set(initial)

    const cellMap = new Map<string, CellData>()
    const rowSum = new Map<string, number>()
    for (const tag of initial) rowSum.set(tag, 0)

    for (const page of pages) {
      const tags = Array.from(new Set(page.tags)).filter((tag) => topSet.has(tag))
      for (let i = 0; i < tags.length; i += 1) {
        for (let j = i; j < tags.length; j += 1) {
          const a = tags[i]
          const b = tags[j]
          const key = pairKey(a, b)
          const current = cellMap.get(key) ?? { count: 0, pages: [] }
          cellMap.set(key, { count: current.count + 1, pages: [...current.pages, page] })
        }
      }
    }

    for (const rowTag of initial) {
      let sum = 0
      for (const colTag of initial) {
        sum += cellMap.get(pairKey(rowTag, colTag))?.count ?? 0
      }
      rowSum.set(rowTag, sum)
    }

    const sortedTags = [...initial].sort((a, b) => (rowSum.get(b) ?? 0) - (rowSum.get(a) ?? 0) || a.localeCompare(b))
    const maxValue = Math.max(1, ...Array.from(cellMap.values()).map((cell) => cell.count))
    return { tags: sortedTags, cellMap, maxValue }
  }, [pages])

  async function openPage(page: Page) {
    if (page.source === 'tab' && page.tabId != null && page.windowId != null) {
      await chrome.tabs.update(page.tabId, { active: true })
      await chrome.windows.update(page.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: page.url })
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading tag co-occurrence...</div>

  if (model.tags.length < 2) {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Run Tags to populate this view.
          {onRunTags && (
            <Button type="button" size="sm" variant="outline" className="ml-2 h-6 text-[11px]" onClick={() => void onRunTags()}>
              Run Tags
            </Button>
          )}
        </div>
        <div className="p-8 text-sm text-muted-foreground">Not enough tags to build a matrix.</div>
      </div>
    )
  }

  const n = model.tags.length
  const cellSize = Math.max(14, Math.floor(620 / n))
  const labelSpace = 160
  const width = labelSpace + n * cellSize + 20
  const height = labelSpace + n * cellSize + 20

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <div className="relative overflow-auto rounded-md border border-border bg-card/30 p-2">
          <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[900px]">
            <rect x={0} y={0} width={width} height={height} fill="hsl(var(--background))" />
            {model.tags.map((tag, row) => (
              <text
                key={`row-${tag}`}
                x={labelSpace - 6}
                y={labelSpace + row * cellSize + cellSize * 0.7}
                textAnchor="end"
                className="cursor-pointer fill-muted-foreground text-[10px]"
                onClick={() => setHighlightTag((prev) => (prev === tag ? null : tag))}
              >
                {tag}
              </text>
            ))}
            {model.tags.map((tag, col) => (
              <text
                key={`col-${tag}`}
                x={labelSpace + col * cellSize + cellSize * 0.6}
                y={labelSpace - 8}
                transform={`rotate(-50 ${labelSpace + col * cellSize + cellSize * 0.6} ${labelSpace - 8})`}
                className="cursor-pointer fill-muted-foreground text-[10px]"
                onClick={() => setHighlightTag((prev) => (prev === tag ? null : tag))}
              >
                {tag}
              </text>
            ))}

            {model.tags.map((rowTag, row) =>
              model.tags.map((colTag, col) => {
                const cell = model.cellMap.get(pairKey(rowTag, colTag)) ?? { count: 0, pages: [] }
                const selected = highlightTag != null && (highlightTag === rowTag || highlightTag === colTag)
                return (
                  <rect
                    key={`${rowTag}-${colTag}`}
                    x={labelSpace + col * cellSize}
                    y={labelSpace + row * cellSize}
                    width={cellSize}
                    height={cellSize}
                    fill={cellColor(cell.count, model.maxValue)}
                    opacity={highlightTag ? (selected ? 1 : 0.25) : 1}
                    stroke="hsl(var(--border))"
                    strokeWidth={0.4}
                    className="cursor-pointer"
                    onMouseMove={(event) =>
                      setHover({
                        x: event.clientX,
                        y: event.clientY,
                        rowTag,
                        colTag,
                        cell,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelectedCell({ rowTag, colTag, cell })}
                  />
                )
              }),
            )}
          </svg>

          {hover && (
            <div
              className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="font-medium text-foreground">{hover.rowTag} + {hover.colTag}: {hover.cell.count} pages</div>
              <div className="mt-1 text-muted-foreground">
                {hover.cell.pages.slice(0, 5).map((page) => page.title).join(' · ')}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card/30 p-3">
        <h3 className="text-sm font-semibold text-foreground">
          {selectedCell ? `${selectedCell.rowTag} + ${selectedCell.colTag}` : 'Select a cell'}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedCell ? `${selectedCell.cell.count} pages` : 'Click a matrix cell to inspect pages'}
        </p>
        <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto">
          {selectedCell?.cell.pages.map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => void openPage(page)}
              className="w-full rounded-md border border-border bg-background/60 p-2 text-left hover:bg-background"
            >
              <div className="flex items-start gap-2">
                <Favicon domain={page.domain} src={page.favIconUrl} />
                <div className="min-w-0">
                  <div className="line-clamp-2 text-xs font-medium text-foreground">{page.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{page.domain}</div>
                </div>
              </div>
            </button>
          ))}
          {selectedCell && selectedCell.cell.pages.length === 0 && (
            <div className="text-xs text-muted-foreground">No pages in this intersection.</div>
          )}
        </div>
      </aside>
    </section>
  )
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`
}

function cellColor(value: number, max: number): string {
  if (value === 0) return 'hsl(var(--muted))'
  const intensity = value / max
  const lightness = 70 - intensity * 45
  return `hsl(220 80% ${lightness}%)`
}


