import { cosineSimilarity } from './embedder'

export interface ClusterResult {
  clusterId: number
  centroid: number[]
  members: string[]
  representatives: string[]
}

interface VectorItem {
  url: string
  embedding: number[]
}

function distanceFromCentroid(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b)
}

function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const dims = vectors[0].length
  const out = new Array<number>(dims).fill(0)
  for (const vector of vectors) {
    for (let i = 0; i < dims; i += 1) out[i] += vector[i]
  }
  for (let i = 0; i < dims; i += 1) out[i] /= vectors.length
  return out
}

function kMeansPlusPlusInit(items: VectorItem[], k: number): number[][] {
  const centroids: number[][] = []
  centroids.push(items[Math.floor(Math.random() * items.length)].embedding.slice())

  while (centroids.length < k) {
    const distances = items.map((item) => {
      let best = Infinity
      for (const centroid of centroids) {
        const d = distanceFromCentroid(item.embedding, centroid)
        if (d < best) best = d
      }
      return best ** 2
    })
    const total = distances.reduce((sum, d) => sum + d, 0)
    if (total <= 0) {
      centroids.push(items[Math.floor(Math.random() * items.length)].embedding.slice())
      continue
    }
    let threshold = Math.random() * total
    let pick = 0
    for (let i = 0; i < distances.length; i += 1) {
      threshold -= distances[i]
      if (threshold <= 0) {
        pick = i
        break
      }
    }
    centroids.push(items[pick].embedding.slice())
  }

  return centroids
}

export function kMeans(
  items: VectorItem[],
  k: number,
  maxIter = 20,
): ClusterResult[] {
  if (items.length === 0) return []
  const actualK = Math.max(1, Math.min(k, items.length))
  let centroids = kMeansPlusPlusInit(items, actualK)
  let assignments = new Array<number>(items.length).fill(-1)

  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false

    for (let i = 0; i < items.length; i += 1) {
      let bestCluster = 0
      let bestDistance = Infinity
      for (let c = 0; c < centroids.length; c += 1) {
        const d = distanceFromCentroid(items[i].embedding, centroids[c])
        if (d < bestDistance) {
          bestDistance = d
          bestCluster = c
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster
        changed = true
      }
    }

    const buckets: number[][][] = Array.from({ length: centroids.length }, () => [])
    for (let i = 0; i < items.length; i += 1) {
      buckets[assignments[i]].push(items[i].embedding)
    }
    const nextCentroids = centroids.map((centroid, idx) => (
      buckets[idx].length > 0 ? meanVector(buckets[idx]) : centroid
    ))
    centroids = nextCentroids

    if (!changed) break
  }

  const clusters: ClusterResult[] = []
  for (let c = 0; c < centroids.length; c += 1) {
    const memberItems = items.filter((_, idx) => assignments[idx] === c)
    if (memberItems.length === 0) continue
    const centroid = centroids[c]
    const representatives = [...memberItems]
      .sort((a, b) => (
        distanceFromCentroid(a.embedding, centroid) - distanceFromCentroid(b.embedding, centroid)
      ))
      .slice(0, Math.min(3, memberItems.length))
      .map((item) => item.url)

    clusters.push({
      clusterId: clusters.length,
      centroid,
      members: memberItems.map((item) => item.url),
      representatives,
    })
  }

  return clusters
}
