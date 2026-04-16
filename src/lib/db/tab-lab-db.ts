/**
 * Unified IndexedDB for tab-lab (bookmarks, tabs, domains, embeddings, projections).
 */

export const DB_NAME = 'tab-lab'
export const DB_VERSION = 1

export const STORES = {
  PAGE_CACHE: 'page-cache',
  DOMAIN_KNOWLEDGE: 'domain-knowledge',
  EMBEDDINGS: 'embeddings',
  PROJECTION_2D: 'projection2d',
  META: 'meta',
} as const

export type StoreName = (typeof STORES)[keyof typeof STORES]

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result

      // 1. Page Cache (formerly tabmind-cache)
      if (!db.objectStoreNames.contains(STORES.PAGE_CACHE)) {
        db.createObjectStore(STORES.PAGE_CACHE, { keyPath: 'key' })
      }

      // 2. Domain Knowledge (formerly tabmind-domains)
      if (!db.objectStoreNames.contains(STORES.DOMAIN_KNOWLEDGE)) {
        db.createObjectStore(STORES.DOMAIN_KNOWLEDGE, { keyPath: 'domain' })
      }

      // 3. Embeddings (formerly tabmind-embeddings)
      if (!db.objectStoreNames.contains(STORES.EMBEDDINGS)) {
        const store = db.createObjectStore(STORES.EMBEDDINGS, { keyPath: 'key' })
        store.createIndex('by-dim', 'dim', { unique: false })
        store.createIndex('by-url', 'url', { unique: false })
      }

      // 4. Projection 2D
      if (!db.objectStoreNames.contains(STORES.PROJECTION_2D)) {
        const store = db.createObjectStore(STORES.PROJECTION_2D, { keyPath: 'key' })
        store.createIndex('by-dim', 'dim', { unique: false })
      }

      // 5. Meta
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
