import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { ExternalLink, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/DataTable'
import { Favicon } from '@/components/Favicon'
import { IntentIcon } from '@/components/IntentIcon'
import { useSemanticSearch } from '@/hooks/useSemanticSearch'
import { effectiveIntent } from '@/lib/static-intent'
import { cn, formatAge, formatDate } from '@/lib/utils'
import type { BookmarkItem, LlmSettings, PageIntent, TabItem } from '@/lib/types'

type SourceKind = 'bookmark' | 'tab' | 'both'

interface CombinedRow {
  key: string
  url: string
  title: string
  domain: string
  favIconUrl?: string
  source: SourceKind
  bookmarkIds: string[]
  tabIds: number[]
  windowIds: number[]
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
}

interface CombinedListTableProps {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  localUrlSet: Set<string>
  sourceFilterLabel: string
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
        bookmarkIds: [b.id],
        tabIds: [],
        windowIds: [],
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
      })
      continue
    }

    current.bookmarkIds.push(b.id)
    current.source = current.tabIds.length > 0 ? 'both' : 'bookmark'
    if (!current.folder && b.folder) current.folder = b.folder
    if (!current.category && b.category) current.category = b.category
    if (!current.intent && b.intent) current.intent = b.intent
    if (!current.staticIntent && b.staticIntent) current.staticIntent = b.staticIntent
    if (!current.dateAdded || b.dateAdded > current.dateAdded) current.dateAdded = b.dateAdded
    if (!current.lastVisited || (b.lastVisited ?? 0) > current.lastVisited) current.lastVisited = b.lastVisited
    if ((b.visitCount ?? 0) > (current.visitCount ?? 0)) current.visitCount = b.visitCount
    if (b.isDuplicate) current.isDuplicate = true
    if (b.isOpen) current.isOpen = true
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
        bookmarkIds: [],
        tabIds: [t.id],
        windowIds: [t.windowId],
        folder: t.bookmarkFolder ?? '',
        category: t.category,
        intent: t.intent,
        staticIntent: t.staticIntent,
        tags: [...(t.tags ?? [])],
        lastAccessed: t.lastAccessed,
        visitCount: t.visitCount,
        isDuplicate: t.isDuplicate,
        isOpen: true,
      })
      continue
    }

    current.tabIds.push(t.id)
    current.windowIds.push(t.windowId)
    current.source = current.bookmarkIds.length > 0 ? 'both' : 'tab'
    if (!current.title && t.title) current.title = t.title
    if (!current.favIconUrl && t.favIconUrl) current.favIconUrl = t.favIconUrl
    if (!current.category && t.category) current.category = t.category
    if (!current.intent && t.intent) current.intent = t.intent
    if (!current.staticIntent && t.staticIntent) current.staticIntent = t.staticIntent
    if (!current.lastAccessed || t.lastAccessed > current.lastAccessed) current.lastAccessed = t.lastAccessed
    if ((t.visitCount ?? 0) > (current.visitCount ?? 0)) current.visitCount = t.visitCount
    if (t.isDuplicate) current.isDuplicate = true
    current.isOpen = true
    for (const tag of t.tags ?? []) {
      if (!current.tags.includes(tag)) current.tags.push(tag)
    }
  }

  return Array.from(byUrl.values())
}

