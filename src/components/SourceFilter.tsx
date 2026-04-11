import { cn } from '@/lib/utils'
import type { SourceFilter } from '@/components/views/types'

interface SourceFilterProps {
  value: SourceFilter
  onChange: (value: SourceFilter) => void
}

export function SourceFilterToggle({ value, onChange }: SourceFilterProps) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-background/60 p-1">
      {(['bookmarks', 'tabs', 'both'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'rounded px-2 py-0.5 text-xs transition-colors',
            value === option ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option === 'bookmarks' ? 'Bookmarks' : option === 'tabs' ? 'Tabs' : 'Both'}
        </button>
      ))}
    </div>
  )
}

