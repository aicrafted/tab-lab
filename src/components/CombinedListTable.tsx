import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { ChevronDown, ChevronRight, ExternalLink, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/DataTable'
import { Favicon } from '@/components/Favicon'
import { IntentIcon } from '@/components/IntentIcon'
import { useSemanticSearch } from '@/hooks/useSemanticSearch'
import { effectiveIntent } from '@/lib/ai/static-intent'
import { cn, formatAge, formatDate } from '@/lib/core/utils'
import type { BookmarkItem, LlmSettings, PageIntent, TabItem } from '@/lib/core/types'

type SourceKind = 'bookmark' | 'tab' | 'both'
const ZOMBIE_DAYS = 7

interface CombinedRow {
  key: string
  url: string
  title: string
  domain: string
  favIconUrl?: string
  source: SourceKind
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  bookmarkIds: string[]
  tabIds: number[]
  folder: string
  category?: string
  intent?: PageIntent
  staticIntent?: PageIntent
  tags: string[]
  dateAdded?: number
  lastAccessed?: number
  lastVisited?: number
  visitCount?: number
  isDuplicate?: boolean
  isOpen?: boolean
  newestActivity: number
}

interface CombinedListTableProps {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  localUrlSet: Set<string>
  settings: LlmSettings
  loading?: boolean
  onDeleteBookmark: (id: string) => void
  onCloseTab: (id: number) => void
  onActivateTab: (id: number) => void
  menuHost?: HTMLElement | null
}

function mergeRows(bookmarks: BookmarkItem[], tabs: TabItem[]): CombinedRow[] {
  const byUrl = new Map<string, CombinedRow>()

  for (const b of bookmarks) {
    const current = byUrl.get(b.url)
    if (!current) {
      byUrl.set(b.url, {
        key: b.url,
        url: b.url,
        title: b.title || b.url,
        domain: b.domain,
        favIconUrl: undefined,
        source: 'bookmark',
        bookmarks: [b],
        tabs: [],
        bookmarkIds: [b.id],
        tabIds: [],
        folder: b.folder ?? '',
        category: b.category,
        intent: b.intent,
        staticIntent: b.staticIntent,
        tags: [...(b.tags ?? [])],
        dateAdded: b.dateAdded,
        lastVisited: b.lastVisited,
        visitCount: b.visitCount,
        isDuplicate: b.isDuplicate,
        isOpen: b.isOpen,
        newestActivity: Math.max(b.dateAdded, b.lastVisited ?? 0),
      })
      continue
    }

    current.bookmarks.push(b)
    current.bookmarkIds.push(b.id)
    if (!current.folder && b.folder) current.folder = b.folder
    if (!current.category && b.category) current.category = b.category
    if (!current.intent && b.intent) current.intent = b.intent
    if (!current.staticIntent && b.staticIntent) current.staticIntent = b.staticIntent
    if (!current.dateAdded || b.dateAdded > current.dateAdded) current.dateAdded = b.dateAdded
    if (!current.lastVisited || (b.lastVisited ?? 0) > current.lastVisited) current.lastVisited = b.lastVisited
    if ((b.visitCount ?? 0) > (current.visitCount ?? 0)) current.visitCount = b.visitCount
    if (b.isDuplicate) current.isDuplicate = true
    if (b.isOpen) current.isOpen = true
    current.newestActivity = Math.max(current.newestActivity, b.dateAdded, b.lastVisited ?? 0)
    for (const tag of b.tags ?? []) {
      if (!current.tags.includes(tag)) current.tags.push(tag)
    }
  }

  for (const t of tabs) {
    const current = byUrl.get(t.url)
    if (!current) {
      byUrl.set(t.url, {
        key: t.url,
        url: t.url,
        title: t.title || t.url,
        domain: t.domain,
        favIconUrl: t.favIconUrl,
        source: 'tab',
        bookmarks: [],
        tabs: [t],
        bookmarkIds: [],
        tabIds: [t.id],
        folder: t.bookmarkFolder ?? '',
        category: t.category,
        intent: t.intent,
        staticIntent: t.staticIntent,
        tags: [...(t.tags ?? [])],
        lastAccessed: t.lastAccessed,
        visitCount: t.visitCount,
        isDuplicate: t.isDuplicate,
        isOpen: true,
        newestActivity: t.lastAccessed,
      })
      continue
    }

    current.tabs.push(t)
    current.tabIds.push(t.id)
    if (!current.title && t.title) current.title = t.title
    if (!current.favIconUrl && t.favIconUrl) current.favIconUrl = t.favIconUrl
    if (!current.category && t.category) current.category = t.category
    if (!current.intent && t.intent) current.intent = t.intent
    if (!current.staticIntent && t.staticIntent) current.staticIntent = t.staticIntent
    if (!current.lastAccessed || t.lastAccessed > current.lastAccessed) current.lastAccessed = t.lastAccessed
    if ((t.visitCount ?? 0) > (current.visitCount ?? 0)) current.visitCount = t.visitCount
    if (t.isDuplicate) current.isDuplicate = true
    current.isOpen = true
    current.newestActivity = Math.max(current.newestActivity, t.lastAccessed)
    for (const tag of t.tags ?? []) {
      if (!current.tags.includes(tag)) current.tags.push(tag)
    }
  }

  return Array.from(byUrl.values()).map((row) => {
    const sortedTabs = [...row.tabs].sort((a, b) => b.lastAccessed - a.lastAccessed)
    const sortedBookmarks = [...row.bookmarks].sort((a, b) => b.dateAdded - a.dateAdded)
    const source: SourceKind = sortedTabs.length > 0 && sortedBookmarks.length > 0
      ? 'both'
      : sortedTabs.length > 0
        ? 'tab'
        : 'bookmark'

    return {
      ...row,
      source,
      tabs: sortedTabs,
      bookmarks: sortedBookmarks,
      tabIds: sortedTabs.map((tab) => tab.id),
      bookmarkIds: sortedBookmarks.map((bookmark) => bookmark.id),
    }
  })
}

export function CombinedListTable({
  bookmarks,
  tabs,
  localUrlSet,
  settings,
  loading,
  onDeleteBookmark,
  onCloseTab,
  onActivateTab,
  menuHost,
}: CombinedListTableProps) {
  const [query, setQuery] = useState('')
  const [semanticEnabled, setSemanticEnabled] = useState(false)
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set())
  const { results, state, error, search, clear } = useSemanticSearch(settings)

  useEffect(() => {
    if (!semanticEnabled || !query.trim()) {
      clear()
      return
    }
    const timer = setTimeout(() => {
      void search(query)
    }, 400)
    return () => clearTimeout(timer)
  }, [semanticEnabled, query, search, clear])

  const semanticScores = useMemo(() => {
    const map = new Map<string, number>()
    for (const result of results) map.set(result.url, result.score)
    return map
  }, [results])

  const merged = useMemo(() => mergeRows(bookmarks, tabs), [bookmarks, tabs])

  const filteredData = useMemo(() => {
    if (!query.trim()) return merged
    const needle = query.trim().toLowerCase()
    const lexicalMatch = (item: CombinedRow) =>
      item.title.toLowerCase().includes(needle) ||
      item.url.toLowerCase().includes(needle) ||
      item.domain.toLowerCase().includes(needle) ||
      (item.category ?? '').toLowerCase().includes(needle) ||
      item.folder.toLowerCase().includes(needle) ||
      item.tags.join(' ').toLowerCase().includes(needle)

    if (!semanticEnabled) return merged.filter(lexicalMatch)

    const combined = merged.filter((item) => lexicalMatch(item) || semanticScores.has(item.url))
    return combined.sort((a, b) => {
      const sb = semanticScores.get(b.url) ?? -1
      const sa = semanticScores.get(a.url) ?? -1
      if (sa !== sb) return sb - sa
      return b.newestActivity - a.newestActivity
    })
  }, [merged, query, semanticEnabled, semanticScores])

  const onToggleExpanded = (url: string) => {
    setExpandedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const columns = useMemo<ColumnDef<CombinedRow>[]>(() => [
    {
      id: 'title',
      header: 'Title',
      accessorFn: (row) => row.title,
      cell: ({ row }) => {
        const item = row.original
        const topTab = item.tabs[0]
        const hasDuplicates = item.tabs.length > 1 || item.bookmarks.length > 1
        const isExpanded = expandedUrls.has(item.url)
        const intent = effectiveIntent(item)
        return (
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {hasDuplicates ? (
                <button
                  type="button"
                  onClick={() => onToggleExpanded(item.url)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
                  title={isExpanded ? 'Collapse duplicates' : 'Expand duplicates'}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : null}
              <Favicon domain={item.domain} src={item.favIconUrl} />
              <button
                type="button"
                onClick={() => {
                  if (topTab) onActivateTab(topTab.id)
                  else void chrome.tabs.create({ url: item.url })
                }}
                className="flex w-full min-w-0 items-center gap-1.5 truncate text-left text-foreground hover:text-primary hover:underline"
                title={item.url}
              >
                <span className="truncate">{item.title}</span>
                {semanticScores.has(item.url) && (
                  <span className="shrink-0 rounded bg-emerald-600/20 px-1 py-0.5 text-[10px] text-emerald-300">
                    {Math.round((semanticScores.get(item.url) ?? 0) * 100)}%
                  </span>
                )}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground/65">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span title={intent ?? ''}>
                  <IntentIcon intent={intent} className="h-3 w-3" />
                </span>
                <span className="capitalize">{item.source}</span>
                {localUrlSet.has(item.url) && (
                  <Badge variant="outline" className="rounded text-[10px] opacity-70">LAN</Badge>
                )}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate hover:text-foreground hover:underline"
                  title={item.url}
                >
                  {item.domain}
                </a>
                {item.folder && (
                  <>
                    <span aria-hidden="true" className="opacity-40">·</span>
                    <span className="max-w-[220px] truncate" title={item.folder}>{item.folder}</span>
                  </>
                )}
              </span>
            </div>
            {hasDuplicates && isExpanded && (
              <div className="ml-7 space-y-1 rounded border border-border/60 bg-card/30 p-2">
                {item.tabs.slice(1).map((tab) => (
                  <div key={tab.id} className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => onActivateTab(tab.id)}
                      className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground hover:underline"
                      title={tab.url}
                    >
                      {tab.title}
                    </button>
                    <span className="shrink-0 text-muted-foreground/70">#{tab.windowId}</span>
                    <button
                      type="button"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
                      title="Close duplicate tab"
                      onClick={() => onCloseTab(tab.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {item.bookmarks.slice(1).map((bookmark) => (
                  <div key={bookmark.id} className="flex items-center gap-2 text-xs">
                    <a
                      href={bookmark.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-muted-foreground hover:text-foreground hover:underline"
                      title={bookmark.url}
                    >
                      {bookmark.title}
                    </a>
                    <span className="shrink-0 text-muted-foreground/70">{formatDate(bookmark.dateAdded)}</span>
                    <button
                      type="button"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
                      title="Delete duplicate bookmark"
                      onClick={() => onDeleteBookmark(bookmark.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original
        const isZombie = item.lastAccessed != null && (Date.now() - item.lastAccessed > ZOMBIE_DAYS * 86_400_000)
        return (
        <div className="flex gap-1 whitespace-nowrap">
          {item.tabIds.length > 0 && <Badge variant="outline" className="rounded border-border/70 bg-card/40 text-[10px] text-muted-foreground">open</Badge>}
          {item.bookmarkIds.length > 0 && <Badge variant="primary" className="rounded text-[10px]">saved</Badge>}
          {item.tabs.length > 1 && <Badge variant="muted" className="rounded text-[10px]">tabs ×{item.tabs.length}</Badge>}
          {item.bookmarks.length > 1 && <Badge variant="muted" className="rounded text-[10px]">bookmarks ×{item.bookmarks.length}</Badge>}
          {isZombie && <Badge variant="outline" className="rounded text-[10px] opacity-60">zombie</Badge>}
        </div>
      )},
    },
    {
      id: 'lastActivity',
      accessorFn: (row) => row.newestActivity,
      header: 'Last activity',
      cell: ({ row }) => {
        const item = row.original
        const value = item.lastAccessed ?? item.lastVisited ?? item.dateAdded
        return (
        <span className="text-xs text-muted-foreground">
          {value ? formatAge(value) : <span className="opacity-30">—</span>}
        </span>
      )},
    },
    {
      id: 'category',
      accessorFn: (row) => row.category ?? '',
      header: 'Category',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.category ?? <span className="opacity-30">—</span>}
        </span>
      ),
    },
    {
      id: 'tags',
      header: 'Tags',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.tags.length > 0
            ? row.original.tags.map((tag) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))
            : <span className="text-xs text-muted-foreground opacity-30">—</span>}
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-0.5 whitespace-nowrap">
          <a
            href={row.original.url}
            target="_blank"
            rel="noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-primary"
            title="Open"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          {row.original.tabIds.length > 0 && (
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
              title="Close tab"
              onClick={() => onCloseTab(row.original.tabIds[0])}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {row.original.bookmarkIds.length > 0 && (
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
              title="Delete bookmark"
              onClick={() => onDeleteBookmark(row.original.bookmarkIds[0])}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ], [expandedUrls, localUrlSet, onActivateTab, onCloseTab, onDeleteBookmark, semanticScores])

  const toolbar = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={cn(
          'rounded border px-2 py-1 text-xs',
          semanticEnabled ? 'border-emerald-600/60 bg-emerald-600/20 text-emerald-300' : 'border-border text-muted-foreground',
        )}
        onClick={() => setSemanticEnabled((v) => !v)}
        disabled={!embeddingsAvailable(settings)}
        title={!embeddingsAvailable(settings) ? 'Embeddings unavailable for current provider/config' : 'Merge lexical + semantic search results'}
      >
        Semantic
      </button>
      {semanticEnabled && state === 'embedding' && <span className="text-xs text-muted-foreground">Embedding query…</span>}
      {semanticEnabled && state === 'no-cache' && <span className="text-xs text-muted-foreground">No embeddings cache. Run embeddings in Lab.</span>}
      {semanticEnabled && state === 'error' && <span className="text-xs text-destructive">Error: {error}</span>}
    </div>
  )

  const initialSorting: SortingState = [{ id: 'lastActivity', desc: true }]

  return (
    <DataTable
      columns={columns}
      data={filteredData}
      searchPlaceholder={semanticEnabled ? 'Search merged list (lexical + semantic)…' : 'Search merged list…'}
      searchValue={query}
      onSearchChange={setQuery}
      loading={loading}
      toolbar={toolbar}
      initialSorting={initialSorting}
      menuHost={menuHost}
    />
  )
}

function embeddingsAvailable(settings: LlmSettings): boolean {
  if (settings.tasks.embedding.provider === 'browser-ml') return true
  if (settings.tasks.embedding.provider === 'lmstudio') {
    return Boolean(settings.providers.lmstudio.baseUrl && settings.providers.lmstudio.embeddingModel)
  }
  return Boolean(settings.providers.openrouter.apiKey && settings.providers.openrouter.embeddingModel)
}
