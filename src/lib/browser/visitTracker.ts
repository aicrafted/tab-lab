import { openDB, STORES } from '@/lib/db/tab-lab-db'

interface VisitRow {
  url: string
  title: string
  visitTime: number
}

const PRUNE_DAYS = 90
const DAY_MS = 86_400_000

// Use the central openDB so the upgrade handler (which creates all stores) always runs
function openVisitsDB(): Promise<IDBDatabase> {
  return openDB()
}

export async function recordVisit(url: string, title: string): Promise<void> {
  try {
    const db = await openVisitsDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.VISITS, 'readwrite')
      const store = tx.objectStore(STORES.VISITS)
      const row: VisitRow = { url, title, visitTime: Date.now() }
      const req = store.add(row)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Non-critical — silently drop failed visit records
  }
}

export interface VisitStats {
  lastVisitTime: number
  visitCount: number
}

/** Single DB scan — use this instead of per-URL getLastVisit/getVisitCount for bulk enrichment. */
export async function getAllVisitStats(): Promise<Map<string, VisitStats>> {
  const db = await openVisitsDB()
  const rows = await new Promise<VisitRow[]>((resolve, reject) => {
    const tx = db.transaction(STORES.VISITS, 'readonly')
    const req = tx.objectStore(STORES.VISITS).getAll()
    req.onsuccess = () => resolve(req.result as VisitRow[])
    req.onerror = () => reject(req.error)
  })
  const map = new Map<string, VisitStats>()
  for (const row of rows) {
    const existing = map.get(row.url)
    if (existing) {
      existing.visitCount += 1
      if (row.visitTime > existing.lastVisitTime) existing.lastVisitTime = row.visitTime
    } else {
      map.set(row.url, { lastVisitTime: row.visitTime, visitCount: 1 })
    }
  }
  return map
}

export async function getLastVisit(url: string): Promise<number | undefined> {
  const db = await openVisitsDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.VISITS, 'readonly')
    const index = tx.objectStore(STORES.VISITS).index('by-url')
    const req = index.getAll(IDBKeyRange.only(url))
    req.onsuccess = () => {
      const rows = req.result as VisitRow[]
      if (rows.length === 0) { resolve(undefined); return }
      resolve(Math.max(...rows.map(r => r.visitTime)))
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getVisitCount(url: string): Promise<number> {
  const db = await openVisitsDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.VISITS, 'readonly')
    const index = tx.objectStore(STORES.VISITS).index('by-url')
    const req = index.count(IDBKeyRange.only(url))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface RecentVisitItem {
  url: string
  title: string
  lastVisitTime: number
  visitCount: number
}

export async function getRecentVisits(options: {
  startTime: number
  maxResults: number
}): Promise<RecentVisitItem[]> {
  const db = await openVisitsDB()
  const rows = await new Promise<VisitRow[]>((resolve, reject) => {
    const tx = db.transaction(STORES.VISITS, 'readonly')
    const index = tx.objectStore(STORES.VISITS).index('by-visitTime')
    const req = index.getAll(IDBKeyRange.lowerBound(options.startTime))
    req.onsuccess = () => resolve(req.result as VisitRow[])
    req.onerror = () => reject(req.error)
  })

  // Group by URL — deduplicate, track last visit + count
  const byUrl = new Map<string, RecentVisitItem>()
  for (const row of rows) {
    const existing = byUrl.get(row.url)
    if (existing) {
      existing.visitCount += 1
      if (row.visitTime > existing.lastVisitTime) {
        existing.lastVisitTime = row.visitTime
        existing.title = row.title
      }
    } else {
      byUrl.set(row.url, { url: row.url, title: row.title, lastVisitTime: row.visitTime, visitCount: 1 })
    }
  }

  return Array.from(byUrl.values())
    .sort((a, b) => b.lastVisitTime - a.lastVisitTime)
    .slice(0, options.maxResults)
}

export async function pruneOldVisits(): Promise<void> {
  try {
    const db = await openVisitsDB()
    const cutoff = Date.now() - PRUNE_DAYS * DAY_MS
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.VISITS, 'readwrite')
      const index = tx.objectStore(STORES.VISITS).index('by-visitTime')
      const req = index.openCursor(IDBKeyRange.upperBound(cutoff))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) { resolve(); return }
        cursor.delete()
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Non-critical
  }
}
