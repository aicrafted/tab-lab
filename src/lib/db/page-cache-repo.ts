import { openDB, STORES } from './tab-lab-db'
import type { PageIntent } from '../core/types'

export interface PageCacheRow {
  key: string // prefix:url
  category?: string
  parentCategory?: string
  clusterId?: number
  tags?: string[]
  intent?: PageIntent
  processedAt: number
}

export async function getPageCache(key: string): Promise<PageCacheRow | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PAGE_CACHE, 'readonly')
    const req = tx.objectStore(STORES.PAGE_CACHE).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function setPageCache(row: PageCacheRow): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PAGE_CACHE, 'readwrite')
    tx.objectStore(STORES.PAGE_CACHE).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAllPageCache(): Promise<PageCacheRow[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PAGE_CACHE, 'readonly')
    const req = tx.objectStore(STORES.PAGE_CACHE).getAll()
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function clearPageCache(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PAGE_CACHE, 'readwrite')
    tx.objectStore(STORES.PAGE_CACHE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
