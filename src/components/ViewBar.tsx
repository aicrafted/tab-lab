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

const VIEW_GROUPS: Array<{ id: string; label: string; hint: string; views: ViewId[] }> = [
  {
    id: 'basic',
    label: 'Basic',
    hint: 'Core working views for everyday sorting and cleanup.',
    views: ['list', 'triage', 'kanban', 'reading-queue', 'shelf-view'],
  },
  {
    id: 'domains-tags-intents',
    label: 'Domains, tags, intents',
    hint: 'Relationship and structure views across domains, tags and clusters.',
    views: ['domain-drill-down', 'domain-graph', 'overlap-explorer', 'tag-cooccurrence', 'tag-constellation', 'treemap'],
  },
  {
    id: 'semantic',
    label: 'Semantic',
    hint: 'Embedding-driven maps and semantic neighborhood exploration.',
    views: ['personal-radar', 'semantic', 'shadow-map'],
  },
  {
    id: 'history',
    label: 'History',
    hint: 'Timeline and activity-oriented representations over time.',
    views: ['heatmap', 'focus-rings', 'session-story', 'timeline', 'topic-river'],
  },
  {
    id: 'net-heavy',
    label: 'Net-heavy',
    hint: 'Views that rely more on remote assets/content.',
    views: ['magazine'],
  },
]

const VIEW_BY_ID: Record<ViewId, { id: ViewId; label: string; hint: string }> = Object.fromEntries(
  VIEWS.map((view) => [view.id, view]),
) as Record<ViewId, { id: ViewId; label: string; hint: string }>

const GROUP_BY_VIEW: Record<ViewId, string> = Object.fromEntries(
  VIEW_GROUPS.flatMap((group) => group.views.map((viewId) => [viewId, group.id])),
) as Record<ViewId, string>

interface ViewBarProps {
  activeView: ViewId
  onChange: (view: ViewId) => void
}

export function ViewBar({ activeView, onChange }: ViewBarProps) {
  const activeGroupId = GROUP_BY_VIEW[activeView] ?? VIEW_GROUPS[0].id
  const activeGroup = VIEW_GROUPS.find((group) => group.id === activeGroupId) ?? VIEW_GROUPS[0]

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max flex-col gap-1.5 pb-2">
        <div className="flex items-center gap-1">
          {VIEW_GROUPS.map((group) => {
            const isActive = group.id === activeGroup.id
            return (
              <button
                key={group.id}
                type="button"
                title={group.hint}
                onClick={() => onChange(group.views[0])}
                className={cn(
                  'whitespace-nowrap rounded-t-md border-b-2 px-2.5 py-1 text-sm transition-colors',
                  isActive
                    ? 'border-primary/70 bg-primary/10 text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-background hover:text-foreground',
                )}
              >
                {group.label}
              </button>
            )
          })}
        </div>

        <div className="rounded-md border border-border/60 bg-background/55 px-2 py-1.5">
          <div className="flex items-center gap-1">
          {activeGroup.views.map((viewId) => {
            const view = VIEW_BY_ID[viewId]
            return (
              <button
                key={view.id}
                type="button"
                title={view.hint}
                onClick={() => onChange(view.id)}
                className={cn(
                  'whitespace-nowrap rounded px-2.5 py-1 text-xs transition-colors',
                  activeView === view.id
                    ? 'bg-primary/20 text-primary ring-1 ring-primary/35'
                    : 'text-muted-foreground hover:bg-background hover:text-foreground',
                )}
              >
                {view.label}
              </button>
            )
          })}
          </div>
        </div>
      </div>
    </div>
  )
}
