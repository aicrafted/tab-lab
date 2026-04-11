import { cn } from '@/lib/utils'
import type { ViewId } from '@/components/views/types'

export const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: 'list', label: 'List', hint: 'Classic table with sorting and filters' },
  { id: 'triage', label: 'Triage', hint: 'What needs attention: dead links, never visited, duplicates, stale' },
  { id: 'kanban', label: 'Kanban', hint: 'Columns by AI category - drag cards between them' },
  { id: 'timeline', label: 'Timeline', hint: 'Horizontal time axis - see when you bookmarked and visited' },
  { id: 'magazine', label: 'Magazine', hint: 'Editorial grid with thumbnails and summaries' },
  { id: 'treemap', label: 'Treemap', hint: 'Hierarchical area chart - category to domain to pages' },
  { id: 'semantic', label: 'Semantic Map', hint: '2D embedding projection - semantically similar pages cluster together' },
  { id: 'heatmap', label: 'Activity Heatmap', hint: 'GitHub-style calendar of your browsing activity' },
  { id: 'domain-graph', label: 'Domain Graph', hint: 'Nodes are domains, edges are co-visited sessions' },
  { id: 'reading-queue', label: 'Reading Queue', hint: 'Pages you saved to read later, sorted by reading time' },
  { id: 'tag-constellation', label: 'Tag Constellation', hint: 'Tags as stars, pages as lines connecting them' },
  { id: 'personal-radar', label: 'Personal Radar', hint: "Spider chart of your collection's profile across zones" },
  { id: 'topic-river', label: 'Topic River', hint: 'Stream graph of categories over time' },
  { id: 'domain-drill-down', label: 'Domain Drill-Down', hint: 'Drill into domain structures like owner/repo and subreddit' },
  { id: 'focus-rings', label: 'Focus Rings', hint: "Concentric rings from hot to forgotten pages" },
  { id: 'tag-cooccurrence', label: 'Tag Co-occurrence', hint: 'Tag pair matrix for overlap frequency' },
  { id: 'shelf-view', label: 'Shelf', hint: 'Library shelf metaphor by category and reading time' },
  { id: 'overlap-explorer', label: 'Overlap Explorer', hint: 'Venn-style intersections across tabs/bookmarks/tags' },
  { id: 'shadow-map', label: 'Shadow Map', hint: 'Duplicate and near-duplicate groups by semantic similarity' },
  { id: 'session-story', label: 'Session Story', hint: 'Chronological rabbit-hole chains from browsing sessions' },
]

export const VIEW_HINTS: Record<ViewId, string> = Object.fromEntries(
  VIEWS.map((view) => [view.id, view.hint]),
) as Record<ViewId, string>

interface ViewBarProps {
  activeView: ViewId
  onChange: (view: ViewId) => void
}

export function ViewBar({ activeView, onChange }: ViewBarProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <div className="flex min-w-max items-center gap-1 p-1.5">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            title={view.hint}
            onClick={() => onChange(view.id)}
            className={cn(
              'whitespace-nowrap rounded px-2.5 py-1 text-xs transition-colors',
              activeView === view.id
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-background hover:text-foreground',
            )}
          >
            {view.label}
          </button>
        ))}
      </div>
    </div>
  )
}

