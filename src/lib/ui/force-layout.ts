import type { SimulationLinkDatum } from 'd3-force'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation } from 'd3-force'

interface LayoutPoint {
  x: number
  y: number
}

interface LayoutNode {
  id: string
  radius?: number
  radialTarget?: number
}

interface LayoutEdge {
  source: string
  target: string
  weight?: number
}

interface ForceLayoutOptions {
  width: number
  height: number
  iterations?: number
  padding?: number
  repulsionStrength?: number
  linkDistance?: number
  linkStrength?: number
  collisionRadius?: number
}

interface SimNode extends LayoutNode {
  x: number
  y: number
  vx?: number
  vy?: number
}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: string
  target: string
  weight?: number
}

function hashString(input: string): number {
  let hash = 0
  for (const char of input) {
    hash = (hash * 33 + char.charCodeAt(0)) | 0
  }
  return Math.abs(hash)
}

export function runDeterministicForceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: ForceLayoutOptions,
): Map<string, LayoutPoint> {
  const {
    width,
    height,
    iterations = 260,
    padding = 24,
    repulsionStrength = -1100,
    linkDistance = 120,
    linkStrength = 0.06,
    collisionRadius = 14,
  } = options

  if (nodes.length === 0) return new Map<string, LayoutPoint>()

  const simNodes: SimNode[] = nodes.map((node) => {
    const hash = hashString(node.id)
    const angle = (hash % 360) * (Math.PI / 180)
    const radius = 100 + (hash % 180)
    return {
      id: node.id,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
    }
  })

  const simEdges: SimEdge[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
  }))

  const simulation = forceSimulation(simNodes)
    .force('charge', forceManyBody<SimNode>().strength(repulsionStrength))
    .force('center', forceCenter(width / 2, height / 2))
    .force(
      'link',
      forceLink<SimNode, SimEdge>(simEdges)
        .id((node: SimNode) => node.id)
        .distance((edge: SimEdge) => Math.max(50, linkDistance - Math.min(80, (edge.weight ?? 1) * 6)))
        .strength((edge: SimEdge) => linkStrength * Math.max(0.4, Math.min(1.8, edge.weight ?? 1))),
    )
    .force(
      'collision',
      forceCollide<SimNode>().radius((node) => Math.max(collisionRadius, node.radius ?? collisionRadius)),
    )
    .alpha(1)
    .alphaDecay(1 - Math.pow(0.001, 1 / iterations))
    .stop()

  for (let i = 0; i < iterations; i += 1) {
    simulation.tick()
  }

  const result = new Map<string, LayoutPoint>()
  for (const node of simNodes) {
    result.set(node.id, {
      x: Math.max(padding, Math.min(width - padding, node.x)),
      y: Math.max(padding, Math.min(height - padding, node.y)),
    })
  }
  return result
}

export function runDeterministicRadialForceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: ForceLayoutOptions,
): Map<string, LayoutPoint> {
  const {
    width,
    height,
    iterations = 260,
    padding = 24,
    repulsionStrength = -900,
    linkDistance = 120,
    linkStrength = 0.05,
    collisionRadius = 14,
  } = options

  if (nodes.length === 0) return new Map<string, LayoutPoint>()

  const baseRadius = Math.max(80, Math.min(width, height) * 0.34)
  const simNodes: SimNode[] = nodes.map((node) => {
    const hash = hashString(node.id)
    const angle = (hash % 360) * (Math.PI / 180)
    const seedRadius = 30 + (hash % 180)
    return {
      id: node.id,
      radius: node.radius,
      radialTarget: node.radialTarget ?? baseRadius,
      x: width / 2 + Math.cos(angle) * seedRadius,
      y: height / 2 + Math.sin(angle) * seedRadius,
    }
  })

  const simEdges: SimEdge[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
  }))

  const simulation = forceSimulation(simNodes)
    .force('charge', forceManyBody<SimNode>().strength(repulsionStrength))
    .force(
      'radial',
      forceRadial<SimNode>(
        (node: SimNode) => node.radialTarget ?? baseRadius,
        width / 2,
        height / 2,
      ).strength(0.23),
    )
    .force(
      'link',
      forceLink<SimNode, SimEdge>(simEdges)
        .id((node: SimNode) => node.id)
        .distance((edge: SimEdge) => Math.max(40, linkDistance - Math.min(75, (edge.weight ?? 1) * 5)))
        .strength((edge: SimEdge) => linkStrength * Math.max(0.5, Math.min(1.7, edge.weight ?? 1))),
    )
    .force(
      'collision',
      forceCollide<SimNode>().radius((node) => Math.max(collisionRadius, node.radius ?? collisionRadius)),
    )
    .force('center', forceCenter(width / 2, height / 2))
    .alpha(1)
    .alphaDecay(1 - Math.pow(0.001, 1 / iterations))
    .stop()

  for (let i = 0; i < iterations; i += 1) {
    simulation.tick()
  }

  const result = new Map<string, LayoutPoint>()
  for (const node of simNodes) {
    result.set(node.id, {
      x: Math.max(padding, Math.min(width - padding, node.x)),
      y: Math.max(padding, Math.min(height - padding, node.y)),
    })
  }
  return result
}
