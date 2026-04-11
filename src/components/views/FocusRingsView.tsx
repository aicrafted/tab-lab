import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { colorFromKey } from '@/components/views/stubs'
import type { ViewProps } from '@/components/views/types'

type Mode = 'recency' | 'frequency' | 'date-added'
type RingId = 'active' | 'regular' | 'occasional' | 'forgotten' | 'dead'

interface FocusItem {
  id: string
  title: string
  url: string
  domain: string
  category: string
  visitCount: number
  lastVisited?: number
  dateAdded?: number
}

interface HoverState {
  x: number
  y: number
  item: FocusItem
  ring: RingId
}

const RINGS: Array<{ id: RingId; label: string; icon: string }> = [
  { id: 'active', label: 'Active', icon: '🔥' },
  { id: 'regular', label: 'Regular', icon: '👁' },
  { id: 'occasional', label: 'Occasional', icon: '💤' },
  { id: 'forgotten', label: 'Forgotten', icon: '🕰' },
  { id: 'dead', label: 'Dead', icon: '💀' },
]

export function FocusRingsView({ bookmarks, tabs, loading }: ViewProps) {
  const [mode, setMode] = useState<Mode>('recency')
  const [hover, setHover] = useState<HoverState | null>(null)

  const items = useMemo<FocusItem[]>(() => {
    const bookmarkItems = bookmarks.map((bookmark) => ({
      id: `bm-${bookmark.id}`,
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      domain: bookmark.domain,
      category: bookmark.category?.trim() || bookmark.domain,
      visitCount: bookmark.visitCount ?? 0,
      lastVisited: bookmark.lastVisited,
      dateAdded: bookmark.dateAdded,
    }))
    const tabItems = tabs.map((tab) => ({
      id: `tab-${tab.id}`,
      title: tab.title || tab.url,
      url: tab.url,
      domain: tab.domain,
      category: tab.category?.trim() || tab.domain,
      visitCount: tab.visitCount ?? 0,
      lastVisited: tab.lastAccessed,
      dateAdded: tab.lastAccessed,
    }))
    return [...bookmarkItems, ...tabItems]
  }, [bookmarks, tabs])

  const hasVisitData = useMemo(
    () => items.some((item) => item.lastVisited != null || item.visitCount > 0),
    [items],
  )

  const grouped = useMemo(() => {
    const byRing = new Map<RingId, FocusItem[]>()
    for (const ring of RINGS) byRing.set(ring.id, [])
    for (const item of items) {
      const ring = classifyRing(item, mode, hasVisitData)
      byRing.set(ring, [...(byRing.get(ring) ?? []), item])
    }
    return byRing
  }, [items, mode, hasVisitData])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) set.add(item.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [items])

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading focus rings...</div>
  }

  if (items.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No items available for focus rings.</div>
  }

  const size = 720
  const center = size / 2
  const outerRadius = 300
  const ringWidth = outerRadius / RINGS.length

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_220px]">
      <div className="space-y-3">
        {!hasVisitData && (
          <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            No visit data available.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={mode === 'recency' ? 'default' : 'outline'} onClick={() => setMode('recency')}>By recency</Button>
          <Button type="button" size="sm" variant={mode === 'frequency' ? 'default' : 'outline'} onClick={() => setMode('frequency')}>By frequency</Button>
          <Button type="button" size="sm" variant={mode === 'date-added' ? 'default' : 'outline'} onClick={() => setMode('date-added')}>By date added</Button>
        </div>

        <div className="relative overflow-hidden rounded-md border border-border bg-card/30">
          <svg viewBox={`0 0 ${size} ${size}`} className="h-[720px] w-full">
            <rect x={0} y={0} width={size} height={size} fill="hsl(var(--background))" />
            {RINGS.map((ring, ringIndex) => {
              const ringItems = grouped.get(ring.id) ?? []
              const inner = ringIndex * ringWidth
              const outer = inner + ringWidth
              const byCategory = new Map<string, FocusItem[]>()
              for (const item of ringItems) {
                byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item])
              }
              const categoriesInRing = Array.from(byCategory.keys()).sort((a, b) => a.localeCompare(b))
              const total = ringItems.length
              let start = -Math.PI / 2

              if (total === 0) {
                return (
                  <circle
                    key={ring.id}
                    cx={center}
                    cy={center}
                    r={(inner + outer) / 2}
                    fill="none"
                    stroke="hsl(var(--border))"
                    strokeDasharray="4 6"
                    strokeWidth={Math.max(1, ringWidth - 6)}
                    opacity={0.25}
                  />
                )
              }

              return (
                <g key={ring.id}>
                  {categoriesInRing.map((category) => {
                    const sectorItems = byCategory.get(category) ?? []
                    const ratio = sectorItems.length / total
                    const sweep = ratio * Math.PI * 2
                    const end = start + sweep
                    const path = annularSector(center, center, inner + 3, outer - 3, start, end)
                    const midRadius = (inner + outer) / 2
                    const dots = sectorItems.map((item, index) => {
                      const angle = start + ((index + 1) / (sectorItems.length + 1)) * sweep
                      const x = center + Math.cos(angle) * midRadius
                      const y = center + Math.sin(angle) * midRadius
                      return { item, x, y }
                    })
                    const node = (
                      <g key={`${ring.id}-${category}`}>
                        <path d={path} fill={colorFromKey(category)} opacity={0.18} />
                        {dots.map((dot) => (
                          <circle
                            key={dot.item.id}
                            cx={dot.x}
                            cy={dot.y}
                            r={6}
                            fill={colorFromKey(category)}
                            className="cursor-pointer"
                            onMouseMove={(event) =>
                              setHover({
                                x: event.clientX,
                                y: event.clientY,
                                item: dot.item,
                                ring: ring.id,
                              })
                            }
                            onMouseLeave={() => setHover(null)}
                            onClick={() => void chrome.tabs.create({ url: dot.item.url })}
                          />
                        ))}
                      </g>
                    )
                    start = end
                    return node
                  })}
                </g>
              )
            })}
            {RINGS.map((ring, ringIndex) => {
              const r = (ringIndex + 0.5) * ringWidth
              return (
                <text
                  key={`label-${ring.id}`}
                  x={center}
                  y={center - r + 12}
                  textAnchor="middle"
                  fill="hsl(var(--muted-foreground))"
                  fontSize="10"
                >
                  {ring.icon} {ring.label}
                </text>
              )
            })}
          </svg>

          {hover && (
            <div
              className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="line-clamp-2 font-medium text-foreground">{hover.item.title}</div>
              <div className="text-muted-foreground">
                {hover.item.domain} · {hover.item.visitCount} visits
              </div>
              <div className="text-muted-foreground">
                last: {hover.item.lastVisited ? new Date(hover.item.lastVisited).toLocaleDateString() : 'never'} · {hover.ring}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card/30 p-3">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Legend</h3>
        <div className="space-y-1.5">
          {categories.map((category) => (
            <div key={category} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFromKey(category) }} />
              <span className="truncate">{category}</span>
            </div>
          ))}
        </div>
      </aside>
    </section>
  )
}

