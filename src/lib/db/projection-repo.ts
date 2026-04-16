import { openDB, STORES } from './tab-lab-db'

export interface ProjectionRow {
  key: string // dim:url
  dim: number
  url: string
  x: number
  y: number
  updatedAt: number
}

export async function getProjection(key: string): Promise<ProjectionRow | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PROJECTION_2D, 'readonly')
    const req = tx.objectStore(STORES.PROJECTION_2D).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function setProjection(row: ProjectionRow): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PROJECTION_2D, 'readwrite')
    tx.objectStore(STORES.PROJECTION_2D).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getProjectionsByDim(dim: number): Promise<ProjectionRow[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PROJECTION_2D, 'readonly')
    const index = tx.objectStore(STORES.PROJECTION_2D).index('by-dim')
    const req = index.getAll(dim)
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function getAllProjections(): Promise<ProjectionRow[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PROJECTION_2D, 'readonly')
    const req = tx.objectStore(STORES.PROJECTION_2D).getAll()
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function clearProjections(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PROJECTION_2D, 'readwrite')
    tx.objectStore(STORES.PROJECTION_2D).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
