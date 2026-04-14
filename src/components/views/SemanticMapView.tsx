import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { colorFromKey, urlToCoords } from '@/components/views/stubs'
import { effectiveIntent } from '@/lib/static-intent'
import type { PageIntent } from '@/lib/types'

type ColorMode = 'category' | 'domain' | 'intent'

interface SemanticPoint {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  category: string
  clusterId?: number
  intent?: PageIntent
  visitCount: number
  x: number
  y: number
  tabId?: number
  windowId?: number
  favIconUrl?: string
}

interface HoverState {
  point: SemanticPoint
  x: number
  y: number
}

const WIDTH = 1000
const HEIGHT = 620
const PADDING = 40

export function SemanticMapView({ bookmarks, tabs, loading, projectedPoints, clusterNames, onRunEmbeddings }: ViewProps) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>('category')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  const toCanvas = (value: number, axis: 'x' | 'y') => {
    const range = axis === 'x' ? WIDTH : HEIGHT
    return PADDING + value * (range - PADDING * 2)
  }

  const points = useMemo<SemanticPoint[]>(() => {
    const bookmarkPoints = bookmarks.map((bookmark) => {
      const category = bookmark.category?.trim() || bookmark.domain
      const projected = projectedPoints?.get(bookmark.url)
      const [x, y] = projected ?? urlToCoords(bookmark.url, category)
      return {
        id: `bm-${bookmark.id}`,
        source: 'bookmark' as const,
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        category,
        clusterId: bookmark.clusterId,
        intent: effectiveIntent(bookmark),
        visitCount: bookmark.visitCount ?? 1,
        x,
        y,
      }
    })

    const tabPoints = tabs.map((tab) => {
      const category = tab.category?.trim() || tab.domain
      const projected = projectedPoints?.get(tab.url)
      const [x, y] = projected ?? urlToCoords(tab.url, category)
      return {
        id: `tab-${tab.id}`,
        source: 'tab' as const,
        title: tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        category,
        clusterId: tab.clusterId,
        intent: effectiveIntent(tab),
        visitCount: tab.visitCount ?? 1,
        x,
        y,
        tabId: tab.id,
        windowId: tab.windowId,
        favIconUrl: tab.favIconUrl,
      }
    })

    return [...bookmarkPoints, ...tabPoints]
  }, [bookmarks, tabs, projectedPoints])

  useEffect(() => {
    if (colorMode !== 'category' && activeCategory != null) {
      setActiveCategory(null)
    }
  }, [colorMode, activeCategory])

  const [minVisit, maxVisit] = useMemo(() => {
    if (points.length === 0) return [0, 1]
    const values = points.map((point) => point.visitCount)
    return [Math.min(...values), Math.max(...values)]
  }, [points])

  const pointSize = (value: number) => {
    if (maxVisit === minVisit) return 6
    const ratio = (value - minVisit) / (maxVisit - minVisit)
    return 4 + ratio * 12
  }

  const centroids = useMemo(() => {
    const groups = new Map<string, { sumX: number; sumY: number; count: number; category: string; clusterId?: number }>()
    for (const point of points) {
      const key = point.clusterId != null ? `cluster:${point.clusterId}` : `category:${point.category}`
      const g = groups.get(key) ?? {
        sumX: 0,
        sumY: 0,
        count: 0,
        category: point.category,
        clusterId: point.clusterId,
      }
      g.sumX += point.x
      g.sumY += point.y
      g.count += 1
      groups.set(key, g)
    }
    return Array.from(groups.values())
      .filter((g) => g.count >= 3)
      .map((g) => ({
        label: g.clusterId != null ? (clusterNames?.get(g.clusterId) ?? g.category) : g.category,
        key: g.clusterId != null ? `cluster:${g.clusterId}` : `category:${g.category}`,
        x: toCanvas(g.sumX / g.count, 'x'),
        y: toCanvas(g.sumY / g.count, 'y'),
        count: g.count,
      }))
  }, [clusterNames, points])

  const outlierSet = useMemo(() => {
    const byCategory = new Map<string, SemanticPoint[]>()
    for (const point of points) {
      byCategory.set(point.category, [...(byCategory.get(point.category) ?? []), point])
    }

    const outliers = new Set<string>()
    for (const members of byCategory.values()) {
      if (members.length < 5) continue
      const cx = members.reduce((sum, point) => sum + point.x, 0) / members.length
      const cy = members.reduce((sum, point) => sum + point.y, 0) / members.length
      const dists = members.map((point) => Math.hypot(point.x - cx, point.y - cy))
      const mean = dists.reduce((sum, dist) => sum + dist, 0) / dists.length
      const std = Math.sqrt(dists.reduce((sum, dist) => sum + (dist - mean) ** 2, 0) / dists.length)
      members.forEach((point, idx) => {
        if (dists[idx] > mean + 2 * std) outliers.add(point.id)
      })
    }

    return outliers
  }, [points])

  const colorKeyForPoint = (point: SemanticPoint): string => {
    if (colorMode === 'domain') return point.domain
    if (colorMode === 'intent') return point.intent ?? 'other'
    return point.category
  }

  const legendValues = useMemo(() => {
    const unique = new Set(points.map((point) => colorKeyForPoint(point)))
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [points, colorMode])

  async function openPoint(point: SemanticPoint) {
    if (point.source === 'tab' && point.tabId != null && point.windowId != null) {
      await chrome.tabs.update(point.tabId, { active: true })
      await chrome.windows.update(point.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: point.url })
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.12 : 0.12
    setZoom((prev) => Math.min(4, Math.max(0.5, prev + delta)))
  }

  function startDrag(event: React.MouseEvent<SVGSVGElement>) {
    setDragging(true)
    setLastPointer({ x: event.clientX, y: event.clientY })
  }

  function moveDrag(event: React.MouseEvent<SVGSVGElement>) {
    if (!dragging || !lastPointer) return
    const dx = event.clientX - lastPointer.x
    const dy = event.clientY - lastPointer.y
    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
    setLastPointer({ x: event.clientX, y: event.clientY })
  }

  function endDrag() {
    setDragging(false)
    setLastPointer(null)
  }

  function fitToScreen() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading semantic map...</div>
  }

  if (points.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No data points for semantic map.</div>
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_220px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={fitToScreen}>
            Fit to screen
          </Button>
          <Button type="button" size="sm" variant={colorMode === 'category' ? 'default' : 'outline'} onClick={() => setColorMode('category')}>
            By category
          </Button>
          <Button type="button" size="sm" variant={colorMode === 'domain' ? 'default' : 'outline'} onClick={() => setColorMode('domain')}>
            By domain
          </Button>
          <Button type="button" size="sm" variant={colorMode === 'intent' ? 'default' : 'outline'} onClick={() => setColorMode('intent')}>
            By intent
          </Button>
          <span className="text-xs text-muted-foreground">Zoom: {zoom.toFixed(2)}x</span>
          <span className="text-xs text-muted-foreground">
            {projectedPoints && projectedPoints.size > 0
              ? `${projectedPoints.size} real embeddings`
              : 'Run Embeddings to populate this view'}
          </span>
          {(!projectedPoints || projectedPoints.size === 0) && onRunEmbeddings && (
            <Button type="button" size="sm" variant="outline" onClick={() => void onRunEmbeddings()}>
              Run Embeddings
            </Button>
          )}
          {projectedPoints && projectedPoints.size > 0 && (
            <span className="text-xs text-muted-foreground">Re-embed required after text format change.</span>
          )}
        </div>

        <div className="relative overflow-hidden rounded-md border border-border bg-card/30">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[620px] w-full cursor-grab"
            onWheel={handleWheel}
            onMouseDown={startDrag}
            onMouseMove={moveDrag}
            onMouseUp={endDrag}
            onMouseLeave={() => {
              endDrag()
              setHover(null)
            }}
          >
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="hsl(var(--background))" />
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {points.map((point) => {
                const cx = toCanvas(point.x, 'x')
                const cy = toCanvas(point.y, 'y')
                const color = colorFromKey(colorKeyForPoint(point))
                const dimmed = colorMode === 'category' && activeCategory != null && point.category !== activeCategory
                const radius = pointSize(point.visitCount)
                const isOutlier = outlierSet.has(point.id)

                return (
                  <g key={point.id}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={color}
                      opacity={dimmed ? 0.1 : 0.85}
                      className="cursor-pointer"
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
                    {isOutlier && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={radius + 2}
                        fill="none"
                        stroke="white"
                        strokeWidth={1.2}
                        strokeDasharray="2 2"
                        opacity={dimmed ? 0.15 : 0.9}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                  </g>
                )
              })}

              {centroids.map((centroid) => (
                <text
                  key={centroid.key}
                  x={centroid.x}
                  y={centroid.y}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="hsl(var(--foreground))"
                  opacity={0.7}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {centroid.label}
                </text>
              ))}
            </g>
          </svg>

          {hover && (
            <div
              className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="flex items-center gap-2">
                <Favicon domain={hover.point.domain} src={hover.point.favIconUrl} />
                <div className="line-clamp-2 font-medium text-foreground">{hover.point.title}</div>
              </div>
              <div className="mt-1 text-muted-foreground">
                {hover.point.domain} · {hover.point.category} · {hover.point.visitCount} visits
              </div>
              {outlierSet.has(hover.point.id) && (
                <div className="mt-1 text-amber-300">
                  ⚠ Outlier — far from "{hover.point.category}" cluster
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card/30 p-3">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Legend</h3>
        <div className="space-y-1.5">
          {legendValues.map((value) => {
            const active = colorMode === 'category' && activeCategory === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  if (colorMode !== 'category') return
                  setActiveCategory((prev) => (prev === value ? null : value))
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-background/70"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: colorFromKey(value) }}
                />
                <span className="truncate">{value}</span>
                {active && <span className="ml-auto text-[10px] text-primary">active</span>}
              </button>
            )
          })}
        </div>
      </aside>
    </section>
  )
}

