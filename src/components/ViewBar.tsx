import { cn } from '@/lib/core/utils'
import type { ViewId } from '@/components/views/types'
import { ACTIVE_BUILD } from '@/lib/core/constants'

export const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: 'table', label: 'Table', hint: 'Classic table with sorting and filters' },
  { id: 'list', label: 'List', hint: 'Grouped list layout by category, folder, domain, or source' },
  { id: 'triage', label: 'Triage', hint: 'What needs attention: dead links, never visited, duplicates, stale' },
  { id: 'kanban', label: 'Kanban', hint: 'Columns by AI category - drag cards between them' },
  { id: 'timeline', label: 'Timeline', hint: 'Horizontal time axis and activity summary - see when you bookmarked and visited' },
  { id: 'domain-graph', label: 'Domain Graph', hint: 'Nodes are domains, edges are co-visited sessions' },
  { id: 'reading-queue', label: 'Reading Queue', hint: 'Pages you saved to read later, sorted by reading time' },
  { id: 'tag-constellation', label: 'Tag Constellation', hint: 'Tags as stars, pages as lines connecting them' },
  { id: 'personal-radar', label: 'Personal Radar', hint: "Spider chart of your collection's profile across zones" },
  {
    id: 'topic-river',
    label: 'Topic River',
    hint: 'Shows how interests evolve over time as one continuous stream: the horizontal axis is time, stacked layers are categories/tags, and layer thickness at each point reflects how many pages were active in that period. Use drag to select zoom, drag on the bottom axis to pan, wheel to zoom in/out, click legend items to hide/show groups, and click a layer segment to open pages for that time slice.',
  },
  { id: 'domain-drill-down', label: 'Domain Drill-Down', hint: 'Drill into domain structures like owner/repo and subreddit' },
  { id: 'focus-rings', label: 'Focus Rings', hint: "Concentric rings from hot to forgotten pages" },
  { id: 'tag-cooccurrence', label: 'Tag Co-occurrence', hint: 'Tag pair matrix for overlap frequency' },
  { id: 'shelf-view', label: 'Shelf', hint: 'Library shelf metaphor by category and reading time' },
  { id: 'overlap-explorer', label: 'Overlap Explorer', hint: 'Venn-style intersections across tabs/bookmarks/tags' },
  { id: 'shadow-map', label: 'Shadow Map', hint: 'Duplicate and near-duplicate groups by semantic similarity' },
  { id: 'session-story', label: 'Session Story', hint: 'Chronological rabbit-hole chains from browsing sessions' },
  { id: 'settings-llm', label: 'Models & Providers', hint: 'Configure LLM and Embedding providers (OpenRouter, LM Studio, etc.)' },
  { id: 'settings-knowledge', label: 'Knowledge Base', hint: 'Manage domain pre-fill knowledge and site descriptions' },
  { id: 'settings-advanced', label: 'Advanced Settings', hint: 'Network patterns, cache management, and performance' },
  { id: 'magazine', label: 'Magazine', hint: 'Rich grid view with large previews and extracted summaries' },
  { id: 'treemap', label: 'Treemap', hint: 'Hierarchical area map of categories and disk space' },
  { id: 'semantic', label: 'Semantic Map', hint: '2D projection of pages based on AI semantic similarity' },
]

export const VIEW_HINTS: Record<ViewId, string> = Object.fromEntries(
  VIEWS.map((view) => [view.id, view.hint]),
) as Record<ViewId, string>

const VIEW_GROUPS: Array<{ id: string; label: string; hint: string; views: ViewId[] }> = [
  {
    id: 'basic',
    label: 'Basic',
    hint: 'Core working views for everyday sorting and cleanup.',
    views: ['table', 'list', 'triage', 'kanban', 'reading-queue', 'shelf-view'],
  },
  {
    id: 'domains-tags-intents',
    label: 'Domains and labels',
    hint: 'Relationship and structure views across domains, tags and clusters.',
    views: ['domain-drill-down', 'domain-graph', 'overlap-explorer', 'tag-cooccurrence', 'tag-constellation', 'treemap'],
  },
  {
    id: 'semantic',
    label: 'Semantic',
    hint: 'Embedding-driven maps and semantic neighborhood exploration.',
    views: ['semantic', 'personal-radar', 'shadow-map'],
  },
  {
    id: 'history',
    label: 'History',
    hint: 'Timeline and activity-oriented representations over time.',
    views: ['timeline', 'session-story', 'topic-river', 'focus-rings'],
  },
  {
    id: 'net-heavy',
    label: 'Net-heavy',
    hint: 'Views that rely more on remote assets/content.',
    views: ['magazine'],
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'Application configuration and AI settings.',
    views: ['settings-llm', 'settings-knowledge', 'settings-advanced'],
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
  const activeIdToUse = GROUP_BY_VIEW[activeView] ?? VIEW_GROUPS[0].id
  const activeGroup = VIEW_GROUPS.find((group) => group.id === activeIdToUse) ?? VIEW_GROUPS[0]

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max flex-col gap-0 pb-2">
        <div className="flex items-center gap-1">
          {VIEW_GROUPS.map((group) => {
            const filteredGroupViews = group.views.filter(v => !ACTIVE_BUILD.views.hide.includes(v))
            if (filteredGroupViews.length === 0) return null

            const isActive = group.id === activeIdToUse
            const isSettingsGroup = group.id === 'settings'

            return (
              <button
                key={group.id}
                type="button"
                title={group.hint}
                onClick={() => onChange(filteredGroupViews[0])}
                className={cn(
                  'whitespace-nowrap rounded-t-md rounded-b-none border-b-2 px-2.5 py-1 text-base transition-colors',
                  isActive
                    ? 'border-primary text-primary font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                  isSettingsGroup && 'ml-auto',
                )}
              >
                {group.label}
              </button>
            )
          })}
        </div>

        <div className="border-t border-primary/50 bg-primary/10 px-2 py-1.5">
          <div className="flex items-center gap-1">
          {activeGroup.views.filter(v => !ACTIVE_BUILD.views.hide.includes(v)).map((viewId) => {
            const view = VIEW_BY_ID[viewId]
            if (!view) return null
            return (
              <button
                key={view.id}
                type="button"
                title={view.hint}
                onClick={() => onChange(view.id)}
                className={cn(
                  'whitespace-nowrap rounded px-2.5 py-1 text-sm transition-colors',
                  activeView === view.id
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
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
