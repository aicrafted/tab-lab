import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { ExternalLink, X } from 'lucide-react'
import { DataTable } from './DataTable'
import { Badge } from '@/components/ui/badge'
import { Favicon } from './Favicon'
import { cn } from '@/lib/utils'
import type { TabItem, PageIntent, LlmSettings } from '@/lib/types'
import { formatAge } from '@/lib/utils'
import { useSemanticSearch } from '@/hooks/useSemanticSearch'

const INTENT_EMOJI: Record<PageIntent, string> = {
  article: '📄', reference: '📚', tool: '🔧', service: '🌐',
  transactional: '🎫', video: '🎬', social: '💬', repository: '📦', other: '•',
}

// Zombie threshold — tabs not accessed in N days
const ZOMBIE_DAYS = 7

// Chrome tab group color → Tailwind class mapping
const GROUP_COLORS: Record<string, string> = {
  blue:   'bg-blue-900/40 text-blue-300',
  red:    'bg-rose-900/40 text-rose-300',
  yellow: 'bg-yellow-900/40 text-yellow-300',
  green:  'bg-green-900/40 text-green-300',
  pink:   'bg-pink-900/40 text-pink-300',
  purple: 'bg-purple-900/40 text-purple-300',
  cyan:   'bg-cyan-900/40 text-cyan-300',
  orange: 'bg-orange-900/40 text-orange-300',
  grey:   'bg-zinc-800 text-zinc-400',
}

function makeColumns(
  onClose: (id: number) => void,
  onActivate: (id: number) => void,
  semanticScores: Map<string, number>,
): ColumnDef<TabItem>[] {
  return [
    {
      id: 'favicon',
      header: '',
      enableSorting: false,
      size: 24,
      cell: ({ row }) => (
        <Favicon domain={row.original.domain} src={row.original.favIconUrl} />
      ),
    },
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onActivate(row.original.id)}
          className="flex max-w-xs items-center gap-1.5 truncate text-left text-foreground hover:text-primary hover:underline"
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
      accessorKey: 'domain',
      header: 'Domain',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.domain}</span>
      ),
    },
    {
      accessorKey: 'windowId',
      header: 'Window',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">#{row.original.windowId}</span>
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
      cell: ({ row }) => {
        const isZombie =
          Date.now() - row.original.lastAccessed > ZOMBIE_DAYS * 86_400_000
        return (
          <div className="flex flex-wrap gap-1">
            {row.original.groupName && (
              <Badge
                className={cn('text-[10px]', GROUP_COLORS[row.original.groupColor ?? 'grey'])}
              >
                {row.original.groupName}
              </Badge>
            )}
            {row.original.isBookmarked && (
              <Badge variant="primary" className="text-[10px]" title={row.original.bookmarkFolder}>
                saved
              </Badge>
            )}
            {row.original.duplicateCount && (
              <Badge variant="muted" className="text-[10px]">
                ×{row.original.duplicateCount}
              </Badge>
            )}
            {row.original.isDuplicate && (
              <Badge variant="muted" className="text-[10px] opacity-50">dup</Badge>
            )}
            {isZombie && (
              <Badge variant="outline" className="text-[10px] opacity-60">zombie</Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'lastAccessed',
      header: 'Last accessed',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatAge(row.original.lastAccessed)}
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
          <button
            type="button"
            onClick={() => onActivate(row.original.id)}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-primary"
            title="Switch to tab"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
            title="Close tab"
            onClick={() => onClose(row.original.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ]
}

interface TabsTableProps {
  data: TabItem[]
  settings: LlmSettings
  loading?: boolean
  onClose: (id: number) => void
  onActivate: (id: number) => void
  menuHost?: HTMLElement | null
}

export function TabsTable({ data, settings, loading, onClose, onActivate, menuHost }: TabsTableProps) {
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
    const lexicalMatch = (item: TabItem) =>
      item.title.toLowerCase().includes(needle) ||
      item.url.toLowerCase().includes(needle) ||
      item.domain.toLowerCase().includes(needle) ||
      (item.category ?? '').toLowerCase().includes(needle)

    const merged = data.filter(item => lexicalMatch(item) || semanticScores.has(item.url))
    return merged.sort((a, b) => {
      const sb = semanticScores.get(b.url) ?? -1
      const sa = semanticScores.get(a.url) ?? -1
      if (sa !== sb) return sb - sa
      return b.lastAccessed - a.lastAccessed
    })
  }, [data, query, semanticEnabled, semanticScores])

  const columns = useMemo(
    () => makeColumns(onClose, onActivate, semanticScores),
    [onClose, onActivate, semanticScores],
  )

  const toolbar = (
    <div className="flex items-center gap-2">
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

  const initialSorting: SortingState = [{ id: 'lastAccessed', desc: true }]

  return (
    <DataTable
      columns={columns}
      data={filteredData}
      searchKey={semanticEnabled ? undefined : 'title'}
      searchPlaceholder={semanticEnabled ? 'Search tabs (lexical + semantic)…' : 'Search tabs…'}
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
