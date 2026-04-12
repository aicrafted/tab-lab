import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { colorFromKey } from '@/components/views/stubs'
import { runDeterministicForceLayout } from '@/lib/force-layout'

type SourceMode = 'bookmarks' | 'tabs' | 'both'
type DomainLayoutMode = 'live' | 'static'

interface DomainPage {
  id: string
  title: string
  url: string
  domain: string
  category?: string
  visitCount: number
}

interface GraphNode {
  id: string
  domain: string
  visitCount: number
  colorKey: string
  pages: DomainPage[]
  x: number
  y: number
}

interface GraphEdge {
  id: string
  source: string
  target: string
  weight: number
}

interface HoverNode {
  type: 'node'
  node: GraphNode
  x: number
  y: number
}

interface HoverEdge {
  type: 'edge'
  edge: GraphEdge
  x: number
  y: number
}

interface LiveDomainNode extends SimulationNodeDatum {
  id: string
  visitCount: number
}

interface LiveDomainEdge extends SimulationLinkDatum<LiveDomainNode> {
  source: string | LiveDomainNode
  target: string | LiveDomainNode
  weight: number
}

type HoverState = HoverNode | HoverEdge

const WIDTH = 980
const HEIGHT = 620
const GRAPH_PADDING = 26
const DOMAIN_LIVE_DEFAULTS = {
  elasticity: 0.09,
  repulsion: 640,
  stability: 0.03,
}

