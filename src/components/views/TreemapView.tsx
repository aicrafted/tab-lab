import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ViewProps } from '@/components/views/types'
import { colorFromKey } from '@/components/views/stubs'

type MetricMode = 'visits' | 'items'

interface TreemapItem {
  id: string
  title: string
  url: string
  domain: string
  category: string
  visitCount: number
}

interface CategoryGroup {
  category: string
  items: TreemapItem[]
}

type TopValue = TreemapItem | CategoryGroup

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface WeightedEntry<T> {
  key: string
  value: T
  weight: number
}

interface HoverState {
  title: string
  subtitle: string
  x: number
  y: number
}

const WIDTH = 1100
const HEIGHT = 560

export function TreemapView({ bookmarks, tabs, loading }: ViewProps) {
  const [metric, setMetric] = useState<MetricMode>('visits')
  const [drillCategory, setDrillCategory] = useState<string | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  const items = useMemo<TreemapItem[]>(() => {
    const bookmarkItems = bookmarks.map((bookmark) => ({
      id: `bm-${bookmark.id}`,
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      domain: bookmark.domain,
      category: bookmark.category?.trim() || bookmark.domain,
      visitCount: bookmark.visitCount ?? 1,
    }))

    const tabItems = tabs.map((tab) => ({
      id: `tab-${tab.id}`,
      title: tab.title || tab.url,
      url: tab.url,
      domain: tab.domain,
      category: tab.category?.trim() || tab.domain,
      visitCount: tab.visitCount ?? 1,
    }))

    return [...bookmarkItems, ...tabItems]
  }, [bookmarks, tabs])

  const grouped = useMemo(() => {
    const byCategory = new Map<string, TreemapItem[]>()
    for (const item of items) {
      byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item])
    }
    return byCategory
  }, [items])

  const topEntries = useMemo<WeightedEntry<TopValue>[]>(() => {
    if (drillCategory) {
      const categoryItems = grouped.get(drillCategory) ?? []
      return categoryItems.map((item) => ({
        key: item.id,
        value: item,
        weight: metric === 'visits' ? item.visitCount : 1,
      }))
    }

    return Array.from(grouped.entries()).map(([category, categoryItems]) => ({
      key: category,
      value: { category, items: categoryItems },
      weight:
        metric === 'visits'
          ? categoryItems.reduce((sum, item) => sum + item.visitCount, 0)
          : categoryItems.length,
    }))
  }, [grouped, metric, drillCategory])

  const topRects = useMemo(
    () => layoutSliceDice<TopValue>(topEntries, { x: 0, y: 0, width: WIDTH, height: HEIGHT }),
    [topEntries],
  )

  async function openItem(url: string) {
    await chrome.tabs.create({ url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading treemap data...</div>
  }

  if (items.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No items available for treemap.</div>
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={metric === 'visits' ? 'default' : 'outline'} onClick={() => setMetric('visits')}>
          By visitCount
        </Button>
        <Button type="button" size="sm" variant={metric === 'items' ? 'default' : 'outline'} onClick={() => setMetric('items')}>
          By item count
        </Button>
        {drillCategory && (
          <Button type="button" size="sm" variant="outline" onClick={() => setDrillCategory(null)}>
            Back to categories
          </Button>
        )}
      </div>

      <div className="relative overflow-x-auto rounded-md border border-border bg-card/30 p-2">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-[560px] min-w-[900px] w-full">
          {topRects.map((entry) => {
            if (drillCategory) {
              const item = entry.value as TreemapItem
              const color = colorFromKey(item.category)
              return (
                <g
                  key={entry.key}
                  onMouseMove={(event) =>
                    setHover({
                      title: item.title,
                      subtitle: `${item.domain} · ${item.visitCount} visits`,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                  onClick={() => void openItem(item.url)}
                  className="cursor-pointer"
                >
                  <rect x={entry.rect.x} y={entry.rect.y} width={entry.rect.width} height={entry.rect.height} fill={color} opacity={0.75} stroke="hsl(var(--background))" strokeWidth="2" />
                  {entry.rect.width > 90 && entry.rect.height > 32 && (
                    <text x={entry.rect.x + 8} y={entry.rect.y + 18} fill="white" fontSize="12">
                      {clipLabel(item.title, Math.floor(entry.rect.width / 7))}
                    </text>
                  )}
                </g>
              )
            }

            const group = entry.value as CategoryGroup
            const category = group.category
            const categoryItems = group.items
            const color = colorFromKey(category)

            const leafEntries = categoryItems.map((item) => ({
              key: item.id,
              value: item,
              weight: metric === 'visits' ? item.visitCount : 1,
            }))
            const leaves = layoutSliceDice(leafEntries, entry.rect, true)

            return (
              <g key={entry.key}>
                <rect
                  x={entry.rect.x}
                  y={entry.rect.y}
                  width={entry.rect.width}
                  height={entry.rect.height}
                  fill={color}
                  opacity={0.22}
                  stroke={color}
                  strokeWidth="2"
                  className="cursor-pointer"
                  onMouseMove={(event) =>
                    setHover({
                      title: category,
                      subtitle: `${categoryItems.length} items`,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setDrillCategory(category)}
                />
                {entry.rect.width > 120 && entry.rect.height > 28 && (
                  <text x={entry.rect.x + 8} y={entry.rect.y + 18} fill="hsl(var(--foreground))" fontSize="12" fontWeight="600">
                    {clipLabel(category, Math.floor(entry.rect.width / 8))}
                  </text>
                )}
                {leaves.map((leaf) => {
                  const item = leaf.value as TreemapItem
                  return (
                    <rect
                      key={leaf.key}
                      x={leaf.rect.x}
                      y={leaf.rect.y}
                      width={leaf.rect.width}
                      height={leaf.rect.height}
                      fill={color}
                      opacity={0.55}
                      stroke="hsl(var(--background))"
                      strokeWidth="1"
                      onMouseMove={(event) =>
                        setHover({
                          title: item.title,
                          subtitle: `${item.domain} · ${item.visitCount} visits`,
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                    />
                  )
                })}
              </g>
            )
          })}
        </svg>

        {hover && (
          <div
            className="pointer-events-none fixed z-50 rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
            style={{ left: hover.x + 12, top: hover.y + 12 }}
          >
            <div className="max-w-xs truncate font-medium text-foreground">{hover.title}</div>
            <div className="text-muted-foreground">{hover.subtitle}</div>
          </div>
        )}
      </div>
    </section>
  )
}

function layoutSliceDice<T>(entries: WeightedEntry<T>[], rect: Rect, forceHorizontal?: boolean): Array<WeightedEntry<T> & { rect: Rect }> {
  const valid = entries.filter((entry) => entry.weight > 0)
  const total = valid.reduce((sum, entry) => sum + entry.weight, 0)
  if (total <= 0) return []

  let cursor = 0
  const horizontal = forceHorizontal ?? rect.width >= rect.height

  return valid.map((entry) => {
    const ratio = entry.weight / total
    if (horizontal) {
      const width = rect.width * ratio
      const result = {
        ...entry,
        rect: {
          x: rect.x + cursor,
          y: rect.y,
          width: Math.max(0, width),
          height: rect.height,
        },
      }
      cursor += width
      return result
    }

    const height = rect.height * ratio
    const result = {
      ...entry,
      rect: {
        x: rect.x,
        y: rect.y + cursor,
        width: rect.width,
        height: Math.max(0, height),
      },
    }
    cursor += height
    return result
  })
}

function clipLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label
  if (maxChars < 4) return label.slice(0, maxChars)
  return `${label.slice(0, maxChars - 3)}...`
}

