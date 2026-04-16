import { runDeterministicForceLayout, runDeterministicRadialForceLayout } from '@/lib/ui/force-layout'

interface LayoutPoint {
  x: number
  y: number
}

interface LayoutNode {
  id: string
  count?: number
}

interface LayoutEdge {
  source: string
  target: string
  weight: number
}

export type TagConstellationLayoutMode = 'radial' | 'force'

const layoutCache = new Map<string, Map<string, LayoutPoint>>()

function buildLayoutKey(nodes: LayoutNode[], edges: LayoutEdge[], mode: TagConstellationLayoutMode): string {
  const nodePart = nodes.map((node) => node.id).join('|')
  const edgePart = edges.map((edge) => `${edge.source}>${edge.target}:${edge.weight}`).join('|')
  return `${mode}::${nodePart}::${edgePart}`
}

export function getTagConstellationLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  width: number,
  height: number,
  mode: TagConstellationLayoutMode = 'radial',
): Map<string, LayoutPoint> {
  const key = buildLayoutKey(nodes, edges, mode)
  const cached = layoutCache.get(key)
  if (cached) {
    console.info('[TagConstellation] layout cache hit', { nodes: nodes.length, edges: edges.length })
    return cached
  }

  const maxCount = Math.max(1, ...nodes.map((node) => node.count ?? 1))
  const radialMax = Math.max(120, Math.min(width, height) / 2 - 38)
  const layoutNodes = nodes.map((node) => {
    const count = node.count ?? 1
    const importance = count / maxCount
    return {
      id: node.id,
      radius: 10 + (count / maxCount) * 16,
      radialTarget: 60 + (1 - importance) * radialMax,
    }
  })

  const startedAt = performance.now()
  const computed =
    mode === 'radial'
      ? runDeterministicRadialForceLayout(layoutNodes, edges, {
          width,
          height,
          iterations: 420,
          repulsionStrength: -1150,
          linkDistance: 120,
          linkStrength: 0.06,
          collisionRadius: 20,
        })
      : runDeterministicForceLayout(layoutNodes, edges, {
          width,
          height,
          iterations: 400,
          repulsionStrength: -1800,
          linkDistance: 155,
          linkStrength: 0.06,
          collisionRadius: 20,
        })
  console.info('[TagConstellation] layout computed', {
    mode,
    nodes: nodes.length,
    edges: edges.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  })

  layoutCache.set(key, computed)
  if (layoutCache.size > 20) {
    const oldest = layoutCache.keys().next().value
    if (oldest) layoutCache.delete(oldest)
  }

  return computed
}
