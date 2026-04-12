import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { colorFromKey, getStubIntent } from '@/components/views/stubs'
import { getTagConstellationLayout } from '@/lib/tag-constellation-layout'

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

const WIDTH = 980
const HEIGHT = 620

export function TagConstellationView({ bookmarks, tabs, loading, onRunTags }: ViewProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(null)

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

  const graph = useMemo(() => {
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

    const layout = getTagConstellationLayout(nodesBase, edgesBase, WIDTH, HEIGHT)
    const nodes: TagNode[] = nodesBase.map((node) => ({
      ...node,
      x: layout.get(node.id)?.x ?? WIDTH / 2,
      y: layout.get(node.id)?.y ?? HEIGHT / 2,
    }))

    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    return { nodes, edges: edgesBase, nodeById }
  }, [effectivePages])

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
              setHoverNodeId(null)
            }}
          >
            <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="hsl(var(--background))" />
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

