import { cn } from '@/lib/utils'
import type { SourceFilter } from '@/components/views/types'

interface SourceFilterProps {
  value: SourceFilter
  onChange: (value: SourceFilter) => void
  counts?: {
    bookmarks: number
    tabs: number
  }
}

export function SourceFilterToggle({ value, onChange, counts }: SourceFilterProps) {
  const options: Array<{ id: SourceFilter; label: string; count: number | null }> = [
    { id: 'bookmarks', label: 'Bookmarks', count: counts ? counts.bookmarks : null },
    { id: 'tabs', label: 'Tabs', count: counts ? counts.tabs : null },
    { id: 'both', label: 'Both', count: counts ? counts.bookmarks + counts.tabs : null },
  ]

  return (
    <div className="flex items-center">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            'rounded px-2 py-0.5 text-xs transition-colors',
            value === option.id ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
          {option.count != null && (
            <sup className="ml-0.5 tabular-nums text-[10px] opacity-70">{option.count}</sup>
          )}
        </button>
      ))}
    </div>
  )
}
