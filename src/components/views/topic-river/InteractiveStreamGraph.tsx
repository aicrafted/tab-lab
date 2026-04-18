import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type BucketUnit = 'day' | 'week' | 'month'

interface Bucket {
  key: string
  start: number
  label: string
}

interface BucketGroupData<T> {
  count: number
  items: T[]
}

interface SelectedBand {
  bucketKey: string
  group: string
}

interface HoverState {
  x: number
  y: number
  label: string
  group: string
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

export interface StreamRecord<T> {
  id: string
  timestamp: number
  groups: string[]
  payload: T
}

export interface StreamBandSelection<T> {
  bucketKey: string
  bucketLabel: string
  group: string
  count: number
  items: T[]
}

export type LegendSide = 'left' | 'right' | 'bottom'

interface InteractiveStreamGraphProps<T> {
  records: StreamRecord<T>[]
  legendSide?: LegendSide
  maxTopGroups?: number
  onSelectionChange?: (selection: StreamBandSelection<T> | null) => void
}

const WIDTH = 1000
const HEIGHT = 400
const PADDING_LEFT = 16
const PADDING_RIGHT = 20
const PADDING_TOP = 18
const PADDING_BOTTOM = 36
const AXIS_DRAG_Y_THRESHOLD = HEIGHT - PADDING_BOTTOM - 4
const MIN_ZOOM_BUCKETS = 4
const DAY_MS = 86_400_000
const HUE_SECTORS = 19
const DEFAULT_MAX_TOP_GROUPS = 19

const STREAM_PALETTE = Array.from({ length: HUE_SECTORS }, (_, index) => {
  const hue = Math.round((index * 360) / HUE_SECTORS)
  return `hsl(${hue} 68% 54%)`
})
const OTHER_GROUP_COLOR = 'hsl(210 8% 56%)'

export function InteractiveStreamGraph<T>({
  records,
  legendSide = 'right',
  maxTopGroups = DEFAULT_MAX_TOP_GROUPS,
  onSelectionChange,
}: InteractiveStreamGraphProps<T>) {
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([])
  const [selectedBand, setSelectedBand] = useState<SelectedBand | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)
  const [dragZoom, setDragZoom] = useState<DragZoom | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const timeline = useMemo(() => {
    if (records.length === 0) return { dayBuckets: [] as Bucket[] }
    const timestamps = records.map((item) => item.timestamp)
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
  }, [records])

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

  const periodRecords = useMemo(() => {
    if (!visibleRange) return [] as StreamRecord<T>[]
    const endInclusive = visibleRange.end + DAY_MS - 1
    return records.filter((item) => item.timestamp >= visibleRange.start && item.timestamp <= endInclusive)
  }, [records, visibleRange])

  const matrix = useMemo(() => {
    const rawByBucketGroup = new Map<string, BucketGroupData<T>>()
    const rawGroupTotals = new Map<string, number>()

    for (const record of periodRecords) {
      const bucketStart = displayUnit === 'day'
        ? startOfDay(record.timestamp)
        : displayUnit === 'week'
          ? startOfWeek(record.timestamp)
          : startOfMonth(record.timestamp)

      for (const group of record.groups) {
        const key = `${bucketKey(bucketStart, displayUnit)}||${group}`
        const current = rawByBucketGroup.get(key) ?? { count: 0, items: [] }
        rawByBucketGroup.set(key, { count: current.count + 1, items: [...current.items, record.payload] })
        rawGroupTotals.set(group, (rawGroupTotals.get(group) ?? 0) + 1)
      }
    }

    const sortedGroups = Array.from(rawGroupTotals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([group]) => group)
    const topGroups = sortedGroups.slice(0, maxTopGroups)
    const topSet = new Set(topGroups)
    const hasOther = sortedGroups.length > topGroups.length
    const groups = hasOther ? [...topGroups, 'Other'] : topGroups

    const byBucketGroup = new Map<string, BucketGroupData<T>>()
    const groupTotals = new Map<string, number>()
    for (const group of groups) groupTotals.set(group, 0)

    for (const [rawGroup, total] of rawGroupTotals.entries()) {
      const displayGroup = topSet.has(rawGroup) ? rawGroup : 'Other'
      groupTotals.set(displayGroup, (groupTotals.get(displayGroup) ?? 0) + total)
    }

    for (const [rawKey, value] of rawByBucketGroup.entries()) {
      const splitAt = rawKey.indexOf('||')
      const bucket = splitAt >= 0 ? rawKey.slice(0, splitAt) : rawKey
      const rawGroup = splitAt >= 0 ? rawKey.slice(splitAt + 2) : ''
      const displayGroup = topSet.has(rawGroup) ? rawGroup : 'Other'
      const key = `${bucket}||${displayGroup}`
      const current = byBucketGroup.get(key) ?? { count: 0, items: [] }
      byBucketGroup.set(key, {
        count: current.count + value.count,
        items: [...current.items, ...value.items],
      })
    }

    return { byBucketGroup, groups, groupTotals }
  }, [displayUnit, maxTopGroups, periodRecords])

