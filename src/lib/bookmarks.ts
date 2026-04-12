import type { BookmarkItem } from './types'
import { parseDomain } from './utils'

export interface BookmarkFolderOption {
  id: string
  path: string
}

interface FolderIndex {
  pathById: Map<string, string>
  descendantIdsById: Map<string, Set<string>>
  options: BookmarkFolderOption[]
}

function buildFolderIndex(tree: chrome.bookmarks.BookmarkTreeNode[]): FolderIndex {
  const pathById = new Map<string, string>()
  const descendantIdsById = new Map<string, Set<string>>()
  const options: BookmarkFolderOption[] = []

  const visit = (node: chrome.bookmarks.BookmarkTreeNode, parentPath = ''): Set<string> => {
    if (node.children === undefined) return new Set()

    const myPath = parentPath
      ? `${parentPath}/${node.title}`
      : node.title
    const hasTitle = Boolean(node.title)

    if (hasTitle) {
      pathById.set(node.id, myPath)
      options.push({ id: node.id, path: myPath })
    }

    const descendants = new Set<string>()
    if (hasTitle) descendants.add(node.id)

    for (const child of node.children) {
      for (const childId of visit(child, hasTitle ? myPath : '')) {
        descendants.add(childId)
      }
    }

    if (hasTitle) {
      descendantIdsById.set(node.id, descendants)
    }
    return descendants
  }

  for (const root of tree) {
    visit(root)
  }

  options.sort((a, b) => a.path.localeCompare(b.path))
  return { pathById, descendantIdsById, options }
}

/** Returns all bookmarks, deduplicated by URL (first occurrence wins). */
export async function getAllBookmarks(): Promise<BookmarkItem[]> {
  const tree = await chrome.bookmarks.getTree()
  const folderIndex = buildFolderIndex(tree)

  const collected: BookmarkItem[] = []

  function traverse(node: chrome.bookmarks.BookmarkTreeNode): void {
    if (node.url) {
      try {
        const domain = parseDomain(node.url)
        const folderId = node.parentId
        const folder = folderId ? (folderIndex.pathById.get(folderId) ?? '') : ''
        collected.push({
          id: node.id,
          url: node.url,
          title: node.title || node.url,
          domain,
          folderId,
          folder,
          dateAdded: node.dateAdded ?? Date.now(),
        })
      } catch (err) {
        console.warn('[bookmarks] skip malformed bookmark URL', { url: node.url, err })
      }
    }
    for (const child of node.children ?? []) {
      traverse(child)
    }
  }

  for (const root of tree) {
    traverse(root)
  }

  // Flag duplicates within source — first occurrence is canonical
  const seen = new Set<string>()
  const deduped = collected.map(bm => {
    if (seen.has(bm.url)) return { ...bm, isDuplicate: true }
    seen.add(bm.url)
    return bm
  })

  return enrichWithHistory(deduped)
}

export async function getBookmarkFolderOptions(): Promise<BookmarkFolderOption[]> {
  const tree = await chrome.bookmarks.getTree()
  return buildFolderIndex(tree).options
}

export async function getBookmarkFolderDescendantIds(folderId: string): Promise<Set<string> | null> {
  const tree = await chrome.bookmarks.getTree()
  const descendants = buildFolderIndex(tree).descendantIdsById.get(folderId)
  return descendants ?? null
}

const SKIPPED_SCHEMES = ['chrome://', 'about:', 'file://', 'edge://', 'brave://']

function isSkippableUrl(url: string): boolean {
  return SKIPPED_SCHEMES.some(s => url.startsWith(s))
}

/** Enrich bookmarks with lastVisited from chrome.history. Batched to avoid flooding. */
async function enrichWithHistory(bookmarks: BookmarkItem[]): Promise<BookmarkItem[]> {
  const BATCH = 50
  const result = [...bookmarks]

  for (let i = 0; i < result.length; i += BATCH) {
    const batch = result.slice(i, i + BATCH)
    await Promise.all(
      batch.map(async (bm, j) => {
        if (isSkippableUrl(bm.url)) return
        try {
          const visits = await chrome.history.getVisits({ url: bm.url })
          if (visits.length > 0) {
            const latest = Math.max(...visits.map(v => v.visitTime ?? 0))
            result[i + j] = { ...bm, lastVisited: latest, visitCount: visits.length }
          }
        } catch (err) {
          console.warn('[bookmarks] failed to fetch history visits', { url: bm.url, err })
        }
      }),
    )
  }
  return result
}

/** Export categorized bookmarks to Chrome bookmark folders. */
export async function exportToChromeFolders(
  bookmarks: BookmarkItem[],
): Promise<{ exported: number; folders: number }> {
  const categorized = bookmarks.filter(b => b.category && !b.isDuplicate)
  if (categorized.length === 0) return { exported: 0, folders: 0 }

  // Find bookmark bar
  const tree = await chrome.bookmarks.getTree()
  const bar = tree[0]?.children?.find(n => n.title === 'Bookmarks bar' || n.title === 'Bookmarks Bar')
    ?? tree[0]?.children?.[0]
  if (!bar) throw new Error('Could not find bookmark bar')

  // Find or create TabLab root folder
  let tabMindFolder = bar.children?.find(n => n.title === 'TabLab' && !n.url)
  if (!tabMindFolder) {
    tabMindFolder = await chrome.bookmarks.create({ parentId: bar.id, title: 'TabLab' })
  }

  // Create or reuse one sub-folder per category
  const categoryFolders = new Map<string, string>()
  const uniqueCategories = [...new Set(categorized.map(b => b.category!))]

  for (const cat of uniqueCategories) {
    const existing = tabMindFolder.children?.find(n => n.title === cat && !n.url)
    if (existing) {
      categoryFolders.set(cat, existing.id)
    } else {
      const folder = await chrome.bookmarks.create({ parentId: tabMindFolder.id, title: cat })
      categoryFolders.set(cat, folder.id)
    }
  }

  // Move bookmarks
  await Promise.all(
    categorized.map(b =>
      chrome.bookmarks.move(b.id, { parentId: categoryFolders.get(b.category!)! }),
    ),
  )

  return { exported: categorized.length, folders: uniqueCategories.length }
}
