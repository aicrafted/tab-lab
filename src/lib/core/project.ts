import { UMAP } from 'umap-js'

export interface Point2D {
  url: string
  x: number    // [0, 1] after normalisation
  y: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Simple seeded random (LCG) to keep UMAP stable. */
function makeRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 48271) % 2147483647
    return (s - 1) / 2147483646
  }
}

/**
 * Symmetric log transform: preserves sign, compresses magnitude.
 * log(1 + |v|) keeps nearby points separated while pulling outliers inward.
 * No hard clamping — outliers stay visible but don't dominate the bounding box.
 */
function logScale(v: number): number {
  return Math.sign(v) * Math.log1p(Math.abs(v))
}

export interface UmapParams {
  nNeighbors?: number
  minDist?: number
  spread?: number
}

/**
 * Project N-dimensional embeddings to 2D via UMAP.
 * Returns normalised [0,1] coordinates sorted to match input order.
 * Requires at least 4 items (UMAP constraint: nNeighbors < n).
 */
export function projectTo2D(
  items: { url: string; embedding: number[] }[],
  params?: UmapParams,
): Point2D[] {
  if (items.length < 4) {
    return items.map((item, i) => ({
      url: item.url,
      x: (i + 0.5) / items.length,
      y: 0.5,
    }))
  }

  const n = items.length
  const nNeighbors = params?.nNeighbors ?? Math.min(clamp(Math.floor(n * 0.05), 10, 50), n - 1)
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(nNeighbors, n - 1),
    minDist: params?.minDist ?? 0.25,
    spread: params?.spread ?? 1.5,
    random: makeRandom(42), // Fixed seed for stability
  })
  const raw = umap.fit(items.map(i => i.embedding))

  // Log-scale raw UMAP coords: compresses outlier distances without hard clamping.
  // Outliers remain visible at edges but no longer dominate the bounding box.
  const xs = raw.map(p => logScale(p[0]))
  const ys = raw.map(p => logScale(p[1]))

  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const xRange = xMax - xMin || 1
  const yRange = yMax - yMin || 1

  return items.map((item, i) => ({
    url: item.url,
    x: (xs[i] - xMin) / xRange,
    y: (ys[i] - yMin) / yRange,
  }))
}
