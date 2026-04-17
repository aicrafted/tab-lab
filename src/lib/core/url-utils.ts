export function normalizeUrlForCache(url: string): string {
  try {
    const parsed = new URL(url)
    // DO NOT strip search/query — query params carry content identity on many sites
    parsed.hash = ''          // strip fragment — always client-side only
    return parsed.toString()
  } catch {
    return url
  }
}

/** 
 * Returns a key that identifies the same content across slight URL variations 
 * (different tracking params, notification counts in tab titles, etc)
 */
export function titleDedupeKey(url: string, title: string): string {
  try {
    const parsed = new URL(url)
    // base key: domain + path (ignore query params that cause near-duplicates)
    const path = parsed.hostname + parsed.pathname
    // strip leading "(N) " notification counts from tab titles (common on chat apps)
    const normalTitle = title.replace(/^\(\d+\)\s*/, '').trim().toLowerCase()
    return `${path}|${normalTitle}`
  } catch {
    return title.trim().toLowerCase()
  }
}