export function DomainGraphView({ bookmarks, tabs, loading }: ViewProps) {
  const [source, setSource] = useState<SourceMode>('both')
  const [layoutMode, setLayoutMode] = useState<DomainLayoutMode>('live')
  const [liveTuning, setLiveTuning] = useState(DOMAIN_LIVE_DEFAULTS)
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(null)
  const [nodeOverrides, setNodeOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [dragNode, setDragNode] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const [livePositions, setLivePositions] = useState<Record<string, { x: number; y: number }>>({})
  const [hasAutoFitted, setHasAutoFitted] = useState(false)
  const nodeOverridesRef = useRef<Record<string, { x: number; y: number }>>({})
  const liveSimulationRef = useRef<Simulation<LiveDomainNode, LiveDomainEdge> | null>(null)
  const liveNodesRef = useRef<Map<string, LiveDomainNode>>(new Map())

  useEffect(() => {
    nodeOverridesRef.current = nodeOverrides
  }, [nodeOverrides])

  const graphBase = useMemo(() => {
    const pages: DomainPage[] = []

    if (source === 'bookmarks' || source === 'both') {
      for (const bookmark of bookmarks) {
        pages.push({
          id: `bm-${bookmark.id}`,
          title: bookmark.title || bookmark.url,
          url: bookmark.url,
          domain: bookmark.domain,
          category: bookmark.category,
          visitCount: bookmark.visitCount ?? 1,
        })
      }
    }

    if (source === 'tabs' || source === 'both') {
      for (const tab of tabs) {
        pages.push({
          id: `tab-${tab.id}`,
          title: tab.title || tab.url,
          url: tab.url,
          domain: tab.domain,
          category: tab.category,
          visitCount: tab.visitCount ?? 1,
        })
      }
    }

    const byDomain = new Map<string, DomainPage[]>()
    for (const page of pages) {
      byDomain.set(page.domain, [...(byDomain.get(page.domain) ?? []), page])
    }

    const nodesBase = Array.from(byDomain.entries()).map(([domain, domainPages]) => {
      const categoryCounts = new Map<string, number>()
      for (const page of domainPages) {
        const key = page.category?.trim() || 'uncategorized'
        categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
      }
      const majorityCategory =
        Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? domain

      return {
        id: domain,
        domain,
        visitCount: domainPages.reduce((sum, page) => sum + page.visitCount, 0),
        colorKey: majorityCategory,
        pages: domainPages.sort((a, b) => b.visitCount - a.visitCount),
      }
    })
    const maxDomainVisits = Math.max(1, ...nodesBase.map((node) => node.visitCount))

    const edgeWeight = new Map<string, number>()
    if (source === 'tabs' || source === 'both') {
      const domainsByWindow = new Map<number, string[]>()
      for (const tab of tabs) {
        if (source === 'tabs' || byDomain.has(tab.domain)) {
          domainsByWindow.set(tab.windowId, [...(domainsByWindow.get(tab.windowId) ?? []), tab.domain])
        }
      }
      for (const domains of domainsByWindow.values()) {
        const unique = Array.from(new Set(domains)).filter((domain) => byDomain.has(domain))
        for (let i = 0; i < unique.length; i += 1) {
          for (let j = i + 1; j < unique.length; j += 1) {
            const a = unique[i]
            const b = unique[j]
            const key = a < b ? `${a}||${b}` : `${b}||${a}`
            edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1)
          }
        }
      }
    }

    const edgesBase: GraphEdge[] = Array.from(edgeWeight.entries()).map(([key, weight]) => {
      const [sourceDomain, targetDomain] = key.split('||')
      return {
        id: key,
        source: sourceDomain,
        target: targetDomain,
        weight,
      }
    })

    const layoutNodes = nodesBase.map((node) => ({
      id: node.id,
      radius: 12 + (node.visitCount / maxDomainVisits) * 18,
    }))

    const layout =
      edgesBase.length === 0
        ? buildSunflowerLayout(layoutNodes, WIDTH, HEIGHT, GRAPH_PADDING)
        : runDeterministicForceLayout(layoutNodes, edgesBase, {
            width: WIDTH,
            height: HEIGHT,
            iterations: 300,
            repulsionStrength: getAdaptiveRepulsion(layoutNodes.length, edgesBase.length),
            linkDistance: 145,
            linkStrength: 0.075,
            collisionRadius: 16,
            padding: GRAPH_PADDING,
          })
    const nodes: GraphNode[] = nodesBase.map((node) => ({
      ...node,
      x: layout.get(node.id)?.x ?? WIDTH / 2,
      y: layout.get(node.id)?.y ?? HEIGHT / 2,
    }))

    return { nodes, edges: edgesBase }
  }, [bookmarks, tabs, source])

  const graph = useMemo(() => {
    const nodes = graphBase.nodes.map((node) => {
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

  const maxVisits = useMemo(
    () => graph.nodes.reduce((max, node) => Math.max(max, node.visitCount), 1),
    [graph.nodes],
  )

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

    const nodes: LiveDomainNode[] = sourceNodes.map((node) => ({
      id: node.id,
      visitCount: node.visitCount,
      x: nodeOverridesRef.current[node.id]?.x ?? node.x,
      y: nodeOverridesRef.current[node.id]?.y ?? node.y,
    }))
    const edges: LiveDomainEdge[] = sourceEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    }))

    const simulation = forceSimulation(nodes)
      .force('charge', forceManyBody<LiveDomainNode>().strength(-liveTuning.repulsion))
      .force(
        'link',
        forceLink<LiveDomainNode, LiveDomainEdge>(edges)
          .id((node) => node.id)
          .distance((edge) => Math.max(50, 130 - Math.min(70, edge.weight * 6)))
          .strength((edge) => liveTuning.elasticity * Math.max(0.5, Math.min(1.6, edge.weight))),
      )
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force(
        'collision',
        forceCollide<LiveDomainNode>().radius((node) => {
          const radius = 8 + (node.visitCount / maxVisits) * 20
          return radius + 5
        }),
      )
      .alpha(0.9)
      .alphaTarget(liveTuning.stability)

    let raf = 0
    simulation.on('tick', () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        const next: Record<string, { x: number; y: number }> = {}
        for (const node of nodes) {
          next[node.id] = {
            x: Math.max(GRAPH_PADDING, Math.min(WIDTH - GRAPH_PADDING, node.x ?? WIDTH / 2)),
            y: Math.max(GRAPH_PADDING, Math.min(HEIGHT - GRAPH_PADDING, node.y ?? HEIGHT / 2)),
          }
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
  }, [layoutMode, graphBase, maxVisits, liveTuning])

  const selectedNode = selectedDomain ? graph.nodes.find((node) => node.domain === selectedDomain) ?? null : null
  const maxEdgeWeight = useMemo(
    () => graph.edges.reduce((max, edge) => Math.max(max, edge.weight), 1),
    [graph.edges],
  )

  async function openPage(url: string) {
    await chrome.tabs.create({ url })
  }

  function nodeRadius(visitCount: number): number {
    return 8 + (visitCount / maxVisits) * 20
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
      const r = nodeRadius(node.visitCount)
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
      const x = Math.max(GRAPH_PADDING, Math.min(WIDTH - GRAPH_PADDING, point.x - dragNode.offsetX))
      const y = Math.max(GRAPH_PADDING, Math.min(HEIGHT - GRAPH_PADDING, point.y - dragNode.offsetY))
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

  function switchLayout(mode: DomainLayoutMode) {
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

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading domain graph...</div>
  }

  if (graph.nodes.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No domains to render.</div>
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={source === 'bookmarks' ? 'default' : 'outline'} onClick={() => setSource('bookmarks')}>
            Bookmarks
          </Button>
          <Button type="button" size="sm" variant={source === 'tabs' ? 'default' : 'outline'} onClick={() => setSource('tabs')}>
            Tabs
          </Button>
          <Button type="button" size="sm" variant={source === 'both' ? 'default' : 'outline'} onClick={() => setSource('both')}>
            Both
          </Button>
          <Button type="button" size="sm" variant={layoutMode === 'live' ? 'default' : 'outline'} onClick={() => switchLayout('live')}>
            Live
          </Button>
          <Button type="button" size="sm" variant={layoutMode === 'static' ? 'default' : 'outline'} onClick={() => switchLayout('static')}>
            Static
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={fitGraphToContent}>
            Fit graph
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={fitToScreen}>
            Reset view
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
            }}
          >
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {graph.edges.map((edge) => {
                const sourceNode = graph.nodeById.get(edge.source)
                const targetNode = graph.nodeById.get(edge.target)
                if (!sourceNode || !targetNode) return null
                const width = 0.5 + (edge.weight / maxEdgeWeight) * 1.5
                return (
                  <g key={edge.id}>
                    <line
                      x1={sourceNode.x}
                      y1={sourceNode.y}
                      x2={targetNode.x}
                      y2={targetNode.y}
                      stroke="hsl(var(--muted-foreground))"
                      strokeOpacity={0.2}
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

              {graph.nodes.map((node) => (
                <g
                  key={node.id}
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
                  onMouseMove={(event) =>
                    setHover({
                      type: 'node',
                      node,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setSelectedDomain(node.domain)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={nodeRadius(node.visitCount)}
                    fill={colorFromKey(node.colorKey)}
                    opacity={0.85}
                    stroke={selectedDomain === node.domain ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
                    strokeWidth={selectedDomain === node.domain ? 3 : 1.5}
                  />
                  <text x={node.x} y={node.y + 4} textAnchor="middle" fill="white" fontSize="10" fontWeight="600">
                    {shorten(node.domain, 12)}
                  </text>
                </g>
              ))}
            </g>
          </svg>

          {hover?.type === 'node' && (
            <div
              className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="font-medium text-foreground">{hover.node.domain}</div>
              <div className="text-muted-foreground">{hover.node.visitCount} visits</div>
              <div className="mt-1 text-muted-foreground">
                {hover.node.pages.slice(0, 3).map((page) => page.title).join(' · ')}
              </div>
            </div>
          )}

          {hover?.type === 'edge' && (
            <div
              className="pointer-events-none fixed z-50 rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="font-medium text-foreground">Connection strength</div>
              <div className="text-muted-foreground">{hover.edge.weight} shared sessions</div>
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card/30 p-3">
        <h3 className="text-sm font-semibold text-foreground">{selectedNode ? selectedNode.domain : 'Select domain'}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedNode ? `${selectedNode.visitCount} visits` : 'Click a node to inspect pages'}
        </p>

        <div className="mt-3 max-h-[500px] space-y-2 overflow-y-auto">
          {selectedNode?.pages.map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => void openPage(page.url)}
              className="w-full rounded-md border border-border bg-background/60 p-2 text-left hover:bg-background"
            >
              <div className="flex items-start gap-2">
                <Favicon domain={page.domain} />
                <div className="min-w-0">
                  <div className="line-clamp-2 text-xs font-medium text-foreground">{page.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{page.url}</div>
                </div>
              </div>
            </button>
          ))}
          {selectedNode && selectedNode.pages.length === 0 && (
            <div className="text-xs text-muted-foreground">No pages for this domain.</div>
          )}
        </div>
      </aside>
    </section>
  )
}

function shorten(input: string, max: number): string {
  if (input.length <= max) return input
  if (max < 4) return input.slice(0, max)
  return `${input.slice(0, max - 3)}...`
}

function getAdaptiveRepulsion(nodeCount: number, edgeCount: number): number {
  const density = edgeCount / Math.max(1, nodeCount)
  if (density < 0.35) return -480
  if (density < 0.8) return -720
  return -980
}

function buildSunflowerLayout(
  nodes: Array<{ id: string; radius?: number }>,
  width: number,
  height: number,
  padding: number,
): Map<string, { x: number; y: number }> {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  const result = new Map<string, { x: number; y: number }>()
  if (sorted.length === 0) return result
  const centerX = width / 2
  const centerY = height / 2
  const maxRadius = Math.max(60, Math.min(width, height) / 2 - padding - 18)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const step = maxRadius / Math.sqrt(sorted.length + 1)

  for (let i = 0; i < sorted.length; i += 1) {
    const node = sorted[i]
    const r = step * Math.sqrt(i + 1)
    const a = i * goldenAngle
    const x = Math.max(padding, Math.min(width - padding, centerX + Math.cos(a) * r))
    const y = Math.max(padding, Math.min(height - padding, centerY + Math.sin(a) * r))
    result.set(node.id, { x, y })
  }
  return result
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
