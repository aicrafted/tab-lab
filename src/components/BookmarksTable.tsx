import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { ExternalLink, FolderOutput, Trash2 } from 'lucide-react'
import { DataTable } from './DataTable'
import { Badge } from '@/components/ui/badge'
import { Favicon } from './Favicon'
import type { BookmarkItem, PageIntent, LlmSettings } from '@/lib/types'
import { formatDate, formatAge } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useSemanticSearch } from '@/hooks/useSemanticSearch'

const INTENT_EMOJI: Record<PageIntent, string> = {
  article: '📄', reference: '📚', tool: '🔧', service: '🌐',
  transactional: '🎫', video: '🎬', social: '💬', repository: '📦', other: '•',
}

function makeColumns(
  onDelete: (id: string) => void,
  semanticScores: Map<string, number>,
): ColumnDef<BookmarkItem>[] {
  return [
    {
      id: 'favicon',
      header: '',
      enableSorting: false,
      size: 24,
      cell: ({ row }) => <Favicon domain={row.original.domain} />,
    },
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <a
          href={row.original.url}
          target="_blank"
          rel="noreferrer"
          className="flex max-w-xs items-center gap-1.5 truncate text-foreground hover:text-primary hover:underline"
          title={row.original.url}
        >
          <span className="truncate">{row.original.title}</span>
          {semanticScores.has(row.original.url) && (
            <span className="shrink-0 rounded bg-emerald-600/20 px-1 py-0.5 text-[10px] text-emerald-300">
              {Math.round((semanticScores.get(row.original.url) ?? 0) * 100)}%
            </span>
          )}
          <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
        </a>
      ),
    },
    {
      accessorKey: 'domain',
      header: 'Domain',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.domain}</span>
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
      cell: ({ row }) => (
        <span className="text-sm" title={row.original.intent ?? ''}>
          {row.original.intent ? INTENT_EMOJI[row.original.intent] : <span className="opacity-30">—</span>}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.isOpen && (
            <Badge variant="accent" className="text-[10px]">open</Badge>
          )}
          {row.original.isDuplicate && (
            <Badge variant="muted" className="text-[10px]">dup</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'dateAdded',
      header: 'Added',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.dateAdded)}
        </span>
      ),
    },
    {
      accessorKey: 'lastVisited',
      header: 'Last visited',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.lastVisited
            ? formatAge(row.original.lastVisited)
            : <span className="opacity-30">never</span>}
        </span>
      ),
    },
    {
      accessorKey: 'visitCount',
      header: 'Visits',
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.visitCount ?? 0
        const b = rowB.original.visitCount ?? 0
        return a - b
      },
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
          {row.original.tags?.length
            ? row.original.tags.map(tag => (
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
            href={row.original.url}
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
            onClick={() => onDelete(row.original.id)}
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

  const filteredData = useMemo(() => {
    if (!semanticEnabled || !query.trim()) return data
    const needle = query.trim().toLowerCase()
    const lexicalMatch = (item: BookmarkItem) =>
      item.title.toLowerCase().includes(needle) ||
      item.url.toLowerCase().includes(needle) ||
      item.domain.toLowerCase().includes(needle) ||
      (item.category ?? '').toLowerCase().includes(needle) ||
      item.folder.toLowerCase().includes(needle)

    const merged = data.filter(item => lexicalMatch(item) || semanticScores.has(item.url))
    return merged.sort((a, b) => {
      const sb = semanticScores.get(b.url) ?? -1
      const sa = semanticScores.get(a.url) ?? -1
      if (sa !== sb) return sb - sa
      return b.dateAdded - a.dateAdded
    })
  }, [data, query, semanticEnabled, semanticScores])

  const columns = useMemo(() => makeColumns(onDelete, semanticScores), [onDelete, semanticScores])

  const hasCategories = data.some(b => b.category)

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
        onClick={() => setSemanticEnabled(v => !v)}
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
      data={filteredData}
      searchKey={semanticEnabled ? undefined : 'title'}
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
