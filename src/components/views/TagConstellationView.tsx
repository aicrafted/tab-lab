import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { colorFromKey, getStubIntent } from '@/components/views/stubs'
import { getTagConstellationLayout, type TagConstellationLayoutMode } from '@/lib/tag-constellation-layout'

interface TagPage {
  id: string
  title: string
  url: string
  domain: string
  favIconUrl?: string
  tags: string[]
}

interface TagNode {
  id: string
  tag: string
  count: number
  pages: TagPage[]
  x: number
  y: number
}

interface TagEdge {
  id: string
  source: string
  target: string
  weight: number
  pages: TagPage[]
}

interface HoverNode {
  type: 'node'
  node: TagNode
  x: number
  y: number
}

interface HoverEdge {
  type: 'edge'
  edge: TagEdge
  x: number
  y: number
}

type HoverState = HoverNode | HoverEdge
type ViewLayoutMode = TagConstellationLayoutMode | 'live'

interface LiveNode extends SimulationNodeDatum {
  id: string
  count: number
}

interface LiveEdge extends SimulationLinkDatum<LiveNode> {
  source: string | LiveNode
  target: string | LiveNode
  weight: number
}

const WIDTH = 980
const HEIGHT = 620
const TAG_LIVE_DEFAULTS = {
  elasticity: 0.08,
  repulsion: 680,
  stability: 0.03,
}

