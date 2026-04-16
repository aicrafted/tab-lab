import { getAllBookmarks } from '../browser/bookmarks'
import { loadCachedCategoryData, loadCachedIntents, loadCachedTags } from '../ai/classifier'
import { crossLink } from '../core/crosslink'
import { detectPlatform, intentFromPlatform } from '../core/platform-detection'
import { detectStaticIntent } from '../ai/static-intent'
import { migratePageCacheKeys } from '../db/cacheDb'
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
  try {
    await migratePageCacheKeys()
  } catch (err) {
    console.warn('[initial-load] page cache migration failed', err)
  }

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

  const categoryCache = await loadCachedCategoryData([...linked.tabs, ...linked.bookmarks])
  const bookmarksWithCategories = linked.bookmarks.map((bookmark) => {
    const cached = categoryCache.get(bookmark.url)
    if (!cached) return bookmark
    return {
      ...bookmark,
      category: cached.category,
      ...(cached.parentCategory ? { parentCategory: cached.parentCategory } : {}),
    }
  })
  const tabsWithCategories = linked.tabs.map((tab) => {
    const cached = categoryCache.get(tab.url)
    if (!cached) return tab
    return {
      ...tab,
      category: cached.category,
      ...(cached.parentCategory ? { parentCategory: cached.parentCategory } : {}),
    }
  })

  const tagCache = await loadCachedTags([...linked.tabs, ...linked.bookmarks])
  const bookmarksWithTags = bookmarksWithCategories.map((bookmark) => {
    const tags = tagCache.get(bookmark.url)
    return tags ? { ...bookmark, tags } : bookmark
  })
  const tabsWithTags = tabsWithCategories.map((tab) => {
    const tags = tagCache.get(tab.url)
    return tags ? { ...tab, tags } : tab
  })

  const intentCache = await loadCachedIntents([...linked.tabs, ...linked.bookmarks])
  const bookmarksFinal = bookmarksWithTags.map((bookmark) => {
    const intent = intentCache.get(bookmark.url)
    return intent ? { ...bookmark, intent } : bookmark
  })
  const tabsFinal = tabsWithTags.map((tab) => {
    const intent = intentCache.get(tab.url)
    return intent ? { ...tab, intent } : tab
  })

  return {
    bookmarks: bookmarksFinal,
    tabs: tabsFinal,
    tabsWithCategoryCache: tabsWithCategories,
    rawLinked: linked,
  }
}
