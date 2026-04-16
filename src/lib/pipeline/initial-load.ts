import { getAllBookmarks } from '../browser/bookmarks'
import { loadCachedCategoryData, loadCachedIntents, loadCachedTags } from '../ai/classifier'
import { crossLink } from '../core/crosslink'
import { detectPlatform, intentFromPlatform } from '../core/platform-detection'
import { detectStaticIntent } from '../ai/static-intent'
import type { BookmarkItem, TabItem } from '../core/types'
import { getAllTabs } from '../browser/tabs'

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
  const linkedRaw = crossLink(rawBookmarks, rawTabs)
  const linked: LinkedData = {
    bookmarks: linkedRaw.bookmarks.map((bookmark) => {
      const platform = detectPlatform(bookmark.domain)
      return {
        ...bookmark,
        platform,
        staticIntent: detectStaticIntent(bookmark.url) ?? intentFromPlatform(platform, bookmark.url),
      }
    }),
    tabs: linkedRaw.tabs.map((tab) => {
      const platform = detectPlatform(tab.domain)
      return {
        ...tab,
        platform,
        staticIntent: detectStaticIntent(tab.url) ?? intentFromPlatform(platform, tab.url),
      }
    }),
  }

  const [tabCache, bmCache] = await Promise.all([
    loadCachedCategoryData(linked.tabs, 'tab'),
    loadCachedCategoryData(linked.bookmarks, 'bm'),
  ])
  const bookmarksWithCategories = linked.bookmarks.map((bookmark) => {
    const cached = bmCache.get(bookmark.url)
    if (!cached) return bookmark
    return {
      ...bookmark,
      category: cached.category,
      ...(cached.parentCategory ? { parentCategory: cached.parentCategory } : {}),
    }
  })
  const tabsWithCategories = linked.tabs.map((tab) => {
    const cached = tabCache.get(tab.url)
    if (!cached) return tab
    return {
      ...tab,
      category: cached.category,
      ...(cached.parentCategory ? { parentCategory: cached.parentCategory } : {}),
    }
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
