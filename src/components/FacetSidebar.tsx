import { SourceFilterToggle } from '@/components/SourceFilter'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import type { BookmarkFolderOption } from '@/lib/bookmarks'
import type { BookmarkScopeFilter } from '@/lib/types'
import type { SourceFilter } from '@/components/views/types'
import { cn } from '@/lib/utils'

interface FacetItem {
  value: string
  count: number
}

interface FacetSidebarProps {
  sourceFilter: SourceFilter
  onSourceFilterChange: (value: SourceFilter) => void
  allowedSourceFilters?: SourceFilter[]
  sourceCounts: {
    bookmarks: number
    tabs: number
  }
  bookmarkScopeFilter: BookmarkScopeFilter
  bookmarkFolderOptions: BookmarkFolderOption[]
  onBookmarkScopeChange: (value: BookmarkScopeFilter) => void
  domains: FacetItem[]
  categories: FacetItem[]
  activeMode: 'domains' | 'categories'
  activeValues: string[]
  onModeChange: (mode: 'domains' | 'categories') => void
  onToggle: (value: string) => void
  onClear: () => void
  width: number
}

export function FacetSidebar({
  sourceFilter,
  onSourceFilterChange,
  allowedSourceFilters,
  sourceCounts,
  bookmarkScopeFilter,
  bookmarkFolderOptions,
  onBookmarkScopeChange,
  domains,
  categories,
  activeMode,
  activeValues,
  onModeChange,
  onToggle,
  onClear,
  width,
}: FacetSidebarProps) {
  const items = activeMode === 'domains' ? domains : categories
  const showEmpty = activeMode === 'categories' && categories.length === 0
  const visibleFolderOptions = bookmarkFolderOptions.filter((option) => getMeaningfulParts(option.path).length > 0)
  const duplicateLeafTitles = buildDuplicateLeafTitleSet(visibleFolderOptions)
  const bookmarkScopeValue = bookmarkScopeFilter.mode === 'folder' && bookmarkScopeFilter.folderId
    ? bookmarkScopeFilter.folderId
    : 'root'
  const selectedFolder = bookmarkScopeValue === 'root'
    ? null
    : visibleFolderOptions.find((option) => option.id === bookmarkScopeValue)
      ?? bookmarkFolderOptions.find((option) => option.id === bookmarkScopeValue)
      ?? null
  const bookmarkScopeLabel = selectedFolder
    ? formatFolderPathForTrigger(selectedFolder.path)
    : 'Root (all bookmarks)'

  return (
    <div
      className="ml-6 flex h-full flex-col border-r border-border bg-background"
      style={{ width }}
    >
      <div className="shrink-0 border-b border-border pb-3">
        <div className="pr-2 pb-3">
          <Select
            value={bookmarkScopeValue}
            onValueChange={(value) => {
              if (value === 'root') {
                onBookmarkScopeChange({ mode: 'root' })
                return
              }
              const folder = bookmarkFolderOptions.find((option) => option.id === value)
              onBookmarkScopeChange({
                mode: 'folder',
                folderId: value,
                ...(folder ? { folderPath: folder.path } : {}),
              })
            }}
          >
            <SelectTrigger className="h-7 w-full max-w-full text-xs">
              <span className="truncate" title={selectedFolder?.path ?? 'Root (all bookmarks)'}>
                {bookmarkScopeLabel}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="root">Root (all bookmarks)</SelectItem>
              {visibleFolderOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <span
                    className="inline-block"
                    style={{ paddingLeft: `${Math.min(option.depth, 2) * 12}px` }}
                    title={option.path}
                  >
                    {formatFolderPathForOption(option.path, duplicateLeafTitles)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2">
          <SourceFilterToggle
            value={sourceFilter}
            onChange={onSourceFilterChange}
            allowedOptions={allowedSourceFilters}
            counts={sourceCounts}
          />
        </div>
      </div>

      <div className="flex shrink-0 border-b border-border">
        {(['domains', 'categories'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => onModeChange(mode)}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors',
              activeMode === mode
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mode === 'domains' ? 'Domains' : 'Categories'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showEmpty ? (
          <p className="p-4 text-xs text-muted-foreground">No categories yet</p>
        ) : (
          items.map(item => (
            <FacetRow
              key={item.value}
              value={item.value}
              count={item.count}
              active={activeValues.includes(item.value)}
              onClick={() => onToggle(item.value)}
            />
          ))
        )}
      </div>

      {activeValues.length > 0 && (
        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            onClick={onClear}
            className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
          >
            Clear ({activeValues.length})
          </button>
        </div>
      )}
    </div>
  )
}

function formatFolderPathForTrigger(path: string): string {
  const parts = getMeaningfulParts(path)
  if (parts.length === 0) return 'Root (all bookmarks)'
  if (parts.length === 1) return parts[0]
  return parts.slice(-2).join(' / ')
}

function formatFolderPathForOption(path: string, duplicateLeafTitles: Set<string>): string {
  const parts = getMeaningfulParts(path)
  if (parts.length === 0) return ''
  const leaf = parts[parts.length - 1]
  if (!duplicateLeafTitles.has(leaf)) return leaf
  if (parts.length === 1) return leaf
  return parts.slice(-2).join(' / ')
}

function buildDuplicateLeafTitleSet(options: BookmarkFolderOption[]): Set<string> {
  const counts = new Map<string, number>()
  for (const option of options) {
    const parts = getMeaningfulParts(option.path)
    if (parts.length === 0) continue
    const leaf = parts[parts.length - 1]
    counts.set(leaf, (counts.get(leaf) ?? 0) + 1)
  }
  const duplicates = new Set<string>()
  for (const [leaf, count] of counts.entries()) {
    if (count > 1) duplicates.add(leaf)
  }
  return duplicates
}

function getMeaningfulParts(path: string): string[] {
  return trimSystemRoot(path.split('/').filter(Boolean))
}

function trimSystemRoot(parts: string[]): string[] {
  if (parts.length === 0) return parts
  const first = parts[0].toLowerCase()
  const systemRoots = new Set([
    'bookmarks bar',
    'other bookmarks',
    'mobile bookmarks',
    'панель закладок',
    'другие закладки',
    'мобильные закладки',
  ])
  return systemRoots.has(first) ? parts.slice(1) : parts
}

function FacetRow({
  value,
  count,
  active,
  onClick,
}: {
  value: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-card',
        active && 'bg-card',
      )}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full transition-colors',
          active ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      />
      <span
        className={cn(
          'flex-1 truncate',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
        title={value}
      >
        {value}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground/60">
        {count}
      </span>
    </button>
  )
}
