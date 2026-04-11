import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ViewProps } from '@/components/views/types'
import { formatDate } from '@/lib/utils'

type TimelineZoom = '7d' | '30d' | '6m' | 'all'

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
  point: TimelinePoint
  x: number
  y: number
}

const SVG_WIDTH = 1200
const SVG_HEIGHT = 220
const PADDING_LEFT = 80
const PADDING_RIGHT = 20
const BOOKMARK_ROW_Y = 70
const TAB_ROW_Y = 150

export function TimelineView({ bookmarks, tabs, loading }: ViewProps) {
  const [zoom, setZoom] = useState<TimelineZoom>('30d')
  const [hover, setHover] = useState<HoverState | null>(null)

  const allPoints = useMemo<TimelinePoint[]>(() => {
    const points: TimelinePoint[] = []

    for (const bookmark of bookmarks) {
      points.push({
        id: `bm-${bookmark.id}`,
        source: 'bookmark',
        title: bookmark.title,
        url: bookmark.url,
        domain: bookmark.domain,
        category: bookmark.category,
        timestamp: bookmark.dateAdded,
        visitCount: bookmark.visitCount ?? 0,
      })
    }

    for (const tab of tabs) {
      const timestamp = tab.lastAccessed || Date.now()
      points.push({
        id: `tab-${tab.id}`,
        source: 'tab',
        title: tab.title,
        url: tab.url,
        domain: tab.domain,
        category: tab.category,
        timestamp,
        visitCount: tab.visitCount ?? 0,
        tabId: tab.id,
        windowId: tab.windowId,
      })
    }

    return points.sort((a, b) => a.timestamp - b.timestamp)
  }, [bookmarks, tabs])

  const timelineRange = useMemo(() => {
    const now = Date.now()
    if (allPoints.length === 0) return { start: now - 30 * 86_400_000, end: now }

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

  const visiblePoints = useMemo(
    () =>
      allPoints.filter(
        (point) => point.timestamp >= timelineRange.start && point.timestamp <= timelineRange.end,
      ),
    [allPoints, timelineRange],
  )

  const domainColor = useMemo(() => {
    const colorByKey = new Map<string, string>()
    for (const point of visiblePoints) {
      const key = point.category?.trim() || point.domain
      if (!colorByKey.has(key)) {
        colorByKey.set(key, colorFromString(key))
      }
    }
    return colorByKey
  }, [visiblePoints])

  const [minVisits, maxVisits] = useMemo(() => {
    if (visiblePoints.length === 0) return [0, 1]
    const visits = visiblePoints.map((point) => point.visitCount)
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

  async function openPoint(point: TimelinePoint) {
    if (point.source === 'tab' && point.tabId != null && point.windowId != null) {
      await chrome.tabs.update(point.tabId, { active: true })
      await chrome.windows.update(point.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: point.url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading timeline data...</div>
  }

  if (allPoints.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No events available for timeline.</div>
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={zoom === '7d' ? 'default' : 'outline'} onClick={() => setZoom('7d')}>
          7 days
        </Button>
        <Button type="button" size="sm" variant={zoom === '30d' ? 'default' : 'outline'} onClick={() => setZoom('30d')}>
          30 days
        </Button>
        <Button type="button" size="sm" variant={zoom === '6m' ? 'default' : 'outline'} onClick={() => setZoom('6m')}>
          6 months
        </Button>
        <Button type="button" size="sm" variant={zoom === 'all' ? 'default' : 'outline'} onClick={() => setZoom('all')}>
          All time
        </Button>
      </div>

      <div className="relative overflow-x-auto rounded-md border border-border bg-card/40 p-3">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-[220px] min-w-[900px] w-full">
          <line x1={PADDING_LEFT} y1={BOOKMARK_ROW_Y} x2={SVG_WIDTH - PADDING_RIGHT} y2={BOOKMARK_ROW_Y} stroke="hsl(var(--border))" />
          <line x1={PADDING_LEFT} y1={TAB_ROW_Y} x2={SVG_WIDTH - PADDING_RIGHT} y2={TAB_ROW_Y} stroke="hsl(var(--border))" />
          <text x={16} y={BOOKMARK_ROW_Y + 4} fill="hsl(var(--muted-foreground))" fontSize="12">Bookmarks</text>
          <text x={36} y={TAB_ROW_Y + 4} fill="hsl(var(--muted-foreground))" fontSize="12">Tabs</text>

          {createTicks(timelineRange.start, timelineRange.end, 6).map((tick) => {
            const x = xForTimestamp(tick)
            return (
              <g key={tick}>
                <line x1={x} y1={20} x2={x} y2={SVG_HEIGHT - 16} stroke="hsl(var(--border))" strokeDasharray="2 4" />
                <text x={x} y={14} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10">
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
                opacity={0.9}
                className="cursor-pointer transition-opacity hover:opacity-100"
                onMouseMove={(event) =>
                  setHover({
                    point,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
                onMouseLeave={() => setHover(null)}
                onClick={() => void openPoint(point)}
              />
            )
          })}
        </svg>

        {hover && (
          <div
            className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
            style={{ left: hover.x + 12, top: hover.y + 12 }}
          >
            <div className="line-clamp-2 font-medium text-foreground">{hover.point.title || hover.point.url}</div>
            <div className="mt-1 text-muted-foreground">
              {hover.point.domain} · {formatDate(hover.point.timestamp)} · {hover.point.visitCount} visits
            </div>
          </div>
        )}
      </div>

      {visiblePoints.length === 0 && (
        <div className="text-sm text-muted-foreground">No points in the selected period.</div>
      )}
    </section>
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
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 65% 55%)`
}

