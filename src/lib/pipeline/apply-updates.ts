import { detectPlatformFromUrl, intentFromPlatform } from '../core/platform-detection'
import { detectStaticIntent } from '../ai/static-intent'
import type { KnownPlatform, PageIntent } from '../core/types'

export interface UrlUpdate {
  url: string
}

export interface CategoryUpdate extends UrlUpdate {
  category: string
  parentCategory?: string
}

export interface TagsUpdate extends UrlUpdate {
  tags: string[]
}

export interface IntentUpdate extends UrlUpdate {
  intent: PageIntent
}

export interface ClusterIdUpdate extends UrlUpdate {
  clusterId: number
}

function buildUpdateMap<U extends UrlUpdate>(updates: U[]): Map<string, U> {
  return new Map(updates.map((update) => [update.url, update]))
}

export function applyUpdatesByUrl<T extends { url: string; staticIntent?: PageIntent; platform?: KnownPlatform }, U extends UrlUpdate>(
  items: T[],
  updates: U[],
  mapper: (item: T, update: U) => T,
): T[] {
  if (updates.length === 0) {
    return items.map((item) => {
      const platform = item.platform ?? detectPlatformFromUrl(item.url)
      const staticIntent = item.staticIntent ?? detectStaticIntent(item.url) ?? intentFromPlatform(platform)
      if (platform === item.platform && staticIntent === item.staticIntent) return item
      return { ...item, ...(platform ? { platform } : {}), ...(staticIntent ? { staticIntent } : {}) }
    })
  }
  const updatesByUrl = buildUpdateMap(updates)
  return items.map((item) => {
    const platform = item.platform ?? detectPlatformFromUrl(item.url)
    const staticIntent = item.staticIntent ?? detectStaticIntent(item.url) ?? intentFromPlatform(platform)
    const update = updatesByUrl.get(item.url)
    const next = update ? mapper(item, update) : item
    const nextPlatform = next.platform ?? platform
    const nextStaticIntent = next.staticIntent ?? staticIntent
    if (nextPlatform === next.platform && nextStaticIntent === next.staticIntent) return next
    return {
      ...next,
      ...(nextPlatform ? { platform: nextPlatform } : {}),
      ...(nextStaticIntent ? { staticIntent: nextStaticIntent } : {}),
    }
  })
}

export function applyCategoryUpdates<T extends { url: string; category?: string; parentCategory?: string; staticIntent?: PageIntent; platform?: KnownPlatform }>(
  items: T[],
  updates: CategoryUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({
    ...item,
    category: update.category,
    ...(update.parentCategory !== undefined ? { parentCategory: update.parentCategory } : {}),
  }))
}

export function applyTagsUpdates<T extends { url: string; tags?: string[]; staticIntent?: PageIntent; platform?: KnownPlatform }>(
  items: T[],
  updates: TagsUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, tags: update.tags }))
}

export function applyIntentUpdates<T extends { url: string; intent?: PageIntent; staticIntent?: PageIntent; platform?: KnownPlatform }>(
  items: T[],
  updates: IntentUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, intent: update.intent }))
}

export function applyClusterIdUpdates<T extends { url: string; clusterId?: number; staticIntent?: PageIntent; platform?: KnownPlatform }>(
  items: T[],
  updates: ClusterIdUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, clusterId: update.clusterId }))
}
