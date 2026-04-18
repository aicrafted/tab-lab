import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { effectiveIntent } from '@/lib/ai/static-intent'

type RiverMode = 'saved' | 'visited'
type BucketUnit = 'day' | 'week' | 'month'
type GroupBy = 'categories' | 'domains' | 'tags' | 'platforms' | 'intents'

interface RiverItem {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  category: string
  platform?: string
  tags: string[]
  intent: string
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

interface ZoomRange {
  start: number
  end: number
}

interface DragZoom {
  startX: number
  currentX: number
  mode: 'select' | 'pan'
  rangeStart: ZoomRange
}

const WIDTH = 1000
const HEIGHT = 400
const PADDING_LEFT = 70
const PADDING_RIGHT = 20
const PADDING_TOP = 18
const PADDING_BOTTOM = 36
const AXIS_DRAG_Y_THRESHOLD = HEIGHT - PADDING_BOTTOM - 4
const MIN_ZOOM_BUCKETS = 4
const DAY_MS = 86_400_000

const HUE_SECTORS = 19
const MAX_TOP_CATEGORIES = 19
const TOPIC_RIVER_PALETTE = Array.from({ length: HUE_SECTORS }, (_, index) => {
  const hue = Math.round((index * 360) / HUE_SECTORS)
  return `hsl(${hue} 68% 54%)`
})
const OTHER_CATEGORY_COLOR = 'hsl(210 8% 56%)'

export function TopicRiverView({ bookmarks, tabs, loading }: ViewProps) {
  const [mode, setMode] = useState<RiverMode>('saved')
  const [groupBy, setGroupBy] = useState<GroupBy>('categories')
  const [selectedBand, setSelectedBand] = useState<SelectedBand | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)
  const [dragZoom, setDragZoom] = useState<DragZoom | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

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
          platform: bookmark.platform,
          tags: bookmark.tags ?? [],
          intent: effectiveIntent(bookmark) ?? 'other',
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
        platform: bookmark.platform,
        tags: bookmark.tags ?? [],
        intent: effectiveIntent(bookmark) ?? 'other',
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
        platform: tab.platform,
        tags: tab.tags ?? [],
        intent: effectiveIntent(tab) ?? 'other',
        timestamp: tab.lastAccessed,
        favIconUrl: tab.favIconUrl,
        tabId: tab.id,
        windowId: tab.windowId,
      }))

    return [...bookmarkVisited, ...tabVisited]
  }, [bookmarks, tabs, mode])

  const timeline = useMemo(() => {
    if (items.length === 0) return { dayBuckets: [] as Bucket[] }
    const timestamps = items.map((item) => item.timestamp)
    const minTs = Math.min(...timestamps)
    const maxTs = Math.max(...timestamps)
    const start = startOfDay(minTs)
    const end = startOfDay(maxTs)
    const dayBuckets: Bucket[] = []
    let cursor = start
    while (cursor <= end) {
      dayBuckets.push({
        key: bucketKey(cursor, 'day'),
        start: cursor,
        label: formatBucketLabel(cursor, 'day'),
      })
      cursor = addUnit(cursor, 'day')
    }
    return { dayBuckets }
  }, [items])

  useEffect(() => {
    const total = timeline.dayBuckets.length
    if (total === 0) {
      setZoomRange(null)
      return
    }
    setZoomRange((prev) => {
      if (!prev) return { start: 0, end: total - 1 }
      const start = Math.max(0, Math.min(prev.start, total - 1))
      const end = Math.max(start, Math.min(prev.end, total - 1))
      return { start, end }
    })
  }, [timeline.dayBuckets.length])

  const isZoomed = !!zoomRange && (zoomRange.start > 0 || zoomRange.end < timeline.dayBuckets.length - 1)

  const visibleDayBuckets = useMemo(() => {
    if (timeline.dayBuckets.length === 0) return [] as Bucket[]
    if (!zoomRange) return timeline.dayBuckets
    return timeline.dayBuckets.slice(zoomRange.start, zoomRange.end + 1)
  }, [timeline.dayBuckets, zoomRange])

  const visibleStartIndex = zoomRange?.start ?? 0

  const visibleRange = useMemo(() => {
    if (visibleDayBuckets.length === 0) return null
    return {
      start: visibleDayBuckets[0].start,
      end: visibleDayBuckets[visibleDayBuckets.length - 1].start,
    }
  }, [visibleDayBuckets])

  const displayUnit = useMemo<BucketUnit>(() => {
    if (!visibleRange) return 'month'
    const spanDays = Math.max(1, Math.round((visibleRange.end - visibleRange.start) / DAY_MS) + 1)
    if (spanDays <= 45) return 'day'
    if (spanDays <= 180) return 'week'
    return 'month'
  }, [visibleRange])

  const visibleBuckets = useMemo(() => {
    if (!visibleRange) return [] as Bucket[]
    const start = displayUnit === 'day'
      ? startOfDay(visibleRange.start)
      : displayUnit === 'week'
        ? startOfWeek(visibleRange.start)
        : startOfMonth(visibleRange.start)
    const end = displayUnit === 'day'
      ? startOfDay(visibleRange.end)
      : displayUnit === 'week'
        ? startOfWeek(visibleRange.end)
        : startOfMonth(visibleRange.end)
    const buckets: Bucket[] = []
    let cursor = start
    while (cursor <= end) {
      buckets.push({
        key: bucketKey(cursor, displayUnit),
        start: cursor,
        label: formatBucketLabel(cursor, displayUnit),
      })
      cursor = addUnit(cursor, displayUnit)
    }
    return buckets
  }, [displayUnit, visibleRange])

  useEffect(() => {
    setSelectedBand(null)
  }, [mode, groupBy, displayUnit])

  const periodItems = useMemo(() => {
    if (!visibleRange) return [] as RiverItem[]
    const endInclusive = visibleRange.end + DAY_MS - 1
    return items.filter((item) => item.timestamp >= visibleRange.start && item.timestamp <= endInclusive)
  }, [items, visibleRange])

  const matrix = useMemo(() => {
    const rawByBucketCategory = new Map<string, BucketCategoryData>()
    const rawCategoryTotals = new Map<string, number>()

    for (const item of periodItems) {
      const bucketStart = displayUnit === 'day'
        ? startOfDay(item.timestamp)
        : displayUnit === 'week'
          ? startOfWeek(item.timestamp)
          : startOfMonth(item.timestamp)
      const groups = groupValues(item, groupBy)
      for (const group of groups) {
        const key = `${bucketKey(bucketStart, displayUnit)}||${group}`
        const current = rawByBucketCategory.get(key) ?? { count: 0, items: [] }
        rawByBucketCategory.set(key, { count: current.count + 1, items: [...current.items, item] })
        rawCategoryTotals.set(group, (rawCategoryTotals.get(group) ?? 0) + 1)
      }
    }

    const sortedCategories = Array.from(rawCategoryTotals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([category]) => category)
    const topCategories = sortedCategories.slice(0, MAX_TOP_CATEGORIES)
    const topSet = new Set(topCategories)
    const hasOther = sortedCategories.length > topCategories.length
    const categories = hasOther ? [...topCategories, 'Other'] : topCategories

    const byBucketCategory = new Map<string, BucketCategoryData>()
    const categoryTotals = new Map<string, number>()
    for (const category of categories) categoryTotals.set(category, 0)

    for (const [rawCategory, total] of rawCategoryTotals.entries()) {
      const displayCategory = topSet.has(rawCategory) ? rawCategory : 'Other'
      categoryTotals.set(displayCategory, (categoryTotals.get(displayCategory) ?? 0) + total)
    }

    for (const [rawKey, value] of rawByBucketCategory.entries()) {
      const splitAt = rawKey.indexOf('||')
      const bucket = splitAt >= 0 ? rawKey.slice(0, splitAt) : rawKey
      const rawCategory = splitAt >= 0 ? rawKey.slice(splitAt + 2) : ''
      const displayCategory = topSet.has(rawCategory) ? rawCategory : 'Other'
      const key = `${bucket}||${displayCategory}`
      const current = byBucketCategory.get(key) ?? { count: 0, items: [] }
      byBucketCategory.set(key, {
        count: current.count + value.count,
        items: [...current.items, ...value.items],
      })
    }

    return { byBucketCategory, categories, categoryTotals }
  }, [displayUnit, groupBy, periodItems])

  useEffect(() => {
    if (!selectedBand) return
    const key = `${selectedBand.bucketKey}||${selectedBand.category}`
    if (!matrix.byBucketCategory.has(key)) {
      setSelectedBand(null)
    }
  }, [matrix.byBucketCategory, selectedBand])

  const stacked = useMemo(() => {
    if (visibleBuckets.length === 0 || matrix.categories.length === 0) return []

    const totalsByBucket = new Map<string, number>()
    for (const bucket of visibleBuckets) {
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
      PADDING_LEFT + (visibleBuckets.length === 1 ? plotWidth / 2 : (index / (visibleBuckets.length - 1)) * plotWidth)
    const yForValue = (value: number) => PADDING_TOP + plotHeight - (value / maxTotal) * plotHeight

    return matrix.categories.map((category) => {
      const topPoints: Array<{ x: number; y: number; count: number; bucket: Bucket }> = []
      const bottomPoints: Array<{ x: number; y: number; count: number; bucket: Bucket }> = []
      let running = new Array<number>(visibleBuckets.length).fill(0)

      const priorCategories = matrix.categories.slice(0, matrix.categories.indexOf(category))
      for (let i = 0; i < visibleBuckets.length; i += 1) {
        const bucket = visibleBuckets[i]
        let bottom = 0
        for (const prev of priorCategories) {
          bottom += matrix.byBucketCategory.get(`${bucket.key}||${prev}`)?.count ?? 0
        }
        running[i] = bottom
      }

      for (let i = 0; i < visibleBuckets.length; i += 1) {
        const bucket = visibleBuckets[i]
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
  }, [visibleBuckets, matrix])

  const selectedItems = useMemo(() => {
    if (!selectedBand) return []
    return matrix.byBucketCategory.get(`${selectedBand.bucketKey}||${selectedBand.category}`)?.items ?? []
  }, [matrix.byBucketCategory, selectedBand])

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, string>()
    let paletteIndex = 0
    for (const category of matrix.categories) {
      if (category === 'Other') {
        map.set(category, OTHER_CATEGORY_COLOR)
        continue
      }
      map.set(category, TOPIC_RIVER_PALETTE[paletteIndex % TOPIC_RIVER_PALETTE.length])
      paletteIndex += 1
    }
    return map
  }, [matrix.categories])

  const xAxisLabelStep = useMemo(() => {
    const bucketCount = visibleBuckets.length
    if (bucketCount <= 1) return 1
    const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT
    const minLabelSpacing = 72
    const maxLabels = Math.max(2, Math.floor(plotWidth / minLabelSpacing))
    return Math.max(1, Math.ceil(bucketCount / maxLabels))
  }, [visibleBuckets.length])

  const dragRect = useMemo(() => {
    if (!dragZoom) return null
    const x1 = Math.max(PADDING_LEFT, Math.min(WIDTH - PADDING_RIGHT, Math.min(dragZoom.startX, dragZoom.currentX)))
    const x2 = Math.max(PADDING_LEFT, Math.min(WIDTH - PADDING_RIGHT, Math.max(dragZoom.startX, dragZoom.currentX)))
    return { x: x1, width: Math.max(0, x2 - x1) }
  }, [dragZoom])

  function svgXToVisibleIndex(xInSvg: number): number {
    if (visibleDayBuckets.length <= 1) return 0
    const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT
    const ratio = Math.max(0, Math.min(1, (xInSvg - PADDING_LEFT) / plotWidth))
    return Math.round(ratio * (visibleDayBuckets.length - 1))
  }

  function clientXToSvgX(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return PADDING_LEFT
    return ((clientX - rect.left) * WIDTH) / rect.width
  }

  function clientYToSvgY(clientY: number): number {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.height <= 0) return HEIGHT
    return ((clientY - rect.top) * HEIGHT) / rect.height
  }

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
          <Select value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <span className="truncate">Group: {groupBy}</span>
            </SelectTrigger>
            <SelectContent className="text-xs">
              <SelectItem value="categories" className="py-0.5 px-2 text-xs">Categories</SelectItem>
              <SelectItem value="domains" className="py-0.5 px-2 text-xs">Domains</SelectItem>
              <SelectItem value="tags" className="py-0.5 px-2 text-xs">Tags</SelectItem>
              <SelectItem value="platforms" className="py-0.5 px-2 text-xs">Platforms</SelectItem>
              <SelectItem value="intents" className="py-0.5 px-2 text-xs">Intents</SelectItem>
            </SelectContent>
          </Select>
          {isZoomed && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setZoomRange({ start: 0, end: timeline.dayBuckets.length - 1 })}
            >
              Reset zoom
            </Button>
          )}
        </div>

        <div className="relative overflow-x-auto rounded-md border border-border bg-card/30 p-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[400px] min-w-[900px] w-full select-none"
            onMouseDown={(event) => {
              if (event.button !== 0) return
              const target = event.target as Element
              const y = clientYToSvgY(event.clientY)
              const isAxisDrag = y >= AXIS_DRAG_Y_THRESHOLD
              if (!isAxisDrag && target.closest('[data-band-hit="1"]')) return
              if (!isAxisDrag && target.tagName.toLowerCase() === 'circle') return
              if (isAxisDrag) event.preventDefault()
              const x = clientXToSvgX(event.clientX)
              const current = zoomRange ?? { start: 0, end: timeline.dayBuckets.length - 1 }
              setDragZoom({
                startX: x,
                currentX: x,
                mode: isAxisDrag ? 'pan' : 'select',
                rangeStart: current,
              })
            }}
            onMouseMove={(event) => {
              if (!dragZoom) return
              const x = clientXToSvgX(event.clientX)
              setDragZoom((prev) => {
                if (!prev) return prev
                if (prev.mode === 'pan') {
                  const total = timeline.dayBuckets.length
                  if (total > 1) {
                    const startIdx = svgXToVisibleIndex(prev.startX)
                    const currentIdx = svgXToVisibleIndex(x)
                    const delta = currentIdx - startIdx
                    const span = prev.rangeStart.end - prev.rangeStart.start
                    const maxStart = Math.max(0, total - (span + 1))
                    const nextStart = Math.max(0, Math.min(maxStart, prev.rangeStart.start - delta))
                    setZoomRange({ start: nextStart, end: nextStart + span })
                  }
                }
                return { ...prev, currentX: x }
              })
            }}
            onMouseUp={(event) => {
              if (!dragZoom) return
              if (dragZoom.mode === 'pan') {
                setDragZoom(null)
                return
              }
              const currentX = clientXToSvgX(event.clientX)
              const startIdx = svgXToVisibleIndex(dragZoom.startX)
              const endIdx = svgXToVisibleIndex(currentX)
              const from = Math.min(startIdx, endIdx)
              const to = Math.max(startIdx, endIdx)
              setDragZoom(null)
              if (to - from < 1) return
              setZoomRange({
                start: visibleStartIndex + from,
                end: visibleStartIndex + to,
              })
            }}
            onMouseLeave={() => setDragZoom(null)}
            onWheel={(event) => {
              const total = timeline.dayBuckets.length
              if (total <= 1) return
              event.preventDefault()

              const current = zoomRange ?? { start: 0, end: total - 1 }
              const currentSpan = current.end - current.start + 1
              const minSpan = Math.min(total, Math.max(1, MIN_ZOOM_BUCKETS))
              const spanStep = Math.max(1, Math.round(currentSpan * 0.18))
              const nextSpan = event.deltaY < 0
                ? Math.max(minSpan, currentSpan - spanStep)
                : Math.min(total, currentSpan + spanStep)

              if (nextSpan === currentSpan) return

              const anchorInVisible = svgXToVisibleIndex(clientXToSvgX(event.clientX))
              const anchorGlobal = visibleStartIndex + anchorInVisible
              const ratio = currentSpan <= 1 ? 0 : (anchorGlobal - current.start) / (currentSpan - 1)
              const unclampedStart = Math.round(anchorGlobal - ratio * (nextSpan - 1))
              const maxStart = Math.max(0, total - nextSpan)
              const nextStart = Math.max(0, Math.min(maxStart, unclampedStart))
              const nextEnd = nextStart + nextSpan - 1
              setZoomRange({ start: nextStart, end: nextEnd })
            }}
          >
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="hsl(var(--background))" />

            {stacked.map((band) => (
              <path
                key={band.category}
                d={band.path}
                fill={categoryColorMap.get(band.category) ?? TOPIC_RIVER_PALETTE[0]}
                fillOpacity={0.62}
                stroke={categoryColorMap.get(band.category) ?? TOPIC_RIVER_PALETTE[0]}
                strokeWidth={1}
              />
            ))}

            {stacked.map((band) =>
              band.topPoints.map((point, index) => {
                const bottom = band.bottomPoints[index]
                const y = (point.y + bottom.y) / 2
                const count = point.count
                const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT
                const stepWidth = visibleBuckets.length <= 1 ? plotWidth : plotWidth / (visibleBuckets.length - 1)
                const hitWidth = Math.max(14, Math.min(36, stepWidth * 0.9))
                const bandHeight = Math.abs(bottom.y - point.y)
                const hitHeight = Math.max(20, bandHeight + 8)
                return (
                  <rect
                    key={`${band.category}-${point.bucket.key}`}
                    data-band-hit="1"
                    x={point.x - hitWidth / 2}
                    y={y - hitHeight / 2}
                    width={hitWidth}
                    height={hitHeight}
                    rx={4}
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

            {visibleBuckets.map((bucket, index) => {
              const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT
              const x = PADDING_LEFT + (visibleBuckets.length === 1 ? plotWidth / 2 : (index / (visibleBuckets.length - 1)) * plotWidth)
              const isLast = index === visibleBuckets.length - 1
              const showLabel = index % xAxisLabelStep === 0 || isLast
              return (
                <g key={bucket.key}>
                  <line x1={x} y1={PADDING_TOP} x2={x} y2={HEIGHT - PADDING_BOTTOM} stroke="hsl(var(--border))" strokeDasharray="2 4" />
                  {showLabel && (
                    <text x={x} y={HEIGHT - 10} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10">
                      {bucket.label}
                    </text>
                  )}
                </g>
              )
            })}

            <rect
              x={PADDING_LEFT}
              y={AXIS_DRAG_Y_THRESHOLD}
              width={WIDTH - PADDING_LEFT - PADDING_RIGHT}
              height={HEIGHT - AXIS_DRAG_Y_THRESHOLD}
              fill="transparent"
              className={dragZoom?.mode === 'pan' ? 'cursor-grabbing' : 'cursor-grab'}
            />

            {dragZoom?.mode === 'select' && dragRect && dragRect.width > 0 && (
              <rect
                x={dragRect.x}
                y={PADDING_TOP}
                width={dragRect.width}
                height={HEIGHT - PADDING_TOP - PADDING_BOTTOM}
                fill="hsl(var(--primary) / 0.18)"
                stroke="hsl(var(--primary))"
                strokeWidth={1}
                pointerEvents="none"
              />
            )}
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
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryColorMap.get(category) ?? TOPIC_RIVER_PALETTE[0] }} />
              <span>{category}</span>
              <sup className="tabular-nums text-[10px] leading-none text-muted-foreground/65">
                {matrix.categoryTotals.get(category)}
              </sup>
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

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
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
  if (unit === 'day') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  }
  if (unit === 'week') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7).getTime()
  }
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
}

function bucketKey(timestamp: number, unit: BucketUnit): string {
  const date = new Date(timestamp)
  if (unit === 'day') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  if (unit === 'week') {
    return `${date.getFullYear()}-W${String(weekNumber(date)).padStart(2, '0')}`
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatBucketLabel(timestamp: number, unit: BucketUnit): string {
  const date = new Date(timestamp)
  if (unit === 'week' || unit === 'day') {
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

function groupValues(item: RiverItem, groupBy: GroupBy): string[] {
  if (groupBy === 'domains') {
    return [item.domain]
  }
  if (groupBy === 'platforms') {
    return [item.platform?.trim() || 'unknown']
  }
  if (groupBy === 'intents') {
    return [item.intent || 'other']
  }
  if (groupBy === 'tags') {
    const normalized = Array.from(new Set(item.tags.map((tag) => tag.trim()).filter(Boolean)))
    return normalized.length > 0 ? normalized : ['untagged']
  }
  return [item.category]
}