export function TagConstellationView({ bookmarks, tabs, loading, onRunTags }: ViewProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(null)
  const [nodeOverrides, setNodeOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [dragNode, setDragNode] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const [layoutMode, setLayoutMode] = useState<ViewLayoutMode>('live')
  const [liveTuning, setLiveTuning] = useState(TAG_LIVE_DEFAULTS)
  const [hasAutoFitted, setHasAutoFitted] = useState(false)
  const [livePositions, setLivePositions] = useState<Record<string, { x: number; y: number }>>({})
  const nodeOverridesRef = useRef<Record<string, { x: number; y: number }>>({})
  const liveSimulationRef = useRef<Simulation<LiveNode, LiveEdge> | null>(null)
  const liveNodesRef = useRef<Map<string, LiveNode>>(new Map())

  useEffect(() => {
    nodeOverridesRef.current = nodeOverrides
  }, [nodeOverrides])

  const pages = useMemo<TagPage[]>(() => {
    const fromBookmarks = bookmarks.map((bookmark) => ({
      id: `bm-${bookmark.id}`,
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      domain: bookmark.domain,
      tags: bookmark.tags ?? [],
    }))

    const fromTabs = tabs.map((tab) => ({
      id: `tab-${tab.id}`,
      title: tab.title || tab.url,
      url: tab.url,
      domain: tab.domain,
      favIconUrl: tab.favIconUrl,
      tags: tab.tags ?? [],
    }))

    return [...fromBookmarks, ...fromTabs]
  }, [bookmarks, tabs])

  const hasRealTags = useMemo(() => pages.some((page) => page.tags.length > 0), [pages])

  const effectivePages = useMemo<TagPage[]>(() => {
    if (hasRealTags) return pages
    return pages.map((page) => ({
      ...page,
      tags: [
        getStubIntent(page.url, page.title),
        page.domain,
      ],
    }))
  }, [pages, hasRealTags])

  const graphBase = useMemo(() => {
    const tagToPages = new Map<string, TagPage[]>()
    for (const page of effectivePages) {
      for (const tag of new Set(page.tags)) {
        if (!tag) continue
        tagToPages.set(tag, [...(tagToPages.get(tag) ?? []), page])
      }
    }

    const topTags = Array.from(tagToPages.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, 50)
      .map(([tag]) => tag)

    const topTagSet = new Set(topTags)

    const nodesBase = topTags.map((tag) => ({
      id: tag,
      tag,
      count: tagToPages.get(tag)?.length ?? 0,
      pages: tagToPages.get(tag) ?? [],
    }))

    const edgeMap = new Map<string, { count: number; pages: TagPage[] }>()
    for (const page of effectivePages) {
      const pageTags = Array.from(new Set(page.tags)).filter((tag) => topTagSet.has(tag)).sort((a, b) => a.localeCompare(b))
      for (let i = 0; i < pageTags.length; i += 1) {
        for (let j = i + 1; j < pageTags.length; j += 1) {
          const a = pageTags[i]
          const b = pageTags[j]
          const key = `${a}||${b}`
          const current = edgeMap.get(key) ?? { count: 0, pages: [] }
          edgeMap.set(key, { count: current.count + 1, pages: [...current.pages, page] })
        }
      }
    }

    const edgesBase: TagEdge[] = Array.from(edgeMap.entries()).map(([key, value]) => {
      const [source, target] = key.split('||')
      return {
        id: key,
        source,
        target,
        weight: value.count,
        pages: value.pages,
      }
    })

    const staticMode: TagConstellationLayoutMode = layoutMode === 'live' ? 'radial' : layoutMode
    const layout = getTagConstellationLayout(nodesBase, edgesBase, WIDTH, HEIGHT, staticMode)
    const nodes: TagNode[] = nodesBase.map((node) => ({
      ...node,
      x: layout.get(node.id)?.x ?? WIDTH / 2,
      y: layout.get(node.id)?.y ?? HEIGHT / 2,
    }))

    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    return { nodes, edges: edgesBase, nodeById }
  }, [effectivePages, layoutMode])

  const graph = useMemo(() => {
    const nodes: TagNode[] = graphBase.nodes.map((node) => {
      const override = nodeOverrides[node.id]
      const live = livePositions[node.id]
      return {
        ...node,
        x: override?.x ?? live?.x ?? node.x,
        y: override?.y ?? live?.y ?? node.y,
      }
    })
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    return { nodes, edges: graphBase.edges, nodeById }
  }, [graphBase, nodeOverrides, livePositions])

  useEffect(() => {
    const valid = new Set(graphBase.nodes.map((node) => node.id))
    setNodeOverrides((prev) => {
      let changed = false
      const next: Record<string, { x: number; y: number }> = {}
      for (const [id, pos] of Object.entries(prev)) {
        if (valid.has(id)) {
          next[id] = pos
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [graphBase.nodes])

  useEffect(() => {
    if (layoutMode !== 'live') {
      liveSimulationRef.current?.stop()
      liveSimulationRef.current = null
      liveNodesRef.current = new Map()
      setLivePositions({})
      return
    }

    const sourceNodes = graphBase.nodes
    const sourceEdges = graphBase.edges
    if (sourceNodes.length === 0) return

    const nodes: LiveNode[] = sourceNodes.map((node) => ({
      id: node.id,
      count: node.count,
      x: nodeOverridesRef.current[node.id]?.x ?? node.x,
      y: nodeOverridesRef.current[node.id]?.y ?? node.y,
    }))
    const edges: LiveEdge[] = sourceEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    }))

    const simulation = forceSimulation(nodes)
      .force('charge', forceManyBody<LiveNode>().strength(-liveTuning.repulsion))
      .force(
        'link',
        forceLink<LiveNode, LiveEdge>(edges)
          .id((node) => node.id)
          .distance((edge) => Math.max(45, 125 - Math.min(65, edge.weight * 5)))
          .strength((edge) => liveTuning.elasticity * Math.max(0.55, Math.min(1.6, edge.weight))),
      )
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collision', forceCollide<LiveNode>().radius((node) => nodeRadius(node.count) + 5))
      .alpha(0.9)
      .alphaTarget(liveTuning.stability)

    let raf = 0
    simulation.on('tick', () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        const next: Record<string, { x: number; y: number }> = {}
        for (const node of nodes) {
          const x = Math.max(24, Math.min(WIDTH - 24, node.x ?? WIDTH / 2))
          const y = Math.max(24, Math.min(HEIGHT - 24, node.y ?? HEIGHT / 2))
          next[node.id] = { x, y }
        }
        setLivePositions(next)
        raf = 0
      })
    })

    liveSimulationRef.current?.stop()
    liveSimulationRef.current = simulation
    liveNodesRef.current = new Map(nodes.map((node) => [node.id, node]))

    return () => {
      simulation.stop()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [layoutMode, graphBase, liveTuning])

  const [minCount, maxCount] = useMemo(() => {
    if (graph.nodes.length === 0) return [0, 1]
    const values = graph.nodes.map((node) => node.count)
    return [Math.min(...values), Math.max(...values)]
  }, [graph.nodes])

  const maxEdgeWeight = useMemo(
    () => graph.edges.reduce((max, edge) => Math.max(max, edge.weight), 1),
    [graph.edges],
  )

  const selectedNode = useMemo(
    () => (selectedTag ? graph.nodes.find((node) => node.id === selectedTag) ?? null : null),
    [graph.nodes, selectedTag],
  )

  function nodeRadius(count: number): number {
    if (maxCount === minCount) return 14
    const ratio = (count - minCount) / (maxCount - minCount)
    return 8 + ratio * 20
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.1 : 0.1
    setZoom((prev) => Math.min(3.5, Math.max(0.5, prev + delta)))
  }

  function startDrag(event: React.MouseEvent<SVGSVGElement>) {
    setDragging(true)
    setLastPointer({ x: event.clientX, y: event.clientY })
  }

  function moveDrag(event: React.MouseEvent<SVGSVGElement>) {
    if (dragNode) {
      const point = getGraphPoint(event, pan, zoom)
      const x = Math.max(24, Math.min(WIDTH - 24, point.x - dragNode.offsetX))
      const y = Math.max(24, Math.min(HEIGHT - 24, point.y - dragNode.offsetY))
      setNodeOverrides((prev) => ({ ...prev, [dragNode.id]: { x, y } }))
      if (layoutMode === 'live') {
        const liveNode = liveNodesRef.current.get(dragNode.id)
        if (liveNode) {
          liveNode.fx = x
          liveNode.fy = y
          liveSimulationRef.current?.alphaTarget(Math.max(liveTuning.stability + 0.06, 0.05)).restart()
        }
      }
      return
    }

    if (!dragging || !lastPointer) return
    const dx = event.clientX - lastPointer.x
    const dy = event.clientY - lastPointer.y
    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
    setLastPointer({ x: event.clientX, y: event.clientY })
  }

  function endDrag() {
    setDragging(false)
    setLastPointer(null)
    if (layoutMode === 'live' && dragNode) {
      const liveNode = liveNodesRef.current.get(dragNode.id)
      if (liveNode) {
        liveNode.fx = null
        liveNode.fy = null
        liveSimulationRef.current?.alphaTarget(liveTuning.stability).restart()
      }
    }
    setDragNode(null)
  }

  function fitToScreen() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  function fitGraphToContent() {
    if (graph.nodes.length === 0) {
      fitToScreen()
      return
    }
    const margin = 42
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const node of graph.nodes) {
      const r = nodeRadius(node.count)
      minX = Math.min(minX, node.x - r)
      minY = Math.min(minY, node.y - r)
      maxX = Math.max(maxX, node.x + r)
      maxY = Math.max(maxY, node.y + r)
    }

    const contentWidth = Math.max(1, maxX - minX)
    const contentHeight = Math.max(1, maxY - minY)
    const scaleX = (WIDTH - margin * 2) / contentWidth
    const scaleY = (HEIGHT - margin * 2) / contentHeight
    const nextZoom = Math.max(0.45, Math.min(2.8, Math.min(scaleX, scaleY)))
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    setZoom(nextZoom)
    setPan({
      x: WIDTH / 2 - centerX * nextZoom,
      y: HEIGHT / 2 - centerY * nextZoom,
    })
  }

  function switchLayout(mode: ViewLayoutMode) {
    setLayoutMode(mode)
    setNodeOverrides({})
    setLivePositions({})
    setHasAutoFitted(false)
  }

  useEffect(() => {
    if (hasAutoFitted || graph.nodes.length === 0) return
    fitGraphToContent()
    setHasAutoFitted(true)
  }, [graph.nodes, hasAutoFitted])

  async function openPage(page: TagPage) {
    await chrome.tabs.create({ url: page.url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading tag constellation...</div>
  }

  if (graph.nodes.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No tags available for constellation view.</div>
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        {!hasRealTags && (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>Run Tags to populate this view.</span>
            {onRunTags && (
              <Button type="button" size="sm" variant="outline" onClick={() => void onRunTags()}>
                Run Tags
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={fitGraphToContent}>
            Fit graph
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={fitToScreen}>
            Reset view
          </Button>
          <Button
            type="button"
            size="sm"
            variant={layoutMode === 'live' ? 'default' : 'outline'}
            onClick={() => switchLayout('live')}
          >
            Live
          </Button>
          <Button
            type="button"
            size="sm"
            variant={layoutMode === 'radial' ? 'default' : 'outline'}
            onClick={() => switchLayout('radial')}
          >
            Radial
          </Button>
          <Button
            type="button"
            size="sm"
            variant={layoutMode === 'force' ? 'default' : 'outline'}
            onClick={() => switchLayout('force')}
          >
            Force
          </Button>
          <span className="text-xs text-muted-foreground">Zoom: {zoom.toFixed(2)}x</span>
        </div>
        {layoutMode === 'live' && (
          <div className="grid gap-2 rounded-md border border-border/70 bg-background/40 p-2 sm:grid-cols-3">
            <LiveSlider
              label="Elasticity"
              min={0.03}
              max={0.2}
              step={0.005}
              value={liveTuning.elasticity}
              onChange={(value) => setLiveTuning((prev) => ({ ...prev, elasticity: value }))}
            />
            <LiveSlider
              label="Repulsion"
              min={200}
              max={1600}
              step={20}
              value={liveTuning.repulsion}
              onChange={(value) => setLiveTuning((prev) => ({ ...prev, repulsion: value }))}
            />
            <LiveSlider
              label="Stability"
              min={0}
              max={0.12}
              step={0.005}
              value={liveTuning.stability}
              onChange={(value) => setLiveTuning((prev) => ({ ...prev, stability: value }))}
            />
          </div>
        )}

        <div className="relative overflow-hidden rounded-md border border-border bg-transparent">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[72vh] min-h-[620px] w-full cursor-grab"
            onWheel={handleWheel}
            onMouseDown={startDrag}
            onMouseMove={moveDrag}
            onMouseUp={endDrag}
            onMouseLeave={() => {
              endDrag()
              setHover(null)
              setHoverNodeId(null)
            }}
          >
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {graph.edges.map((edge) => {
                const sourceNode = graph.nodeById.get(edge.source)
                const targetNode = graph.nodeById.get(edge.target)
                if (!sourceNode || !targetNode) return null

                const connectedToHover = hoverNodeId
                  ? edge.source === hoverNodeId || edge.target === hoverNodeId
                  : false
                const opacity = hoverNodeId ? (connectedToHover ? 0.5 : 0.08) : 0.22
                const width = 1 + ((edge.weight - 1) / Math.max(1, maxEdgeWeight - 1)) * 4
                const sourceCount = sourceNode.count
                const targetCount = targetNode.count
                const colorKey = sourceCount >= targetCount ? sourceNode.tag : targetNode.tag

                return (
                  <g key={edge.id}>
                    <line
                      x1={sourceNode.x}
                      y1={sourceNode.y}
                      x2={targetNode.x}
                      y2={targetNode.y}
                      stroke={lightenColor(colorFromKey(colorKey), 18)}
                      strokeOpacity={opacity}
                      strokeWidth={width}
                    />
                    <line
                      x1={sourceNode.x}
                      y1={sourceNode.y}
                      x2={targetNode.x}
                      y2={targetNode.y}
                      stroke="transparent"
                      strokeWidth={12}
                      onMouseMove={(event) =>
                        setHover({
                          type: 'edge',
                          edge,
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                    />
                  </g>
                )
              })}

              {graph.nodes.map((node) => {
                const color = colorFromKey(node.tag)
                const dimmed = hoverNodeId ? hoverNodeId !== node.id : false
                const showLabel = node.count >= 3 || hoverNodeId === node.id
                return (
                  <g
                    key={node.id}
                    className="cursor-pointer"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const point = getGraphPoint(event, pan, zoom)
                      setDragNode({
                        id: node.id,
                        offsetX: point.x - node.x,
                        offsetY: point.y - node.y,
                      })
                    }}
                    onMouseMove={(event) => {
                      setHoverNodeId(node.id)
                      setHover({
                        type: 'node',
                        node,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }}
                    onMouseLeave={() => {
                      setHover(null)
                      setHoverNodeId(null)
                    }}
                    onClick={() => setSelectedTag(node.id)}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={nodeRadius(node.count)}
                      fill={color}
                      opacity={dimmed ? 0.25 : 0.9}
                      stroke={selectedTag === node.id ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
                      strokeWidth={selectedTag === node.id ? 3 : 1.5}
                    />
                    {showLabel && (
                      <text
                        x={node.x}
                        y={node.y - nodeRadius(node.count) - 5}
                        textAnchor="middle"
                        fill="hsl(var(--foreground))"
                        fontSize="11"
                        fontWeight="600"
                      >
                        {node.tag}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>

          {hover?.type === 'node' && (
            <div
              className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="font-medium text-foreground">#{hover.node.tag}</div>
              <div className="text-muted-foreground">{hover.node.count} pages</div>
            </div>
          )}

          {hover?.type === 'edge' && (
            <div
              className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="font-medium text-foreground">
                {hover.edge.weight} pages with both {hover.edge.source} and {hover.edge.target}
              </div>
              <div className="mt-1 text-muted-foreground">
                {hover.edge.pages.slice(0, 5).map((page) => page.title).join(' · ')}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card/30 p-3">
        <h3 className="text-sm font-semibold text-foreground">
          {selectedNode ? `#${selectedNode.tag}` : 'Select a tag'}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedNode ? `${selectedNode.pages.length} pages with this tag` : 'Click a node to inspect pages'}
        </p>

        <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto">
          {selectedNode?.pages.map((page) => (
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
          {selectedNode && selectedNode.pages.length === 0 && (
            <div className="text-xs text-muted-foreground">No pages for this tag.</div>
          )}
        </div>
      </aside>
    </section>
  )
}

function lightenColor(color: string, lift: number): string {
  const match = color.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/)
  if (!match) return color
  const hue = Number.parseInt(match[1], 10)
  const sat = Number.parseInt(match[2], 10)
  const light = Math.min(92, Number.parseInt(match[3], 10) + lift)
  return `hsl(${hue} ${sat}% ${light}%)`
}

function getGraphPoint(
  event: React.MouseEvent<SVGSVGElement> | React.MouseEvent<SVGGElement>,
  pan: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  const svg = event.currentTarget.closest('svg')
  if (!svg) {
    return { x: 0, y: 0 }
  }
  const rect = svg.getBoundingClientRect()
  const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH
  const svgY = ((event.clientY - rect.top) / rect.height) * HEIGHT
  return {
    x: (svgX - pan.x) / zoom,
    y: (svgY - pan.y) / zoom,
  }
}

function LiveSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span>{Number.isInteger(step) ? Math.round(value) : value.toFixed(3)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-primary"
      />
    </label>
  )
}

