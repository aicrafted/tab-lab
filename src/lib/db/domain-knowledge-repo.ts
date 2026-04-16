import { openDB, STORES } from './tab-lab-db'
import type { KnownPlatform } from '../types'

export interface DomainKnowledgeRow {
  domain: string
  known: boolean
  category?: string
  description?: string
  platform?: KnownPlatform
  fetchedAt: number
}

export async function getDomainKnowledge(domain: string): Promise<DomainKnowledgeRow | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOMAIN_KNOWLEDGE, 'readonly')
    const req = tx.objectStore(STORES.DOMAIN_KNOWLEDGE).get(domain)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function setDomainKnowledge(row: DomainKnowledgeRow): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOMAIN_KNOWLEDGE, 'readwrite')
    tx.objectStore(STORES.DOMAIN_KNOWLEDGE).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAllDomainKnowledge(): Promise<DomainKnowledgeRow[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOMAIN_KNOWLEDGE, 'readonly')
    const req = tx.objectStore(STORES.DOMAIN_KNOWLEDGE).getAll()
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function clearDomainKnowledge(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DOMAIN_KNOWLEDGE, 'readwrite')
    tx.objectStore(STORES.DOMAIN_KNOWLEDGE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