  const hiddenSet = useMemo(() => new Set(hiddenGroups), [hiddenGroups])

  const visibleGroups = useMemo(
    () => matrix.groups.filter((group) => !hiddenSet.has(group)),
    [hiddenSet, matrix.groups],
  )

  useEffect(() => {
    setHiddenGroups((prev) => prev.filter((group) => matrix.groups.includes(group)))
  }, [matrix.groups])

  useEffect(() => {
    if (!selectedBand) return
    const key = `${selectedBand.bucketKey}||${selectedBand.group}`
    if (hiddenSet.has(selectedBand.group) || !matrix.byBucketGroup.has(key)) {
      setSelectedBand(null)
    }
  }, [hiddenSet, matrix.byBucketGroup, selectedBand])

  const selectedDetails = useMemo<StreamBandSelection<T> | null>(() => {
    if (!selectedBand) return null
    const row = matrix.byBucketGroup.get(`${selectedBand.bucketKey}||${selectedBand.group}`)
    if (!row) return null
    const bucketLabel = visibleBuckets.find((bucket) => bucket.key === selectedBand.bucketKey)?.label ?? selectedBand.bucketKey
    return {
      bucketKey: selectedBand.bucketKey,
      bucketLabel,
      group: selectedBand.group,
      count: row.count,
      items: row.items,
    }
  }, [matrix.byBucketGroup, selectedBand, visibleBuckets])

  useEffect(() => {
    onSelectionChange?.(selectedDetails)
  }, [onSelectionChange, selectedDetails])

  const stacked = useMemo(() => {
    if (visibleBuckets.length === 0 || visibleGroups.length === 0) return []

    const totalsByBucket = new Map<string, number>()
    for (const bucket of visibleBuckets) {
      let total = 0
      for (const group of visibleGroups) {
        const key = `${bucket.key}||${group}`
        total += matrix.byBucketGroup.get(key)?.count ?? 0
      }
      totalsByBucket.set(bucket.key, total)
    }
    const maxTotal = Math.max(1, ...totalsByBucket.values())

    const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT
    const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM
    const xForIndex = (index: number) =>
      PADDING_LEFT + (visibleBuckets.length === 1 ? plotWidth / 2 : (index / (visibleBuckets.length - 1)) * plotWidth)
    const yForValue = (value: number) => PADDING_TOP + plotHeight - (value / maxTotal) * plotHeight

    return visibleGroups.map((group) => {
      const topPoints: Array<{ x: number; y: number; count: number; bucket: Bucket }> = []
      const bottomPoints: Array<{ x: number; y: number; count: number; bucket: Bucket }> = []
      const priorGroups = visibleGroups.slice(0, visibleGroups.indexOf(group))

      for (let i = 0; i < visibleBuckets.length; i += 1) {
        const bucket = visibleBuckets[i]
        let bottom = 0
        for (const previous of priorGroups) {
          bottom += matrix.byBucketGroup.get(`${bucket.key}||${previous}`)?.count ?? 0
        }
        const count = matrix.byBucketGroup.get(`${bucket.key}||${group}`)?.count ?? 0
        const top = bottom + count
        const x = xForIndex(i)
        topPoints.push({ x, y: yForValue(top), count, bucket })
        bottomPoints.push({ x, y: yForValue(bottom), count, bucket })
      }

      return {
        group,
        path: areaPath(topPoints, bottomPoints),
        topPoints,
        bottomPoints,
      }
    })
  }, [visibleBuckets, visibleGroups, matrix.byBucketGroup])

