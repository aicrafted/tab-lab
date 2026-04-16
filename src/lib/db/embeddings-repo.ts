import { openDB, STORES } from './tab-lab-db'

export interface EmbeddingRow {
  key: string // dim:url
  dim: number
  url: string
  vector: Float32Array | number[]
  updatedAt: number
}

export async function getEmbedding(key: string): Promise<EmbeddingRow | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EMBEDDINGS, 'readonly')
    const req = tx.objectStore(STORES.EMBEDDINGS).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function setEmbedding(row: EmbeddingRow): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EMBEDDINGS, 'readwrite')
    tx.objectStore(STORES.EMBEDDINGS).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getEmbeddingsByDim(dim: number): Promise<EmbeddingRow[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EMBEDDINGS, 'readonly')
    const index = tx.objectStore(STORES.EMBEDDINGS).index('by-dim')
    const req = index.getAll(dim)
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function getAllEmbeddings(): Promise<EmbeddingRow[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EMBEDDINGS, 'readonly')
    const req = tx.objectStore(STORES.EMBEDDINGS).getAll()
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function clearEmbeddings(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EMBEDDINGS, 'readwrite')
    tx.objectStore(STORES.EMBEDDINGS).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
