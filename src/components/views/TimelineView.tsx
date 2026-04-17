import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { formatDate } from '@/lib/core/utils'
import { cn } from '@/lib/core/utils'

type TimelineZoom = '7d' | '30d' | '6m' | 'all'

interface HeatmapPage {
  id: string
  title: string
  url: string
  domain: string
  visits: number
}

interface DayData {
  key: string
  date: Date
  count: number
  domains: string[]
  pages: HeatmapPage[]
}

interface TimelinePoint {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  category?: string
  timestamp: number
  visitCount: number
  tabId?: number
  windowId?: number
}

interface HoverState {
  point?: TimelinePoint
  day?: DayData
  x: number
  y: number
}

const SVG_WIDTH = 1200
const SVG_HEIGHT = 200
const PADDING_LEFT = 80
const PADDING_RIGHT = 20
const BOOKMARK_ROW_Y = 60
const TAB_ROW_Y = 140

export function TimelineView({ bookmarks, tabs, loading, viewMenuHost }: ViewProps) {
  const [zoom, setZoom] = useState<TimelineZoom>('30d')
  const [hover, setHover] = useState<HoverState | null>(null)
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)

  const cellDays = useMemo(() => {
    switch (zoom) {
      case '7d': return 14
      case '30d': return 63 // 9 weeks
      case '6m': return 182 // 26 weeks
      default: return 364 // 52 weeks
    }
  }, [zoom])

  const heatmapDays = useMemo(() => {
    const end = startOfDay(new Date())
    const start = new Date(end)
    start.setDate(start.getDate() - (cellDays - 1))

    const byDay = new Map<string, DayData>()
    for (let i = 0; i < cellDays; i += 1) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      const key = toDayKey(date)
      byDay.set(key, { key, date, count: 0, domains: [], pages: [] })
    }

    const processItem = (item: any, sourcePrefix: string) => {
      const ts = (sourcePrefix === 'bm-' ? item.dateAdded : item.lastAccessed) || Date.now()
      const key = toDayKey(new Date(ts))
      const entry = byDay.get(key)
      if (!entry) return
      const visits = item.visitCount ?? 1
      entry.count += visits
      if (!entry.domains.includes(item.domain)) entry.domains.push(item.domain)
      entry.pages.push({
        id: `${sourcePrefix}${item.id}`,
        title: item.title || item.url,
        url: item.url,
        domain: item.domain,
        visits,
      })
    }

    bookmarks.forEach(bm => processItem(bm, 'bm-'))
    tabs.forEach(t => processItem(t, 'tab-'))

    return Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [bookmarks, tabs, cellDays])

  const heatmapMaxCount = useMemo(() => heatmapDays.reduce((max, d) => Math.max(max, d.count), 0), [heatmapDays])
  
  const heatmapMonthLabels = useMemo(() => {
    const labels: Array<{ label: string; week: number }> = []
    let prevMonth = -1
    for (let i = 0; i < heatmapDays.length; i += 1) {
      const day = heatmapDays[i]
      const month = day.date.getMonth()
      if (month !== prevMonth) {
        labels.push({
          label: day.date.toLocaleDateString(undefined, { month: 'short' }),
          week: Math.floor(i / 7),
        })
        prevMonth = month
      }
    }
    return labels
  }, [heatmapDays])

  const allPoints = useMemo<TimelinePoint[]>(() => {
    const points: TimelinePoint[] = []
    bookmarks.forEach(bm => points.push({
      id: `bm-${bm.id}`, source: 'bookmark', title: bm.title, url: bm.url, domain: bm.domain, category: bm.category, timestamp: bm.dateAdded, visitCount: bm.visitCount ?? 0,
    }))
    tabs.forEach(t => points.push({
      id: `tab-${t.id}`, source: 'tab', title: t.title, url: t.url, domain: t.domain, category: t.category, timestamp: t.lastAccessed || Date.now(), visitCount: t.visitCount ?? 0, tabId: t.id, windowId: t.windowId,
    }))
    return points.sort((a, b) => a.timestamp - b.timestamp)
  }, [bookmarks, tabs])

  const timelineRange = useMemo(() => {
    const now = Date.now()
    if (zoom === 'all') {
      const first = allPoints[0]?.timestamp ?? now - 30 * 86_400_000
      return { start: first, end: now }
    }
    const durationByZoom: Record<Exclude<TimelineZoom, 'all'>, number> = {
      '7d': 7 * 86_400_000,
      '30d': 30 * 86_400_000,
      '6m': 180 * 86_400_000,
    }
    return { start: now - durationByZoom[zoom], end: now }
  }, [allPoints, zoom])

  const visiblePoints = useMemo(() => 
    allPoints.filter(p => p.timestamp >= timelineRange.start && p.timestamp <= timelineRange.end),
    [allPoints, timelineRange]
  )

  const domainColor = useMemo(() => {
    const colorByKey = new Map<string, string>()
    for (const point of visiblePoints) {
      const key = point.category?.trim() || point.domain
      if (!colorByKey.has(key)) colorByKey.set(key, colorFromString(key))
    }
    return colorByKey
  }, [visiblePoints])

  const [minVisits, maxVisits] = useMemo(() => {
    if (visiblePoints.length === 0) return [0, 1]
    const visits = visiblePoints.map(p => p.visitCount)
    return [Math.min(...visits), Math.max(...visits)]
  }, [visiblePoints])

  const xForTimestamp = (timestamp: number) => {
    const total = Math.max(1, timelineRange.end - timelineRange.start)
    const ratio = (timestamp - timelineRange.start) / total
    const width = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT
    return PADDING_LEFT + ratio * width
  }

  const sizeForVisits = (visitCount: number) => {
    if (maxVisits === minVisits) return 6
    const ratio = (visitCount - minVisits) / (maxVisits - minVisits)
    return 4 + ratio * 12
  }

  const selectedDay = selectedDayKey ? heatmapDays.find(d => d.key === selectedDayKey) ?? null : null

  async function openPage(url: string) {
    await chrome.tabs.create({ url })
  }

  const controls = (
    <div className="flex items-center gap-1">
      <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Zoom:</span>
      {(['7d', '30d', '6m', 'all'] as TimelineZoom[]).map(z => (
        <Button key={z} type="button" size="sm" variant={zoom === z ? 'default' : 'outline'} className="h-7 px-3 text-[10px]" onClick={() => setZoom(z)}>
          {z === '7d' ? '7D' : z === '30d' ? '30D' : z === '6m' ? '6M' : 'ALL'}
        </Button>
      ))}
    </div>
  )

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading timeline...</div>

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      {viewMenuHost && createPortal(controls, viewMenuHost)}

      <div className="flex flex-col gap-6 overflow-hidden">
        {/* 1. HEATMAP SECTION */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Activity Summary ({Math.round(cellDays / 7)} Weeks)</h3>
          <div className="relative overflow-x-auto rounded-md border border-border bg-card/40 p-4">
            <div className="relative ml-8 h-5" style={{ width: Math.ceil(cellDays / 7) * 12 }}>
              {heatmapMonthLabels.map((month) => (
                <span key={`${month.label}-${month.week}`} className="absolute text-[10px] text-muted-foreground" style={{ left: month.week * 12 }}>
                  {month.label}
                </span>
              ))}
            </div>
            <div className="flex items-start gap-2">
              <div className="mt-1 flex h-[82px] flex-col justify-between text-[10px] text-muted-foreground mr-1">
                <span>Mon</span><span>Wed</span><span>Fri</span><span>Sun</span>
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.ceil(cellDays / 7)}, 10px)`, gridTemplateRows: 'repeat(7, 10px)' }}>
                {heatmapDays.map((day, index) => {
                  const week = Math.floor(index / 7)
                  const row = (day.date.getDay() + 6) % 7
                  return (
                    <button
                      key={day.key}
                      type="button"
                      className={cn(
                        'h-2.5 w-2.5 rounded-sm border border-background transition-colors',
                        colorForCount(day.count, heatmapMaxCount),
                        selectedDayKey === day.key ? 'ring-1 ring-primary pr-0.5' : '',
                      )}
                      style={{ gridColumn: week + 1, gridRow: row + 1 }}
                      onMouseMove={(e) => setHover({ day, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setSelectedDayKey(day.key === selectedDayKey ? null : day.key)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 2. TIMELINE SECTION */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">Detailed Timeline View</h3>
          <div className="relative overflow-x-auto rounded-md border border-border bg-card/40 p-3">
            <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-[200px] min-w-[900px] w-full">
              <line x1={PADDING_LEFT} y1={BOOKMARK_ROW_Y} x2={SVG_WIDTH - PADDING_RIGHT} y2={BOOKMARK_ROW_Y} stroke="hsl(var(--border))" strokeDasharray="4 4" />
              <line x1={PADDING_LEFT} y1={TAB_ROW_Y} x2={SVG_WIDTH - PADDING_RIGHT} y2={TAB_ROW_Y} stroke="hsl(var(--border))" strokeDasharray="4 4" />
              <text x={16} y={BOOKMARK_ROW_Y + 4} fill="hsl(var(--muted-foreground))" fontSize="12">Bookmarks</text>
              <text x={36} y={TAB_ROW_Y + 4} fill="hsl(var(--muted-foreground))" fontSize="12">Tabs</text>

              {createTicks(timelineRange.start, timelineRange.end, 6).map((tick) => {
                const x = xForTimestamp(tick)
                return (
                  <g key={tick}>
                    <line x1={x} y1={10} x2={x} y2={SVG_HEIGHT - 10} stroke="hsl(var(--border))" strokeOpacity={0.4} strokeDasharray="2 2" />
                    <text x={x} y={SVG_HEIGHT - 2} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10">
                      {new Date(tick).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </text>
                  </g>
                )
              })}

              {visiblePoints.map((point) => {
                const x = xForTimestamp(point.timestamp)
                const y = point.source === 'bookmark' ? BOOKMARK_ROW_Y : TAB_ROW_Y
                const size = sizeForVisits(point.visitCount)
                const key = point.category?.trim() || point.domain
                const color = domainColor.get(key) ?? 'hsl(var(--primary))'

                return (
                  <circle
                    key={point.id}
                    cx={x}
                    cy={y}
                    r={size}
                    fill={color}
                    className="cursor-pointer transition-transform hover:scale-125"
                    onMouseMove={(e) => setHover({ point, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => void openPage(point.url)}
                  />
                )
              })}
            </svg>
          </div>
        </section>
      </div>

      {/* 3. DETAILS ASIDE (Right Side) */}
      <aside className="flex flex-col gap-4 rounded-md border border-border bg-card/40 p-4">
        {selectedDay ? (
          <>
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h4 className="text-sm font-semibold">{formatLongDate(selectedDay.date)}</h4>
                <p className="text-xs text-muted-foreground">{selectedDay.count} interactions</p>
              </div>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setSelectedDayKey(null)}>×</Button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {selectedDay.pages.map((page) => (
                <button key={page.id} type="button" onClick={() => void openPage(page.url)}
                        className="group flex w-full items-start gap-2.5 rounded-md border border-transparent p-1.5 text-left hover:bg-background/60 hover:border-border transition-all">
                  <Favicon domain={page.domain} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[11px] font-medium group-hover:text-primary transition-colors">{page.title}</div>
                    <div className="truncate text-[9px] text-muted-foreground">{page.url}</div>
                  </div>
                </button>
              ))}
              {selectedDay.pages.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">No events recorded.</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-center">
            <div className="space-y-2 px-4">
              <p className="text-xs text-muted-foreground">Select a day on the activity map above to inspect details</p>
            </div>
          </div>
        )}
      </aside>

      {/* SHARED TOOLTIP */}
      {hover && (
        <div className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm"
             style={{ left: hover.x + 12, top: hover.y + 12 }}>
          {hover.day && (
            <>
              <div className="font-bold">{formatLongDate(hover.day.date)}</div>
              <div className="text-muted-foreground">{hover.day.count} visits</div>
              <div className="mt-1 text-[10px] text-muted-foreground italic truncate">
                {hover.day.domains.slice(0, 3).join(', ')}{hover.day.domains.length > 3 ? '...' : ''}
              </div>
            </>
          )}
          {hover.point && (
            <>
              <div className="font-bold line-clamp-2">{hover.point.title || hover.point.url}</div>
              <div className="mt-1 text-muted-foreground">
                {hover.point.domain} · {formatDate(hover.point.timestamp)}
              </div>
              <div className="font-medium text-accent">{hover.point.visitCount} visits</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function createTicks(start: number, end: number, count: number): number[] {
  const result: number[] = []
  const span = Math.max(1, end - start)
  for (let i = 0; i <= count; i += 1) {
    result.push(start + (span * i) / count)
  }
  return result
}

function colorFromString(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 70% 60%)`
}

function toDayKey(date: Date): string {
  return startOfDay(date).toDateString()
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function formatLongDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function colorForCount(count: number, max: number): string {
  if (count <= 0) return 'bg-muted/30'
  const ratio = count / Math.max(1, max)
  if (ratio <= 0.2) return 'bg-primary/20'
  if (ratio <= 0.4) return 'bg-primary/40'
  if (ratio <= 0.6) return 'bg-primary/60'
  if (ratio <= 0.8) return 'bg-primary/80'
  return 'bg-primary'
}