function classifyRing(item: FocusItem, mode: Mode, hasVisitData: boolean): RingId {
  if (!hasVisitData && (mode === 'recency' || mode === 'frequency')) return 'dead'
  if (mode === 'frequency') {
    if (item.visitCount >= 20) return 'active'
    if (item.visitCount >= 10) return 'regular'
    if (item.visitCount >= 3) return 'occasional'
    if (item.visitCount >= 1) return 'forgotten'
    return 'dead'
  }

  const value = mode === 'date-added' ? item.dateAdded : item.lastVisited
  if (!value) return 'dead'
  const days = (Date.now() - value) / 86_400_000
  if (days < 7) return 'active'
  if (days < 30) return 'regular'
  if (days < 90) return 'occasional'
  if (days < 365) return 'forgotten'
  return 'dead'
}

function annularSector(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  const x1 = cx + Math.cos(startAngle) * outerR
  const y1 = cy + Math.sin(startAngle) * outerR
  const x2 = cx + Math.cos(endAngle) * outerR
  const y2 = cy + Math.sin(endAngle) * outerR
  const x3 = cx + Math.cos(endAngle) * innerR
  const y3 = cy + Math.sin(endAngle) * innerR
  const x4 = cx + Math.cos(startAngle) * innerR
  const y4 = cy + Math.sin(startAngle) * innerR
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}


