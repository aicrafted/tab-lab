interface LayoutPoint {
  x: number
  y: number
}

interface LayoutNode {
  id: string
}

interface LayoutEdge {
  source: string
  target: string
  weight: number
}

const layoutCache = new Map<string, Map<string, LayoutPoint>>()

function hashString(input: string): number {
  let hash = 0
  for (const char of input) {
    hash = (hash * 33 + char.charCodeAt(0)) | 0
  }
  return Math.abs(hash)
}

function runForceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  width: number,
  height: number,
): Map<string, LayoutPoint> {
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>()

  for (const node of nodes) {
    const hash = hashString(node.id)
    const angle = (hash % 360) * (Math.PI / 180)
    const radius = 100 + (hash % 180)
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    })
  }

  const repulsion = 7600
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

  const result = new Map<string, LayoutPoint>()
  for (const node of nodes) {
    const pos = positions.get(node.id)
    if (!pos) continue
    result.set(node.id, { x: pos.x, y: pos.y })
  }

  return result
}

function buildLayoutKey(nodes: LayoutNode[], edges: LayoutEdge[]): string {
  const nodePart = nodes.map((node) => node.id).join('|')
  const edgePart = edges.map((edge) => `${edge.source}>${edge.target}:${edge.weight}`).join('|')
  return `${nodePart}::${edgePart}`
}

export function getTagConstellationLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  width: number,
  height: number,
): Map<string, LayoutPoint> {
  const key = buildLayoutKey(nodes, edges)
  const cached = layoutCache.get(key)
  if (cached) {
    console.info('[TagConstellation] layout cache hit', { nodes: nodes.length, edges: edges.length })
    return cached
  }

  const startedAt = performance.now()
  const computed = runForceLayout(nodes, edges, width, height)
  console.info('[TagConstellation] layout computed', {
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
