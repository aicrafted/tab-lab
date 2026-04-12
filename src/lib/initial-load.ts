import { getAllBookmarks } from './bookmarks'
import { loadCachedCategories, loadCachedIntents, loadCachedTags } from './classifier'
import { crossLink } from './crosslink'
import type { BookmarkItem, TabItem } from './types'
import { getAllTabs } from './tabs'

interface LinkedData {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
}

export interface HydratedData {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  tabsWithCategoryCache: TabItem[]
  rawLinked: LinkedData
}

export async function loadHydratedData(): Promise<HydratedData> {
  const [rawBookmarks, rawTabs] = await Promise.all([
    getAllBookmarks(),
    getAllTabs(),
  ])
  const linked = crossLink(rawBookmarks, rawTabs)

  const [tabCache, bmCache] = await Promise.all([
    loadCachedCategories(linked.tabs, 'tab'),
    loadCachedCategories(linked.bookmarks, 'bm'),
  ])
  const bookmarksWithCategories = linked.bookmarks.map((bookmark) => {
    const category = bmCache.get(bookmark.url)
    return category ? { ...bookmark, category } : bookmark
  })
  const tabsWithCategories = linked.tabs.map((tab) => {
    const category = tabCache.get(tab.url)
    return category ? { ...tab, category } : tab
  })

  const [tabTagCache, bmTagCache] = await Promise.all([
    loadCachedTags(linked.tabs, 'tab'),
    loadCachedTags(linked.bookmarks, 'bm'),
  ])
  const bookmarksWithTags = bookmarksWithCategories.map((bookmark) => {
    const tags = bmTagCache.get(bookmark.url)
    return tags ? { ...bookmark, tags } : bookmark
  })
  const tabsWithTags = tabsWithCategories.map((tab) => {
    const tags = tabTagCache.get(tab.url)
    return tags ? { ...tab, tags } : tab
  })

  const [tabIntentCache, bmIntentCache] = await Promise.all([
    loadCachedIntents(linked.tabs, 'tab'),
    loadCachedIntents(linked.bookmarks, 'bm'),
  ])
  const bookmarksFinal = bookmarksWithTags.map((bookmark) => {
    const intent = bmIntentCache.get(bookmark.url)
    return intent ? { ...bookmark, intent } : bookmark
  })
  const tabsFinal = tabsWithTags.map((tab) => {
    const intent = tabIntentCache.get(tab.url)
    return intent ? { ...tab, intent } : tab
  })

  return {
    bookmarks: bookmarksFinal,
    tabs: tabsFinal,
    tabsWithCategoryCache: tabsWithCategories,
    rawLinked: linked,
  }
}