export function CombinedListTable({
  bookmarks,
  tabs,
  localUrlSet,
  sourceFilterLabel,
  settings,
  loading,
  onDeleteBookmark,
  onCloseTab,
  onActivateTab,
  menuHost,
}: CombinedListTableProps) {
  const [query, setQuery] = useState('')
  const [semanticEnabled, setSemanticEnabled] = useState(false)
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
    if (!semanticEnabled || !query.trim()) return merged
    const needle = query.trim().toLowerCase()
    const lexicalMatch = (item: CombinedRow) =>
      item.title.toLowerCase().includes(needle) ||
      item.url.toLowerCase().includes(needle) ||
      item.domain.toLowerCase().includes(needle) ||
      (item.category ?? '').toLowerCase().includes(needle) ||
      item.folder.toLowerCase().includes(needle) ||
      item.tags.join(' ').toLowerCase().includes(needle)

    const combined = merged.filter((item) => lexicalMatch(item) || semanticScores.has(item.url))
    return combined.sort((a, b) => {
      const sb = semanticScores.get(b.url) ?? -1
      const sa = semanticScores.get(a.url) ?? -1
      if (sa !== sb) return sb - sa
      return (b.lastAccessed ?? b.dateAdded ?? 0) - (a.lastAccessed ?? a.dateAdded ?? 0)
    })
  }, [merged, query, semanticEnabled, semanticScores])

  const columns = useMemo<ColumnDef<CombinedRow>[]>(() => [
    {
      id: 'favicon',
      header: '',
      enableSorting: false,
      size: 24,
      cell: ({ row }) => <Favicon domain={row.original.domain} src={row.original.favIconUrl} />,
    },
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => {
            if (row.original.tabIds.length > 0) onActivateTab(row.original.tabIds[0])
            else void chrome.tabs.create({ url: row.original.url })
          }}
          className="flex w-full min-w-0 items-center gap-1.5 truncate text-left text-foreground hover:text-primary hover:underline"
          title={row.original.url}
        >
          <span className="truncate">{row.original.title}</span>
          {semanticScores.has(row.original.url) && (
            <span className="shrink-0 rounded bg-emerald-600/20 px-1 py-0.5 text-[10px] text-emerald-300">
              {Math.round((semanticScores.get(row.original.url) ?? 0) * 100)}%
            </span>
          )}
          <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
        </button>
      ),
    },
    {
      id: 'source',
      header: 'Source',
      accessorFn: (row) => row.source,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.source}
        </span>
      ),
    },
    {
      accessorKey: 'domain',
      header: 'Domain',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span>{row.original.domain}</span>
          {localUrlSet.has(row.original.url) && (
            <Badge variant="outline" className="rounded text-[10px] opacity-70">LAN</Badge>
          )}
        </span>
      ),
    },
    {
      accessorKey: 'folder',
      header: 'Folder',
      cell: ({ row }) => (
        <span className="max-w-[160px] truncate text-xs text-muted-foreground" title={row.original.folder}>
          {row.original.folder || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.category ?? <span className="opacity-30">—</span>}
        </span>
      ),
    },
    {
      id: 'intent',
      header: 'Intent',
      enableSorting: false,
      cell: ({ row }) => {
        const intent = effectiveIntent(row.original)
        return (
          <span className="text-sm" title={intent ?? ''}>
            {intent ? <IntentIcon intent={intent} /> : <span className="opacity-30">—</span>}
          </span>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {localUrlSet.has(row.original.url) && <Badge variant="outline" className="rounded text-[10px] opacity-70">LAN</Badge>}
          {row.original.tabIds.length > 0 && <Badge variant="accent" className="text-[10px]">open</Badge>}
          {row.original.bookmarkIds.length > 0 && <Badge variant="primary" className="text-[10px]">saved</Badge>}
          {row.original.isDuplicate && <Badge variant="muted" className="text-[10px]">dup</Badge>}
        </div>
      ),
    },
    {
      accessorKey: 'dateAdded',
      header: 'Added',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.dateAdded ? formatDate(row.original.dateAdded) : <span className="opacity-30">—</span>}
        </span>
      ),
    },
    {
      accessorKey: 'lastAccessed',
      header: 'Last accessed',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.lastAccessed ? formatAge(row.original.lastAccessed) : <span className="opacity-30">—</span>}
        </span>
      ),
    },
    {
      accessorKey: 'visitCount',
      header: 'Visits',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.visitCount ?? <span className="opacity-30">—</span>}
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
  ], [localUrlSet, onActivateTab, onCloseTab, onDeleteBookmark, semanticScores])

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
      <span className="text-xs text-muted-foreground">{sourceFilterLabel}</span>
      {semanticEnabled && state === 'embedding' && <span className="text-xs text-muted-foreground">Embedding query…</span>}
      {semanticEnabled && state === 'no-cache' && <span className="text-xs text-muted-foreground">No embeddings cache. Run embeddings in Lab.</span>}
      {semanticEnabled && state === 'error' && <span className="text-xs text-destructive">Error: {error}</span>}
    </div>
  )

  const initialSorting: SortingState = [{ id: 'lastAccessed', desc: true }]

  return (
    <DataTable
      columns={columns}
      data={filteredData}
      searchKey={semanticEnabled ? undefined : 'title'}
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
