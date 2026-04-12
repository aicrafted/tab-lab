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

export function applyUpdatesByUrl<T extends { url: string }, U extends UrlUpdate>(
  items: T[],
  updates: U[],
  mapper: (item: T, update: U) => T,
): T[] {
  if (updates.length === 0) return items
  const updatesByUrl = buildUpdateMap(updates)
  return items.map((item) => {
    const update = updatesByUrl.get(item.url)
    return update ? mapper(item, update) : item
  })
}

export function applyCategoryUpdates<T extends { url: string; category?: string }>(
  items: T[],
  updates: CategoryUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, category: update.category }))
}

export function applyTagsUpdates<T extends { url: string; tags?: string[] }>(
  items: T[],
  updates: TagsUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, tags: update.tags }))
}

export function applyIntentUpdates<T extends { url: string; intent?: PageIntent }>(
  items: T[],
  updates: IntentUpdate[],
): T[] {
  return applyUpdatesByUrl(items, updates, (item, update) => ({ ...item, intent: update.intent }))
}
