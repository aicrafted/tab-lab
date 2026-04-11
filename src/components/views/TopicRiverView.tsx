import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { colorFromKey } from '@/components/views/stubs'

type RiverMode = 'saved' | 'visited'
type BucketUnit = 'week' | 'month'

interface RiverItem {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  category: string
  timestamp: number
  favIconUrl?: string
  tabId?: number
  windowId?: number
}

interface Bucket {
  key: string
  start: number
  label: string
}

interface BucketCategoryData {
  count: number
  items: RiverItem[]
}

interface SelectedBand {
  bucketKey: string
  category: string
}

interface HoverState {
  x: number
  y: number
  monthLabel: string
  category: string
  count: number
}

const WIDTH = 1000
const HEIGHT = 400
const PADDING_LEFT = 70
const PADDING_RIGHT = 20
const PADDING_TOP = 18
const PADDING_BOTTOM = 36

export function TopicRiverView({ bookmarks, tabs, loading }: ViewProps) {
  const [mode, setMode] = useState<RiverMode>('saved')
  const [selectedBand, setSelectedBand] = useState<SelectedBand | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  const items = useMemo<RiverItem[]>(() => {
    if (mode === 'saved') {
      return bookmarks
        .filter((bookmark) => bookmark.dateAdded > 0)
        .map((bookmark) => ({
          id: `bm-${bookmark.id}`,
          source: 'bookmark',
          title: bookmark.title || bookmark.url,
          url: bookmark.url,
          domain: bookmark.domain,
          category: bookmark.category?.trim() || bookmark.domain,
          timestamp: bookmark.dateAdded,
        }))
    }

    const bookmarkVisited = bookmarks
      .filter((bookmark) => bookmark.lastVisited != null && bookmark.lastVisited > 0)
      .map((bookmark) => ({
        id: `bm-${bookmark.id}`,
        source: 'bookmark' as const,
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        category: bookmark.category?.trim() || bookmark.domain,
        timestamp: bookmark.lastVisited as number,
      }))

    const tabVisited = tabs
      .filter((tab) => tab.lastAccessed > 0)
      .map((tab) => ({
        id: `tab-${tab.id}`,
        source: 'tab' as const,
        title: tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        category: tab.category?.trim() || tab.domain,
        timestamp: tab.lastAccessed,
        favIconUrl: tab.favIconUrl,
        tabId: tab.id,
        windowId: tab.windowId,
      }))

    return [...bookmarkVisited, ...tabVisited]
  }, [bookmarks, tabs, mode])

  const bucketInfo = useMemo(() => {
    if (items.length === 0) return { unit: 'month' as BucketUnit, buckets: [] as Bucket[] }
    const timestamps = items.map((item) => item.timestamp)
    const minTs = Math.min(...timestamps)
    const maxTs = Math.max(...timestamps)
    const rangeMs = maxTs - minTs
    const useWeekly = rangeMs < 60 * 86_400_000
    const unit: BucketUnit = useWeekly ? 'week' : 'month'
    const start = unit === 'week' ? startOfWeek(minTs) : startOfMonth(minTs)
    const end = unit === 'week' ? startOfWeek(maxTs) : startOfMonth(maxTs)
    const buckets: Bucket[] = []
    let cursor = start
    while (cursor <= end) {
      buckets.push({
        key: bucketKey(cursor, unit),
        start: cursor,
        label: formatBucketLabel(cursor, unit),
      })
      cursor = addUnit(cursor, unit)
    }
    return { unit, buckets }
  }, [items])

  const matrix = useMemo(() => {
    const byBucketCategory = new Map<string, BucketCategoryData>()
    const categoryTotals = new Map<string, number>()

    for (const item of items) {
      const bucketStart = bucketInfo.unit === 'week' ? startOfWeek(item.timestamp) : startOfMonth(item.timestamp)
      const key = `${bucketKey(bucketStart, bucketInfo.unit)}||${item.category}`
      const current = byBucketCategory.get(key) ?? { count: 0, items: [] }
      byBucketCategory.set(key, { count: current.count + 1, items: [...current.items, item] })
      categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + 1)
    }

    const categories = Array.from(categoryTotals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([category]) => category)

    return { byBucketCategory, categories, categoryTotals }
  }, [items, bucketInfo])

  const stacked = useMemo(() => {
    if (bucketInfo.buckets.length === 0 || matrix.categories.length === 0) return []

    const totalsByBucket = new Map<string, number>()
    for (const bucket of bucketInfo.buckets) {
      let total = 0
      for (const category of matrix.categories) {
        const key = `${bucket.key}||${category}`
        total += matrix.byBucketCategory.get(key)?.count ?? 0
      }
      totalsByBucket.set(bucket.key, total)
    }
    const maxTotal = Math.max(1, ...totalsByBucket.values())

    const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT
    const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM
    const xForIndex = (index: number) =>
      PADDING_LEFT + (bucketInfo.buckets.length === 1 ? plotWidth / 2 : (index / (bucketInfo.buckets.length - 1)) * plotWidth)
    const yForValue = (value: number) => PADDING_TOP + plotHeight - (value / maxTotal) * plotHeight

    return matrix.categories.map((category) => {
      const topPoints: Array<{ x: number; y: number; count: number; bucket: Bucket }> = []
      const bottomPoints: Array<{ x: number; y: number; count: number; bucket: Bucket }> = []
      let running = new Array<number>(bucketInfo.buckets.length).fill(0)

      const priorCategories = matrix.categories.slice(0, matrix.categories.indexOf(category))
      for (let i = 0; i < bucketInfo.buckets.length; i += 1) {
        const bucket = bucketInfo.buckets[i]
        let bottom = 0
        for (const prev of priorCategories) {
          bottom += matrix.byBucketCategory.get(`${bucket.key}||${prev}`)?.count ?? 0
        }
        running[i] = bottom
      }

      for (let i = 0; i < bucketInfo.buckets.length; i += 1) {
        const bucket = bucketInfo.buckets[i]
        const count = matrix.byBucketCategory.get(`${bucket.key}||${category}`)?.count ?? 0
        const bottom = running[i]
        const top = bottom + count
        const x = xForIndex(i)
        topPoints.push({ x, y: yForValue(top), count, bucket })
        bottomPoints.push({ x, y: yForValue(bottom), count, bucket })
      }

      return {
        category,
        path: areaPath(topPoints, bottomPoints),
        topPoints,
        bottomPoints,
      }
    })
  }, [bucketInfo, matrix])

  const selectedItems = useMemo(() => {
    if (!selectedBand) return []
    return matrix.byBucketCategory.get(`${selectedBand.bucketKey}||${selectedBand.category}`)?.items ?? []
  }, [matrix.byBucketCategory, selectedBand])

  async function openItem(item: RiverItem) {
    if (item.source === 'tab' && item.tabId != null && item.windowId != null) {
      await chrome.tabs.update(item.tabId, { active: true })
      await chrome.windows.update(item.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: item.url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading topic river...</div>
  }

  if (items.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No items available for topic river.</div>
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={mode === 'saved' ? 'default' : 'outline'} onClick={() => setMode('saved')}>
            Saved
          </Button>
          <Button type="button" size="sm" variant={mode === 'visited' ? 'default' : 'outline'} onClick={() => setMode('visited')}>
            Visited
          </Button>
          <span className="text-xs text-muted-foreground">
            Buckets: {bucketInfo.unit === 'week' ? 'weekly' : 'monthly'}
          </span>
        </div>

        <div className="relative overflow-x-auto rounded-md border border-border bg-card/30 p-2">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-[400px] min-w-[900px] w-full">
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="hsl(var(--background))" />

            {stacked.map((band) => (
              <path
                key={band.category}
                d={band.path}
                fill={colorFromKey(band.category)}
                fillOpacity={0.62}
                stroke={colorFromKey(band.category)}
                strokeWidth={1}
              />
            ))}

            {stacked.map((band) =>
              band.topPoints.map((point, index) => {
                const bottom = band.bottomPoints[index]
                const y = (point.y + bottom.y) / 2
                const count = point.count
                return (
                  <circle
                    key={`${band.category}-${point.bucket.key}`}
                    cx={point.x}
                    cy={y}
                    r={8}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseMove={(event) =>
                      setHover({
                        x: event.clientX,
                        y: event.clientY,
                        monthLabel: point.bucket.label,
                        category: band.category,
                        count,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelectedBand({ bucketKey: point.bucket.key, category: band.category })}
                  />
                )
              }),
            )}

            {bucketInfo.buckets.map((bucket, index) => {
              const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT
              const x = PADDING_LEFT + (bucketInfo.buckets.length === 1 ? plotWidth / 2 : (index / (bucketInfo.buckets.length - 1)) * plotWidth)
              return (
                <g key={bucket.key}>
                  <line x1={x} y1={PADDING_TOP} x2={x} y2={HEIGHT - PADDING_BOTTOM} stroke="hsl(var(--border))" strokeDasharray="2 4" />
                  <text x={x} y={HEIGHT - 10} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10">
                    {bucket.label}
                  </text>
                </g>
              )
            })}
          </svg>

          {hover && (
            <div
              className="pointer-events-none fixed z-50 rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="font-medium text-foreground">{hover.monthLabel}</div>
              <div className="text-muted-foreground">{hover.category} · {hover.count}</div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {matrix.categories.map((category) => (
            <div key={category} className="inline-flex items-center gap-1.5 rounded border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorFromKey(category) }} />
              {category} ({matrix.categoryTotals.get(category)})
            </div>
          ))}
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card/30 p-3">
        <h3 className="text-sm font-semibold text-foreground">
          {selectedBand ? `${selectedBand.category} · ${selectedBand.bucketKey}` : 'Select a band'}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedBand ? `${selectedItems.length} pages` : 'Click a stream segment to inspect pages'}
        </p>

        <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto">
          {selectedItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void openItem(item)}
              className="w-full rounded-md border border-border bg-background/60 p-2 text-left hover:bg-background"
            >
              <div className="flex items-start gap-2">
                <Favicon domain={item.domain} src={item.favIconUrl} />
                <div className="min-w-0">
                  <div className="line-clamp-2 text-xs font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{item.domain}</div>
                </div>
              </div>
            </button>
          ))}
          {selectedBand && selectedItems.length === 0 && (
            <div className="text-xs text-muted-foreground">No pages in this bucket/category.</div>
          )}
        </div>
      </aside>
    </section>
  )
}

function areaPath(
  top: Array<{ x: number; y: number }>,
  bottom: Array<{ x: number; y: number }>,
): string {
  if (top.length === 0 || bottom.length === 0) return ''
  let d = smoothPath(top)
  const reversedBottom = [...bottom].reverse()
  d += ` L ${reversedBottom[0].x} ${reversedBottom[0].y}`
  d += smoothCurveContinuation(reversedBottom)
  d += ' Z'
  return d
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  d += smoothCurveContinuation(points)
  return d
}

function smoothCurveContinuation(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return ''
  let d = ''
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const dx = (p1.x - p0.x) / 3
    d += ` C ${p0.x + dx} ${p0.y} ${p1.x - dx} ${p1.y} ${p1.x} ${p1.y}`
  }
  return d
}

function startOfMonth(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

function startOfWeek(timestamp: number): number {
  const date = new Date(timestamp)
  const day = date.getDay()
  const diff = (day + 6) % 7
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff)
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()).getTime()
}

function addUnit(timestamp: number, unit: BucketUnit): number {
  const date = new Date(timestamp)
  if (unit === 'week') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7).getTime()
  }
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
}

function bucketKey(timestamp: number, unit: BucketUnit): string {
  const date = new Date(timestamp)
  if (unit === 'week') {
    return `${date.getFullYear()}-W${String(weekNumber(date)).padStart(2, '0')}`
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatBucketLabel(timestamp: number, unit: BucketUnit): string {
  const date = new Date(timestamp)
  if (unit === 'week') {
    return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function weekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
}


