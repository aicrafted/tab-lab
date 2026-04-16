import type { BookmarkItem, TabItem } from './types'

interface CrossLinked {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
}

/**
 * Enriches bookmarks and tabs with cross-source flags.
 * - TabItem.isBookmarked / .bookmarkFolder — URL exists in bookmarks
 * - TabItem.isDuplicate — same URL open in multiple tabs
 * - BookmarkItem.isOpen — URL is currently open in a tab
 *
 * Sources are NOT merged — only linked via flags.
 */
export function crossLink(
  bookmarks: BookmarkItem[],
  tabs: TabItem[],
): CrossLinked {
  // Build bookmark lookup: url → canonical BookmarkItem (first, non-duplicate)
  const bookmarkByUrl = new Map<string, BookmarkItem>()
  for (const bm of bookmarks) {
    if (!bm.isDuplicate && !bookmarkByUrl.has(bm.url)) {
      bookmarkByUrl.set(bm.url, bm)
    }
  }

  // Count tab URL occurrences for duplicate detection
  const tabUrlCount = new Map<string, number>()
  for (const tab of tabs) {
    tabUrlCount.set(tab.url, (tabUrlCount.get(tab.url) ?? 0) + 1)
  }

  // Enrich tabs
  const enrichedTabs: TabItem[] = tabs.map(tab => {
    const bm = bookmarkByUrl.get(tab.url)
    return {
      ...tab,
      isBookmarked:   bm !== undefined,
      bookmarkFolder: bm?.folder,
      isDuplicate:    (tabUrlCount.get(tab.url) ?? 0) > 1,
    }
  })

  // Attach duplicateCount to canonical (non-duplicate) rows
  const tabsWithDupCount: TabItem[] = enrichedTabs.map(t => ({
    ...t,
    duplicateCount: !t.isDuplicate && (tabUrlCount.get(t.url) ?? 1) > 1
      ? tabUrlCount.get(t.url)
      : undefined,
  }))

  // Enrich bookmarks
  const openUrls = new Set(tabs.map(t => t.url))
  const enrichedBookmarks: BookmarkItem[] = bookmarks.map(bm => ({
    ...bm,
    isOpen: openUrls.has(bm.url),
  }))

  return { bookmarks: enrichedBookmarks, tabs: tabsWithDupCount }
}
