import { detectStaticIntent } from './static-intent'
import type { PageIntent } from './types'

export interface UrlUpdate {
  url: string
}

export interface CategoryUpdate extends UrlUpdate {
  category: string
}

export interface TagsUpdate extends UrlUpdate {
  tags: string[]
}

export interface IntentUpdate extends UrlUpdate {
  intent: PageIntent
}

function buildUpdateMap<U extends UrlUpdate>(updates: U[]): Map<string, U> {
  return new Map(updates.map((update) => [update.url, update]))
}

export function applyUpdatesByUrl<T extends { url: string; staticIntent?: PageIntent }, U extends UrlUpdate>(
  items: T[],
  updates: U[],
  mapper: (item: T, update: U) => T,
): T[] {
  if (updates.length === 0) {
    return items.map((item) => {
      if (item.staticIntent) return item
      const staticIntent = detectStaticIntent(item.url)
      return staticIntent ? { ...item, staticIntent } : item
    })
  }
  const updatesByUrl = buildUpdateMap(updates)
  return items.map((item) => {
    const staticIntent = item.staticIntent ?? detectStaticIntent(item.url)
    const update = updatesByUrl.get(item.url)
    const next = update ? mapper(item, update) : item
    if (next.staticIntent || !staticIntent) return next
    return { ...next, staticIntent }
  })
}

export function applyCategoryUpdates<T extends { url: string; category?: string; staticIntent?: PageIntent }>(
  items: T[],
  updates: CategoryUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, category: update.category }))
}

export function applyTagsUpdates<T extends { url: string; tags?: string[]; staticIntent?: PageIntent }>(
  items: T[],
  updates: TagsUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, tags: update.tags }))
}

export function applyIntentUpdates<T extends { url: string; intent?: PageIntent; staticIntent?: PageIntent }>(
  items: T[],
  updates: IntentUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, intent: update.intent }))
}
