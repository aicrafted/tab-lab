import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { ChevronDown, ChevronRight, ExternalLink, FolderOutput, Trash2 } from 'lucide-react'
import { DataTable } from './DataTable'
import { Badge } from '@/components/ui/badge'
import { Favicon } from './Favicon'
import type { BookmarkItem, PageIntent, LlmSettings } from '@/lib/types'
import { cn, formatDate, formatAge } from '@/lib/utils'
import { useSemanticSearch } from '@/hooks/useSemanticSearch'

const INTENT_EMOJI: Record<PageIntent, string> = {
  article: '📄', reference: '📚', tool: '🔧', service: '🌐',
  transactional: '🎫', video: '🎬', social: '💬', repository: '📦', other: '•',
}

interface BookmarkGroupRow {
  key: string
  url: string
  representative: BookmarkItem
  bookmarks: BookmarkItem[]
  duplicateCount: number
}

function groupByUrl(bookmarks: BookmarkItem[]): BookmarkGroupRow[] {
  const byUrl = new Map<string, BookmarkItem[]>()
  for (const item of bookmarks) {
    const existing = byUrl.get(item.url)
    if (existing) existing.push(item)
    else byUrl.set(item.url, [item])
  }

  return Array.from(byUrl.entries()).map(([url, group]) => {
    const sorted = [...group].sort((a, b) => b.dateAdded - a.dateAdded)
    return {
      key: url,
      url,
      representative: sorted[0],
      bookmarks: sorted,
      duplicateCount: sorted.length - 1,
    }
  })
}

