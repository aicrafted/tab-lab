/**
 * Chrome extension storage helpers.
 * - Settings → chrome.storage.local (small, single key)
 * - Per-URL AI cache (categories, tags, intents, embeddings) → IndexedDB via cacheDb
 *   to avoid the 10MB chrome.storage.local quota limit.
 */

import * as cacheDb from '../db/cacheDb'
import { clearDomainKnowledgeCache } from '../ai/domain-enricher'
import { clearEmbeddingCache } from '../ai/embedder'
import { migrateLlmSettings } from './types'
import type { BookmarkScopeFilter, CacheEntry, LlmSettings } from './types'
import type { SourceFilter } from '@/components/views/types'
import {
  BOOKMARK_SCOPE_FILTER_KEY,
  LAST_SCAN_KEY,
  SETTINGS_KEY,
  SOURCE_FILTER_KEY,
  MAP_SETTINGS_KEY,
  KB_REMOTE_KEY,
  KB_OVERRIDES_KEY,
  STORAGE_KEEP_KEYS,
} from './storage-keys'
import type { PrefilledDomain } from '../ai/domain-prefill'

export { clearAll as clearCache, getAll as getAllCached } from '../db/cacheDb'

/** Clear ALL AI caches (IndexedDB for per-URL cache + embeddings). */
export async function clearAllAICache(): Promise<void> {
  await cacheDb.clearAll()
  try {
    await clearDomainKnowledgeCache()
  } catch (err) {
    console.warn('[storage] failed to clear domain knowledge cache', err)
  }
  try {
    await clearEmbeddingCache()
  } catch (err) {
    console.warn('[storage] failed to clear embedding cache', err)
  }
}

export async function getCached(
  url: string,
): Promise<CacheEntry | null> {
  return cacheDb.getCached(url)
}

export async function setCached(
  url: string,
  entry: CacheEntry,
): Promise<void> {
  return cacheDb.setCached(url, entry)
}

export async function getLlmSettings(): Promise<LlmSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  const rawSettings = result[SETTINGS_KEY]
  const migrated = migrateLlmSettings(rawSettings)
  if (rawSettings !== undefined && rawSettings && typeof rawSettings === 'object' && !('tasks' in (rawSettings as object))) {
    await safeLocalSet({ [SETTINGS_KEY]: migrated })
  }
  return migrated
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

export async function getBookmarkScopeFilter(): Promise<BookmarkScopeFilter> {
  const result = await chrome.storage.local.get(BOOKMARK_SCOPE_FILTER_KEY)
  const raw = result[BOOKMARK_SCOPE_FILTER_KEY]
  if (raw && typeof raw === 'object') {
    const mode = (raw as Record<string, unknown>).mode
    const folderId = (raw as Record<string, unknown>).folderId
    const folderPath = (raw as Record<string, unknown>).folderPath
    if (mode === 'root') return { mode: 'root' }
    if (mode === 'folder' && typeof folderId === 'string' && folderId.trim()) {
      return {
        mode: 'folder',
        folderId: folderId.trim(),
        ...(typeof folderPath === 'string' ? { folderPath } : {}),
      }
    }
  }
  return { mode: 'root' }
}

export async function setBookmarkScopeFilter(filter: BookmarkScopeFilter): Promise<void> {
  const payload: BookmarkScopeFilter = filter.mode === 'folder' && filter.folderId
    ? {
      mode: 'folder',
      folderId: filter.folderId,
      ...(filter.folderPath ? { folderPath: filter.folderPath } : {}),
    }
    : { mode: 'root' }
  await safeLocalSet({ [BOOKMARK_SCOPE_FILTER_KEY]: payload })
}

export interface MapSettings {
  umapParams?: {
    nNeighbors?: number
    minDist?: number
    spread?: number
  }
}

export async function getMapSettings(): Promise<MapSettings> {
  const result = await chrome.storage.local.get(MAP_SETTINGS_KEY)
  const raw = result[MAP_SETTINGS_KEY]
  if (raw && typeof raw === 'object') {
    return raw as MapSettings
  }
  return {}
}

export async function setMapSettings(settings: MapSettings): Promise<void> {
  await safeLocalSet({ [MAP_SETTINGS_KEY]: settings })
}

export async function getKbRemote(): Promise<Record<string, PrefilledDomain>> {
  const result = await chrome.storage.local.get(KB_REMOTE_KEY)
  return (result[KB_REMOTE_KEY] as Record<string, PrefilledDomain>) ?? {}
}

export async function setKbRemote(kb: Record<string, PrefilledDomain>): Promise<void> {
  await safeLocalSet({ [KB_REMOTE_KEY]: kb })
}

export async function getKbOverrides(): Promise<Record<string, PrefilledDomain>> {
  const result = await chrome.storage.local.get(KB_OVERRIDES_KEY)
  return (result[KB_OVERRIDES_KEY] as Record<string, PrefilledDomain>) ?? {}
}

export async function setKbOverrides(kb: Record<string, PrefilledDomain>): Promise<void> {
  await safeLocalSet({ [KB_OVERRIDES_KEY]: kb })
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
