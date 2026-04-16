import { openDB, STORES } from './tab-lab-db'
import type { KnownPlatform } from '../types'

export interface DomainRow {
  domain: string
  known: boolean
  category?: string
  description?: string
  platform?: KnownPlatform
  fetchedAt: number
}

export async function getDomainRow(domain: string): Promise<DomainRow | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOMAINS, 'readonly')
    const req = tx.objectStore(STORES.DOMAINS).get(domain)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function setDomainRow(row: DomainRow): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOMAINS, 'readwrite')
    tx.objectStore(STORES.DOMAINS).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAllDomainRows(): Promise<DomainRow[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOMAINS, 'readonly')
    const req = tx.objectStore(STORES.DOMAINS).getAll()
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function clearDomains(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOMAINS, 'readwrite')
    tx.objectStore(STORES.DOMAINS).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