function makeColumns(
  onDelete: (id: string) => void,
  semanticScores: Map<string, number>,
  expanded: Set<string>,
  onToggleExpanded: (url: string) => void,
): ColumnDef<BookmarkGroupRow>[] {
  return [
    {
      id: 'favicon',
      header: '',
      enableSorting: false,
      size: 24,
      cell: ({ row }) => <Favicon domain={row.original.representative.domain} />,
    },
    {
      id: 'title',
      header: 'Title',
      accessorFn: (row) => row.representative.title,
      cell: ({ row }) => {
        const group = row.original
        const top = group.representative
        const isExpanded = expanded.has(group.url)
        const hasDuplicates = group.bookmarks.length > 1

        return (
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {hasDuplicates ? (
                <button
                  type="button"
                  onClick={() => onToggleExpanded(group.url)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
                  title={isExpanded ? 'Collapse duplicates' : 'Expand duplicates'}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : null}
              <a
                href={top.url}
                target="_blank"
                rel="noreferrer"
                className="flex max-w-xs min-w-0 items-center gap-1.5 truncate text-foreground hover:text-primary hover:underline"
                title={top.url}
              >
                <span className="truncate">{top.title}</span>
                {semanticScores.has(top.url) && (
                  <span className="shrink-0 rounded bg-emerald-600/20 px-1 py-0.5 text-[10px] text-emerald-300">
                    {Math.round((semanticScores.get(top.url) ?? 0) * 100)}%
                  </span>
                )}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
              </a>
            </div>
            {hasDuplicates && isExpanded && (
              <div className="ml-7 space-y-1 rounded border border-border/60 bg-card/30 p-2">
                {group.bookmarks.slice(1).map((bookmark) => (
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
                      onClick={() => onDelete(bookmark.id)}
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
      id: 'domain',
      accessorFn: (row) => row.representative.domain,
      header: 'Domain',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.representative.domain}</span>
      ),
    },
    {
      id: 'folder',
      accessorFn: (row) => row.representative.folder,
      header: 'Folder',
      cell: ({ row }) => (
        <span className="max-w-[160px] truncate text-xs text-muted-foreground" title={row.original.representative.folder}>
          {row.original.representative.folder || '—'}
        </span>
      ),
    },
    {
      id: 'category',
      accessorFn: (row) => row.representative.category ?? '',
      header: 'Category',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.representative.category ?? <span className="opacity-30">—</span>}
        </span>
      ),
    },
    {
      id: 'intent',
      header: 'Intent',
      accessorFn: (row) => row.representative.intent ?? '',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm" title={row.original.representative.intent ?? ''}>
          {row.original.representative.intent ? INTENT_EMOJI[row.original.representative.intent] : <span className="opacity-30">—</span>}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.representative.isOpen && (
            <Badge variant="accent" className="text-[10px]">open</Badge>
          )}
          {row.original.duplicateCount > 0 && (
            <Badge variant="muted" className="text-[10px]">×{row.original.bookmarks.length}</Badge>
          )}
        </div>
      ),
    },
    {
      id: 'dateAdded',
      accessorFn: (row) => row.representative.dateAdded,
      header: 'Added',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.representative.dateAdded)}
        </span>
      ),
    },
    {
      id: 'lastVisited',
      accessorFn: (row) => row.representative.lastVisited ?? 0,
      header: 'Last visited',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.representative.lastVisited
            ? formatAge(row.original.representative.lastVisited)
            : <span className="opacity-30">never</span>}
        </span>
      ),
    },
    {
      id: 'visitCount',
      accessorFn: (row) => row.representative.visitCount ?? 0,
      header: 'Visits',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.representative.visitCount ?? <span className="opacity-30">—</span>}
        </span>
      ),
    },
    {
      id: 'tags',
      header: 'Tags',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.representative.tags?.length
            ? row.original.representative.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
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
            href={row.original.representative.url}
            target="_blank"
            rel="noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-primary"
            title="Open"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
            title="Delete bookmark"
            onClick={() => onDelete(row.original.representative.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ]
}

interface BookmarksTableProps {
  data: BookmarkItem[]
  settings: LlmSettings
  loading?: boolean
  onDelete: (id: string) => void
  onExport?: () => Promise<void>
  menuHost?: HTMLElement | null
}

export function BookmarksTable({ data, settings, loading, onDelete, onExport, menuHost }: BookmarksTableProps) {
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

  const filteredBookmarks = useMemo(() => {
    if (!query.trim()) return data
    const needle = query.trim().toLowerCase()
    const lexicalMatch = (item: BookmarkItem) =>
      item.title.toLowerCase().includes(needle) ||
      item.url.toLowerCase().includes(needle) ||
      item.domain.toLowerCase().includes(needle) ||
      (item.category ?? '').toLowerCase().includes(needle) ||
      item.folder.toLowerCase().includes(needle)

    if (!semanticEnabled) return data.filter(lexicalMatch)

    const merged = data.filter((item) => lexicalMatch(item) || semanticScores.has(item.url))
    return merged.sort((a, b) => {
      const sb = semanticScores.get(b.url) ?? -1
      const sa = semanticScores.get(a.url) ?? -1
      if (sa !== sb) return sb - sa
      return b.dateAdded - a.dateAdded
    })
  }, [data, query, semanticEnabled, semanticScores])

  const groupedData = useMemo(() => groupByUrl(filteredBookmarks), [filteredBookmarks])

  const onToggleExpanded = (url: string) => {
    setExpandedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const columns = useMemo(
    () => makeColumns(onDelete, semanticScores, expandedUrls, onToggleExpanded),
    [onDelete, semanticScores, expandedUrls],
  )

  const hasCategories = data.some((b) => b.category)

  const toolbar = (
    <div className="flex items-center gap-2">
      {hasCategories && onExport && (
        <button
          type="button"
          onClick={onExport}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          title="Export categorized bookmarks to Chrome folders"
        >
          <FolderOutput className="h-3.5 w-3.5" />
          Export to folders
        </button>
      )}
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

  const initialSorting: SortingState = [{ id: 'dateAdded', desc: true }]

  return (
    <DataTable
      columns={columns}
      data={groupedData}
      searchPlaceholder={semanticEnabled ? 'Search bookmarks (lexical + semantic)…' : 'Search bookmarks…'}
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
  if (settings.tasks.embedding.provider === 'transformers') return true
  if (settings.tasks.embedding.provider === 'lmstudio') {
    return Boolean(settings.providers.lmstudio.baseUrl && settings.tasks.embedding.model)
  }
  return Boolean(settings.providers.openrouter.apiKey && settings.tasks.embedding.model)
}
