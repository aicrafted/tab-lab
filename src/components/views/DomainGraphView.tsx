import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { colorFromKey } from '@/components/views/stubs'

type SourceMode = 'bookmarks' | 'tabs' | 'both'

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

type HoverState = HoverNode | HoverEdge

const WIDTH = 980
const HEIGHT = 620

export function DomainGraphView({ bookmarks, tabs, loading }: ViewProps) {
  const [source, setSource] = useState<SourceMode>('both')
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(null)

  const graph = useMemo(() => {
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

    const layout = runForceLayout(nodesBase, edgesBase, WIDTH, HEIGHT)
    const nodes: GraphNode[] = nodesBase.map((node) => ({
      ...node,
      x: layout.get(node.id)?.x ?? WIDTH / 2,
      y: layout.get(node.id)?.y ?? HEIGHT / 2,
    }))

    return { nodes, edges: edgesBase }
  }, [bookmarks, tabs, source])

  const selectedNode = selectedDomain ? graph.nodes.find((node) => node.domain === selectedDomain) ?? null : null
  const maxVisits = useMemo(
    () => graph.nodes.reduce((max, node) => Math.max(max, node.visitCount), 1),
    [graph.nodes],
  )
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
          <Button type="button" size="sm" variant="outline" onClick={fitToScreen}>
            Fit to screen
          </Button>
          <span className="text-xs text-muted-foreground">Zoom: {zoom.toFixed(2)}x</span>
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
              {graph.edges.map((edge) => {
                const sourceNode = graph.nodes.find((node) => node.id === edge.source)
                const targetNode = graph.nodes.find((node) => node.id === edge.target)
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

function hashString(input: string): number {
  let hash = 0
  for (const char of input) {
    hash = (hash * 33 + char.charCodeAt(0)) | 0
  }
  return Math.abs(hash)
}

function runForceLayout(
  nodes: Array<{ id: string }>,
  edges: GraphEdge[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>()

  for (const node of nodes) {
    const hash = hashString(node.id)
    const angle = (hash % 360) * (Math.PI / 180)
    const radius = 120 + (hash % 180)
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    })
  }

  const repulsion = 9000
  const springLength = 120
  const springStrength = 0.002
  const centering = 0.001
  const damping = 0.9

  for (let step = 0; step < 260; step += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = positions.get(nodes[i].id)
        const b = positions.get(nodes[j].id)
        if (!a || !b) continue
        const dx = a.x - b.x
        const dy = a.y - b.y
        const distSq = dx * dx + dy * dy + 0.01
        const dist = Math.sqrt(distSq)
        const force = repulsion / distSq
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    for (const edge of edges) {
      const a = positions.get(edge.source)
      const b = positions.get(edge.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const stretch = dist - springLength
      const force = stretch * springStrength * Math.max(1, edge.weight)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    for (const node of nodes) {
      const pos = positions.get(node.id)
      if (!pos) continue
      pos.vx += (width / 2 - pos.x) * centering
      pos.vy += (height / 2 - pos.y) * centering
      pos.vx *= damping
      pos.vy *= damping
      pos.x = Math.max(24, Math.min(width - 24, pos.x + pos.vx))
      pos.y = Math.max(24, Math.min(height - 24, pos.y + pos.vy))
    }
  }

  const result = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const pos = positions.get(node.id)
    if (!pos) continue
    result.set(node.id, { x: pos.x, y: pos.y })
  }
  return result
}

