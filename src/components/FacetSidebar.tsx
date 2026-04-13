import { SourceFilterToggle } from '@/components/SourceFilter'
import type { SourceFilter } from '@/components/views/types'
import { cn } from '@/lib/utils'

interface FacetItem {
  value: string
  count: number
}

interface FacetSidebarProps {
  sourceFilter: SourceFilter
  onSourceFilterChange: (value: SourceFilter) => void
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

  return (
    <div
      className="ml-6 flex h-full flex-col border-r border-border bg-background"
      style={{ width }}
    >
      <div className="shrink-0 border-b border-border px-2 py-2">
        <SourceFilterToggle value={sourceFilter} onChange={onSourceFilterChange} />
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

