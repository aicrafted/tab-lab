/**
 * Chrome extension storage helpers.
 * - Settings → chrome.storage.local (small, single key)
 * - Per-URL AI cache (categories, tags, intents, embeddings) → IndexedDB via cacheDb
 *   to avoid the 10MB chrome.storage.local quota limit.
 */

import * as cacheDb from './cacheDb'
import type { CacheEntry, LlmSettings } from './types'
import type { SourceFilter } from '@/components/views/types'

const LAST_SCAN_KEY = 'lastScan'
const SOURCE_FILTER_KEY = 'sourceFilter'
const STORAGE_KEEP_KEYS = new Set(['settings', LAST_SCAN_KEY, SOURCE_FILTER_KEY, 'sidebarWidth'])

export { clearAll as clearCache } from './cacheDb'

/** Clear ALL AI caches (IndexedDB for per-URL cache + embeddings). */
export async function clearAllAICache(): Promise<void> {
  await cacheDb.clearAll()
  const DB_NAME = 'tabmind-embeddings'
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    const stores = ['embeddings', ...(db.objectStoreNames.contains('projection2d') ? ['projection2d'] : [])]
    const tx = db.transaction(stores, 'readwrite')
    tx.objectStore('embeddings').clear()
    if (db.objectStoreNames.contains('projection2d')) {
      tx.objectStore('projection2d').clear()
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
  }
}

export async function getCached(
  prefix: 'bm' | 'tab',
  url: string,
): Promise<CacheEntry | null> {
  return cacheDb.getCached(prefix, url)
}

export async function setCached(
  prefix: 'bm' | 'tab',
  url: string,
  entry: CacheEntry,
): Promise<void> {
  return cacheDb.setCached(prefix, url, entry)
}

const SETTINGS_KEY = 'settings'

export async function getLlmSettings(): Promise<LlmSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  return {
    chatProvider: 'lmstudio',
    embeddingProvider: 'lmstudio',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: '',
    model: '',
    embeddingModel: '',
    webllmModel: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    ...(result[SETTINGS_KEY] ?? {}),
  }
}

export async function setLlmSettings(settings: LlmSettings): Promise<void> {
  await safeLocalSet({ [SETTINGS_KEY]: settings })
}

export async function getLastScan(): Promise<number | null> {
  const result = await chrome.storage.local.get(LAST_SCAN_KEY)
  return (result[LAST_SCAN_KEY] as number | undefined) ?? null
}

export async function setLastScan(timestamp: number): Promise<void> {
  await safeLocalSet({ [LAST_SCAN_KEY]: timestamp })
}

export async function getSourceFilter(): Promise<SourceFilter> {
  const result = await chrome.storage.local.get(SOURCE_FILTER_KEY)
  const value = result[SOURCE_FILTER_KEY]
  if (value === 'bookmarks' || value === 'tabs' || value === 'both') {
    return value
  }
  return 'both'
}

export async function setSourceFilter(sourceFilter: SourceFilter): Promise<void> {
  await safeLocalSet({ [SOURCE_FILTER_KEY]: sourceFilter })
}

async function safeLocalSet(payload: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.local.set(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.toLowerCase().includes('quota')) throw err

    const all = await chrome.storage.local.get(null)
    const staleKeys = Object.keys(all).filter((key) => !STORAGE_KEEP_KEYS.has(key))
    if (staleKeys.length > 0) {
      await chrome.storage.local.remove(staleKeys)
      await chrome.storage.local.set(payload)
      return
    }
    throw err
  }
}
