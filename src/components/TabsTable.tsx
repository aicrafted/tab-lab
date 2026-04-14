import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { ChevronDown, ChevronRight, ExternalLink, X } from 'lucide-react'
import { DataTable } from './DataTable'
import { IntentIcon } from './IntentIcon'
import { Badge } from '@/components/ui/badge'
import { Favicon } from './Favicon'
import { effectiveIntent } from '@/lib/static-intent'
import { cn, formatAge } from '@/lib/utils'
import type { TabItem, LlmSettings } from '@/lib/types'
import { useSemanticSearch } from '@/hooks/useSemanticSearch'

const ZOMBIE_DAYS = 7

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

interface TabGroupRow {
  key: string
  url: string
  representative: TabItem
  tabs: TabItem[]
  duplicateCount: number
}

function groupByUrl(tabs: TabItem[]): TabGroupRow[] {
  const byUrl = new Map<string, TabItem[]>()
  for (const tab of tabs) {
    const existing = byUrl.get(tab.url)
    if (existing) existing.push(tab)
    else byUrl.set(tab.url, [tab])
  }

  return Array.from(byUrl.entries()).map(([url, group]) => {
    const sorted = [...group].sort((a, b) => b.lastAccessed - a.lastAccessed)
    return {
      key: url,
      url,
      representative: sorted[0],
      tabs: sorted,
      duplicateCount: sorted.length - 1,
    }
  })
}

function makeColumns(
  onClose: (id: number) => void,
  onActivate: (id: number) => void,
  semanticScores: Map<string, number>,
  expanded: Set<string>,
  onToggleExpanded: (url: string) => void,
): ColumnDef<TabGroupRow>[] {
  return [
    {
      id: 'title',
      header: 'Title',
      accessorFn: (row) => row.representative.title,
      cell: ({ row }) => {
        const group = row.original
        const top = group.representative
        const isExpanded = expanded.has(group.url)
        const hasDuplicates = group.tabs.length > 1
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
              <Favicon domain={top.domain} src={top.favIconUrl} />
              <button
                type="button"
                onClick={() => onActivate(top.id)}
                className="flex w-full min-w-0 items-center gap-1.5 truncate text-left text-foreground hover:text-primary hover:underline"
                title={top.url}
              >
                <span className="truncate">{top.title}</span>
                {semanticScores.has(top.url) && (
                  <span className="shrink-0 rounded bg-emerald-600/20 px-1 py-0.5 text-[10px] text-emerald-300">
                    {Math.round((semanticScores.get(top.url) ?? 0) * 100)}%
                  </span>
                )}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground/65">
              <span className="inline-flex items-center gap-1.5">
                <span title={intent ?? ''}>
                  <IntentIcon intent={intent} className="h-3 w-3" />
                </span>
                <span>#{top.windowId}</span>
                <span>{top.domain}</span>
              </span>
            </div>
            {hasDuplicates && isExpanded && (
              <div className="ml-7 space-y-1 rounded border border-border/60 bg-card/30 p-2">
                {group.tabs.slice(1).map((tab) => (
                  <div key={tab.id} className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => onActivate(tab.id)}
                      className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground hover:underline"
                      title={tab.url}
                    >
                      {tab.title}
                    </button>
                    <span className="shrink-0 text-muted-foreground/70">#{tab.windowId}</span>
                    <button
                      type="button"
                      onClick={() => onClose(tab.id)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
                      title="Close duplicate tab"
                    >
                      <X className="h-3 w-3" />
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
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => {
        const tab = row.original.representative
        const isZombie = Date.now() - tab.lastAccessed > ZOMBIE_DAYS * 86_400_000
        return (
          <div className="flex flex-wrap gap-1">
            {tab.isBookmarked && (
              <Badge variant="primary" className="text-[10px]" title={tab.bookmarkFolder}>
                saved
              </Badge>
            )}
            {row.original.duplicateCount > 0 && (
              <Badge variant="muted" className="text-[10px]">
                ×{row.original.tabs.length}
              </Badge>
            )}
            {isZombie && (
              <Badge variant="outline" className="text-[10px] opacity-60">zombie</Badge>
            )}
          </div>
        )
      },
    },
    {
      id: 'lastAccessed',
      accessorFn: (row) => row.representative.lastAccessed,
      header: 'Last accessed',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatAge(row.original.representative.lastAccessed)}
        </span>
      ),
    },
    {
      id: 'tags',
      header: 'Tags',
      enableSorting: false,
      cell: ({ row }) => {
        const tab = row.original.representative
        const hasTags = Boolean(tab.tags?.length)
        const hasGroup = Boolean(tab.groupName)
        return (
          <div className="flex flex-wrap gap-1">
            {tab.groupName && (
              <Badge className={cn('text-[10px]', GROUP_COLORS[tab.groupColor ?? 'grey'])}>
                {tab.groupName}
              </Badge>
            )}
            {tab.tags?.map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {!hasTags && !hasGroup && <span className="text-xs text-muted-foreground opacity-30">—</span>}
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-0.5 whitespace-nowrap">
          <button
            type="button"
            onClick={() => onActivate(row.original.representative.id)}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-primary"
            title="Switch to tab"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-destructive"
            title="Close tab"
            onClick={() => onClose(row.original.representative.id)}
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

  const filteredTabs = useMemo(() => {
    if (!query.trim()) return data
    const needle = query.trim().toLowerCase()
    const lexicalMatch = (item: TabItem) =>
      item.title.toLowerCase().includes(needle) ||
      item.url.toLowerCase().includes(needle) ||
      item.domain.toLowerCase().includes(needle) ||
      (item.category ?? '').toLowerCase().includes(needle)

    if (!semanticEnabled) return data.filter(lexicalMatch)

    const merged = data.filter((item) => lexicalMatch(item) || semanticScores.has(item.url))
    return merged.sort((a, b) => {
      const sb = semanticScores.get(b.url) ?? -1
      const sa = semanticScores.get(a.url) ?? -1
      if (sa !== sb) return sb - sa
      return b.lastAccessed - a.lastAccessed
    })
  }, [data, query, semanticEnabled, semanticScores])

  const groupedData = useMemo(() => groupByUrl(filteredTabs), [filteredTabs])

  const onToggleExpanded = (url: string) => {
    setExpandedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const columns = useMemo(
    () => makeColumns(onClose, onActivate, semanticScores, expandedUrls, onToggleExpanded),
    [onClose, onActivate, semanticScores, expandedUrls],
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

  const initialSorting: SortingState = [{ id: 'lastAccessed', desc: true }]

  return (
    <DataTable
      columns={columns}
      data={groupedData}
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
