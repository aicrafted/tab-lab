import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { ChevronDown, ChevronRight, ExternalLink, Trash2 } from 'lucide-react'
import { DataTable } from './DataTable'
import { IntentIcon } from './IntentIcon'
import { Badge } from '@/components/ui/badge'
import { Favicon } from './Favicon'
import { effectiveIntent } from '@/lib/ai/static-intent'
import type { BookmarkItem, LlmSettings } from '@/lib/core/types'
import { cn, formatDate, formatAge } from '@/lib/core/utils'
import { useSemanticSearch } from '@/hooks/useSemanticSearch'
const STALE_BOOKMARK_MS = 180 * 86_400_000
const isStaleBookmark = (bookmark: BookmarkItem, now: number) => {
  const marker = bookmark.lastVisited ?? bookmark.dateAdded
  return marker < now - STALE_BOOKMARK_MS
}

const BOOKMARK_TRIAGE_PREDICATES: Record<string, (b: BookmarkItem) => boolean> = {
  duplicates: (b) => b.isDuplicate === true,
  'never-opened': (b) => b.lastVisited == null && b.visitCount == null,
  transactional: (b) => effectiveIntent(b) === 'transactional',
  'open-now': (b) => b.isOpen === true,
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
  localUrlSet: Set<string>,
  expanded: Set<string>,
  onToggleExpanded: (url: string) => void,
): ColumnDef<BookmarkGroupRow>[] {
  return [
    {
      id: 'title',
      header: 'Title',
      accessorFn: (row) => row.representative.title,
      cell: ({ row }) => {
        const group = row.original
        const top = group.representative
        const isExpanded = expanded.has(group.url)
        const hasDuplicates = group.bookmarks.length > 1
        const isLocal = localUrlSet.has(top.url)
        const intent = effectiveIntent(top)

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
              <Favicon domain={top.domain} />
              <a
                href={top.url}
                target="_blank"
                rel="noreferrer"
                className="flex w-full min-w-0 items-center gap-1.5 truncate text-foreground hover:text-primary hover:underline"
                title={top.url}
              >
                {top.title}
                {semanticScores.has(top.url) && (
                  <span className="shrink-0 rounded bg-emerald-600/20 px-1 py-0.5 text-[10px] text-emerald-300">
                    {Math.round((semanticScores.get(top.url) ?? 0) * 100)}%
                  </span>
                )}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
              </a>
            </div>
            <div className="text-xs text-muted-foreground/65">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span title={intent ?? ''}>
                  <IntentIcon intent={intent} className="h-3 w-3" />
                </span>
                {isLocal && (
                  <Badge variant="outline" className="rounded text-[10px] opacity-70">LAN</Badge>
                )}
                <a
                  href={top.url}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[220px] truncate hover:text-foreground hover:underline"
                  title={top.url}
                >
                  {top.domain}
                </a>
                <span aria-hidden="true" className="opacity-40">·</span>
                <span className="max-w-[220px] truncate" title={top.folder}>
                  {top.folder || '—'}
                </span>
              </span>
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
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex gap-1 whitespace-nowrap">
          {row.original.representative.isOpen && (
            <Badge variant="outline" className="rounded border-border/70 bg-card/40 text-[10px] text-muted-foreground">open</Badge>
          )}
          {row.original.duplicateCount > 0 && (
            <Badge variant="muted" className="rounded text-[10px]">×{row.original.bookmarks.length}</Badge>
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
  localUrlSet: Set<string>
  triageFilter: string | null
  multiFolderUrls: Set<string>
  settings: LlmSettings
  loading?: boolean
  onDelete: (id: string) => void
  menuHost?: HTMLElement | null
}

export function BookmarksTable({
  data,
  localUrlSet,
  triageFilter,
  multiFolderUrls,
  settings,
  loading,
  onDelete,
  menuHost,
}: BookmarksTableProps) {
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
  const triageGroupedData = useMemo(() => {
    if (!triageFilter) return groupedData
    const now = Date.now()
    if (triageFilter === 'multi-folder') {
      return groupedData.filter((group) => multiFolderUrls.has(group.representative.url))
    }
    if (triageFilter === 'stale') {
      return groupedData.filter((group) => isStaleBookmark(group.representative, now))
    }
    const predicate = BOOKMARK_TRIAGE_PREDICATES[triageFilter]
    return predicate ? groupedData.filter((group) => predicate(group.representative)) : groupedData
  }, [groupedData, triageFilter, multiFolderUrls])

  const onToggleExpanded = (url: string) => {
    setExpandedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const columns = useMemo(
    () => makeColumns(onDelete, semanticScores, localUrlSet, expandedUrls, onToggleExpanded),
    [onDelete, semanticScores, localUrlSet, expandedUrls],
  )

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

  const initialSorting: SortingState = [{ id: 'dateAdded', desc: true }]

  return (
    <DataTable
      columns={columns}
      data={triageGroupedData}
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
  if (settings.tasks.embedding.provider === 'browser-ml') return true
  if (settings.tasks.embedding.provider === 'lmstudio') {
    return Boolean(settings.providers.lmstudio.baseUrl && settings.providers.lmstudio.embeddingModel)
  }
  return Boolean(settings.providers.openrouter.apiKey && settings.providers.openrouter.embeddingModel)
}
