/**
 * IndexedDB-backed storage for AI classification data (categories, tags, intents, embeddings).
 * Replaces chrome.storage.local for per-URL cache entries — avoids the 10MB quota limit.
 *
 * chrome.storage.local is only used for LLM settings (small, single key).
 */

import type { PageIntent } from './types'

const DB_NAME = 'tabmind-cache'
const DB_VERSION = 2

/** One cached entry per URL. */
export interface CacheEntry {
  category: string
  clusterId?: number
  processedAt: number
  tags?: string[]
  embedding?: number[]    // stored as regular array (Float32 not needed here)
  intent?: PageIntent
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'url' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Get a single cached entry by prefix+url. */
export async function getCached(prefix: 'tab' | 'bm', url: string): Promise<CacheEntry | null> {
  try {
    const db = await openDB()
    const key = `${prefix}:${url}`
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readonly')
      const req = tx.objectStore('cache').get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('[cacheDb] getCached failed', { prefix, url, err })
    return null
  }
}

/** Store a single cached entry. */
export async function setCached(prefix: 'tab' | 'bm', url: string, entry: CacheEntry): Promise<void> {
  const db = await openDB()
  const key = `${prefix}:${url}`
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cache', 'readwrite')
    tx.objectStore('cache').put({ url: key, ...entry })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Batch get: returns Map<url, CacheEntry> for existing entries. */
export async function getCachedBatch(prefix: 'tab' | 'bm', urls: string[]): Promise<Map<string, CacheEntry>> {
  try {
    const db = await openDB()
    const keys = urls.map(url => `${prefix}:${url}`)
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readonly')
      const store = tx.objectStore('cache')
      const results = new Map<string, CacheEntry>()
      let done = 0
      for (const key of keys) {
        const req = store.get(key)
        req.onsuccess = () => {
          if (req.result) {
            const entry = { ...req.result }
            delete (entry as Record<string, unknown>).url
            results.set(key.replace(`${prefix}:`, ''), entry)
          }
          done++
          if (done === keys.length) resolve(results)
        }
        req.onerror = () => reject(req.error)
      }
    })
  } catch (err) {
    console.warn('[cacheDb] getCachedBatch failed', { prefix, count: urls.length, err })
    return new Map()
  }
}

/** Clear all cached entries. */
export async function clearAll(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction('cache', 'readwrite')
    tx.objectStore('cache').clear()
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[cacheDb] clearAll failed', err)
  }
}

/** Get all entries as a Map<key, CacheEntry>. */
export async function getAll(): Promise<Map<string, CacheEntry>> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readonly')
      const req = tx.objectStore('cache').getAll()
      req.onsuccess = () => {
        const map = new Map<string, CacheEntry>()
        for (const row of req.result ?? []) {
          const entry = { ...row }
          delete (entry as Record<string, unknown>).url
          map.set(row.url, entry)
        }
        resolve(map)
      }
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.warn('[cacheDb] getAll failed', err)
    return new Map()
  }
}