  const groupColorMap = useMemo(() => {
    const map = new Map<string, string>()
    let paletteIndex = 0
    for (const group of matrix.groups) {
      if (group === 'Other') {
        map.set(group, OTHER_GROUP_COLOR)
        continue
      }
      map.set(group, STREAM_PALETTE[paletteIndex % STREAM_PALETTE.length])
      paletteIndex += 1
    }
    return map
  }, [matrix.groups])

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

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const onWheel = (event: WheelEvent) => {
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
    }

    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [timeline.dayBuckets.length, visibleStartIndex, zoomRange, visibleDayBuckets.length])

  const legend = (
    <aside className={legendSide === 'bottom' ? 'px-4 py-3' : 'p-3'}>
      <div className="max-h-[400px] overflow-y-auto pr-1">
        <div className="flex flex-wrap gap-2">
          {matrix.groups.map((group) => (
            <button
              key={group}
              type="button"
              aria-pressed={!hiddenSet.has(group)}
              onClick={() =>
                setHiddenGroups((prev) =>
                  prev.includes(group) ? prev.filter((item) => item !== group) : [...prev, group],
                )
              }
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] transition-colors ${
                hiddenSet.has(group)
                  ? 'border-border/40 bg-background/20 text-muted-foreground/45 opacity-55 saturate-50'
                  : 'border-border bg-background/60 text-muted-foreground hover:bg-background'
              }`}
              title={hiddenSet.has(group) ? `Show ${group}` : `Hide ${group}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${hiddenSet.has(group) ? 'opacity-50' : ''}`}
                style={{ backgroundColor: groupColorMap.get(group) ?? STREAM_PALETTE[0] }}
              />
              <span>{group}</span>
              <sup className={`tabular-nums text-[10px] leading-none ${hiddenSet.has(group) ? 'text-muted-foreground/40' : 'text-muted-foreground/65'}`}>
                {matrix.groupTotals.get(group)}
              </sup>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )

  return (
    <div className={legendSide === 'bottom' ? 'space-y-3' : 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'}>
      {legendSide === 'left' && legend}
      <div className="relative overflow-x-auto py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!isZoomed}
          onClick={() => setZoomRange({ start: 0, end: timeline.dayBuckets.length - 1 })}
          className="absolute left-9 top-9 z-10 h-6 rounded border-border px-2 py-0 text-[11px]"
        >
          Reset zoom
        </Button>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMinYMin meet"
          className="block h-[400px] min-w-[900px] w-full select-none"
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
        >
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="hsl(var(--background))" />

          {stacked.map((band) => (
            <path
              key={band.group}
              d={band.path}
              fill={groupColorMap.get(band.group) ?? STREAM_PALETTE[0]}
              fillOpacity={0.62}
              stroke={groupColorMap.get(band.group) ?? STREAM_PALETTE[0]}
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
                  key={`${band.group}-${point.bucket.key}`}
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
                      label: point.bucket.label,
                      group: band.group,
                      count,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setSelectedBand({ bucketKey: point.bucket.key, group: band.group })}
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
            <div className="font-medium text-foreground">{hover.label}</div>
            <div className="text-muted-foreground">{hover.group} · {hover.count}</div>
          </div>
        )}
      </div>

      {legendSide === 'right' && legend}
      {legendSide === 'bottom' && legend}
    </div>
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
