import { useMemo, useState } from 'react'
import { SourceFilterToggle } from '@/components/SourceFilter'
import { Favicon } from '@/components/Favicon'
import { Input } from '@/components/ui/input'
import {
  Archive,
  AudioLines,
  BookMarked,
  BookOpen,
  Brain,
  Braces,
  Cloud,
  Code2,
  Database,
  File,
  FileText,
  FolderGit2,
  Globe,
  Image as ImageIcon,
  Mail,
  PlayCircle,
  Share2,
  Shield,
  Sparkles,
  Store,
  Video,
  Wrench,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import type { BookmarkFolderOption } from '@/lib/browser/bookmarks'
import type { BookmarkScopeFilter } from '@/lib/core/types'
import type { SourceFilter } from '@/components/views/types'
import { cn } from '@/lib/core/utils'

interface FacetItem {
  value: string
  count: number
}

function intentIcon(intent: string) {
  switch (intent) {
    case 'article':
      return FileText
    case 'reference':
      return BookOpen
    case 'tool':
      return Wrench
    case 'service':
      return Store
    case 'transactional':
      return Sparkles
    case 'repository':
      return FolderGit2
    case 'document':
      return File
    case 'image':
      return ImageIcon
    case 'audio':
      return AudioLines
    case 'video':
      return Video
    case 'archive':
      return Archive
    case 'data':
      return Database
    case 'code':
      return Code2
    default:
      return Sparkles
  }
}

function platformIcon(platform: string) {
  switch (platform) {
    case 'code':
      return Braces
    case 'social':
      return Share2
    case 'reference':
      return BookMarked
    case 'video':
      return PlayCircle
    case 'docs':
      return FileText
    case 'ai':
      return Brain
    case 'cloud':
      return Cloud
    case 'tool':
      return Wrench
    case 'email':
      return Mail
    case 'proxy':
      return Shield
    default:
      return Globe
  }
}

export interface CategoryChildFacet {
  name: string
  count: number
}

export interface CategoryGroupFacet {
  parent: string
  children: CategoryChildFacet[]
  totalCount: number
}

interface FacetSidebarProps {
  sourceFilter: SourceFilter
  onSourceFilterChange: (value: SourceFilter) => void
  triageFilter: string | null
  onTriageFilterChange: (value: string | null) => void
  triageChipCounts: Record<string, number>
  allowedSourceFilters?: SourceFilter[]
  sourceCounts: {
    bookmarks: number
    tabs: number
  }
  bookmarkScopeFilter: BookmarkScopeFilter
  bookmarkFolderOptions: BookmarkFolderOption[]
  onBookmarkScopeChange: (value: BookmarkScopeFilter) => void
  domains: FacetItem[]
  categories: CategoryGroupFacet[]
  intents: FacetItem[]
  platforms: FacetItem[]
  tags: FacetItem[]
  activeMode: 'domains' | 'categories' | 'universal'
  activeValues: string[]
  universalIntent: string | null
  universalPlatform: string | null
  universalTags: string[]
  onModeChange: (mode: 'domains' | 'categories' | 'universal') => void
  onToggle: (value: string) => void
  onUniversalIntentChange: (value: string | null) => void
  onUniversalPlatformChange: (value: string | null) => void
  onUniversalTagToggle: (value: string) => void
  onClear: () => void
  width: number
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

const BOOKMARK_CHIPS = [
  { id: 'duplicates', label: 'Duplicates', hint: 'Multiple bookmarks with the same URL' },
  { id: 'never-opened', label: 'Never opened', hint: 'Bookmarks you have never visited' },
  { id: 'transactional', label: 'Transactional', hint: 'Orders, bookings, tickets — safe to delete when done' },
  { id: 'stale', label: 'Stale', hint: 'Not visited in over 6 months' },
  { id: 'open-now', label: 'Open now', hint: 'URL is currently open in a tab' },
  { id: 'multi-folder', label: 'Multi-folder', hint: 'Saved in two or more bookmark folders' },
] as const

const TAB_CHIPS = [
  { id: 'duplicates', label: 'Duplicates', hint: 'Same URL open in multiple tabs' },
  { id: 'bookmarked', label: 'Bookmarked', hint: 'Already saved as a bookmark' },
  { id: 'transactional', label: 'Transactional', hint: 'Orders, bookings, tickets — safe to close when done' },
  { id: 'stale', label: 'Stale', hint: 'Not accessed in over 30 days' },
] as const

const BOTH_CHIPS = [
  { id: 'duplicates', label: 'Duplicates', hint: 'Duplicate URLs across bookmarks and open tabs' },
  { id: 'never-opened', label: 'Never opened', hint: 'Bookmarks you have never visited' },
  { id: 'transactional', label: 'Transactional', hint: 'Orders, bookings, tickets across bookmarks and tabs' },
  { id: 'stale', label: 'Stale', hint: 'Bookmarks not visited in 6+ months or tabs not accessed in 30+ days' },
  { id: 'open-now', label: 'Open now', hint: 'Bookmarked URL is currently open in a tab' },
  { id: 'multi-folder', label: 'Multi-folder', hint: 'Saved in two or more bookmark folders' },
  { id: 'bookmarked', label: 'Bookmarked', hint: 'Open tab URL already saved as a bookmark' },
] as const

export function FacetSidebar({
  sourceFilter,
  onSourceFilterChange,
  triageFilter,
  onTriageFilterChange,
  triageChipCounts,
  allowedSourceFilters,
  sourceCounts,
  bookmarkScopeFilter,
  bookmarkFolderOptions,
  onBookmarkScopeChange,
  domains,
  categories,
  intents,
  platforms,
  tags,
  activeMode,
  activeValues,
  universalIntent,
  universalPlatform,
  universalTags,
  onModeChange,
  onToggle,
  onUniversalIntentChange,
  onUniversalPlatformChange,
  onUniversalTagToggle,
  onClear,
  width,
  collapsed = false,
  onCollapsedChange,
}: FacetSidebarProps) {
  const showEmpty = activeMode === 'categories' && categories.length === 0
  const activeCount = activeMode === 'universal'
    ? (universalIntent ? 1 : 0) + (universalPlatform ? 1 : 0) + universalTags.length
    : activeValues.length
  const bookmarkScopeValue = bookmarkScopeFilter.mode === 'folder' && bookmarkScopeFilter.folderId
    ? bookmarkScopeFilter.folderId
    : 'root'
  const selectedFolder = bookmarkScopeValue === 'root'
    ? null
    : bookmarkFolderOptions.find((option) => option.id === bookmarkScopeValue) ?? null
  const bookmarkScopeLabel = selectedFolder
    ? selectedFolder.path
    : 'Root (all bookmarks)'
  const collapsedWidth = 40
  const visibleChips = useMemo(() => {
    if (sourceFilter === 'tabs') return TAB_CHIPS
    if (sourceFilter === 'bookmarks') return BOOKMARK_CHIPS
    return BOTH_CHIPS
  }, [sourceFilter])
  const showTriage = visibleChips.some((chip) => (triageChipCounts[chip.id] ?? 0) > 0)

  return (
    <div
      className="ml-6 relative h-full shrink-0 overflow-hidden border-r border-border bg-background transition-[width] duration-300 ease-out"
      style={{ width: collapsed ? collapsedWidth : width }}
    >
      <div
        className={cn(
          'absolute inset-0 flex flex-col transition-all duration-200 ease-out',
          collapsed ? 'pointer-events-none -translate-x-2 opacity-0' : 'translate-x-0 opacity-100',
        )}
      >
        <div className="shrink-0 border-b border-border pb-2">
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
              <SelectContent className="text-xs">
                <SelectItem value="root" className="py-0.5 px-2 text-xs">Root (all bookmarks)</SelectItem>
                {bookmarkFolderOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id} className="py-0.5 px-2 text-xs">
                    <span
                      className="inline-block truncate"
                      style={{ paddingLeft: `${option.depth * 12}px` }}
                      title={option.path}
                    >
                      {option.title}
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

        {showTriage && (
          <div className="shrink-0 border-b border-border py-2">
            <div className="flex flex-wrap gap-1">
              {visibleChips.map((chip) => (
                <TriageChip
                  key={chip.id}
                  label={chip.label}
                  hint={chip.hint}
                  active={triageFilter === chip.id}
                  count={triageChipCounts[chip.id] ?? 0}
                  onClick={() => onTriageFilterChange(triageFilter === chip.id ? null : chip.id)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="shrink-0 border-b border-border px-1 pt-1 pb-0">
          <div className="flex items-center justify-center">
            {(['domains', 'categories', 'universal'] as const).map((mode, index, all) => (
              <div key={mode} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onModeChange(mode)}
                  className={cn(
                    'border-b-2 border-transparent px-2.5 pt-1 pb-1 font-medium leading-none transition-colors',
                    activeMode === mode
                      ? 'border-primary text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode === 'domains'
                    ? 'Domains'
                    : mode === 'categories'
                      ? 'Categories'
                      : 'Labels'}
                </button>
                {index < all.length - 1 && (
                  <span className="mx-1 text-[10px] leading-none text-muted-foreground/45">·</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={cn('min-h-0 flex-1', activeMode === 'universal' ? 'overflow-hidden' : 'overflow-y-auto')}>
          {showEmpty ? (
            <p className="p-4 text-xs text-muted-foreground">
              No categories yet
            </p>
          ) : activeMode === 'categories' ? (
            <GroupedCategoryList
              groups={categories}
              activeValues={activeValues}
              onToggle={onToggle}
            />
          ) : activeMode === 'universal' ? (
            <UniversalFacetBlock
              intents={intents}
              platforms={platforms}
              tags={tags}
              selectedIntent={universalIntent}
              selectedPlatform={universalPlatform}
              selectedTags={universalTags}
              onIntentChange={onUniversalIntentChange}
              onPlatformChange={onUniversalPlatformChange}
              onTagToggle={onUniversalTagToggle}
            />
          ) : (
            domains.map(item => (
              <FacetRow
                key={item.value}
                value={item.value}
                count={item.count}
                showDomainIcon
                active={activeValues.includes(item.value)}
                onClick={() => onToggle(item.value)}
              />
            ))
          )}
        </div>

        {(activeCount > 0 || onCollapsedChange) && (
          <div className="shrink-0 border-t border-border p-2">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
              >
                Clear ({activeCount})
              </button>
            )}
            {onCollapsedChange && (
              <button
                type="button"
                onClick={() => onCollapsedChange(true)}
                className="mt-1.5 flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
                title="Collapse facets"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
                <span>Collapse facets</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div
        className={cn(
          'absolute inset-0 flex items-end justify-center pb-2 transition-all duration-200 ease-out',
          collapsed ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-2 opacity-0',
        )}
      >
        {onCollapsedChange && (
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
            title="Expand facets"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

function UniversalFacetBlock({
  intents,
  platforms,
  tags,
  selectedIntent,
  selectedPlatform,
  selectedTags,
  onIntentChange,
  onPlatformChange,
  onTagToggle,
}: {
  intents: FacetItem[]
  platforms: FacetItem[]
  tags: FacetItem[]
  selectedIntent: string | null
  selectedPlatform: string | null
  selectedTags: string[]
  onIntentChange: (value: string | null) => void
  onPlatformChange: (value: string | null) => void
  onTagToggle: (value: string) => void
}) {
  const [tagQuery, setTagQuery] = useState('')
  const selectedIntentItem = useMemo(
    () => intents.find((item) => item.value === selectedIntent) ?? null,
    [intents, selectedIntent],
  )
  const selectedPlatformItem = useMemo(
    () => platforms.find((item) => item.value === selectedPlatform) ?? null,
    [platforms, selectedPlatform],
  )
  const visibleTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase()
    const filtered = query
      ? tags.filter((item) => item.value.toLowerCase().includes(query))
      : tags
    return filtered.slice(0, 150)
  }, [tagQuery, tags])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Select value={selectedIntent ?? '__any__'} onValueChange={(value) => onIntentChange(value === '__any__' ? null : value)}>
          <SelectTrigger className="h-7 text-xs">
            {selectedIntentItem ? (
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                {(() => {
                  const Icon = intentIcon(selectedIntentItem.value)
                  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                })()}
                <span className="truncate">{selectedIntentItem.value}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground/70">{selectedIntentItem.count}</span>
              </div>
            ) : (
              <div className="truncate">Any intent</div>
            )}
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="__any__" className="py-0.5 px-2 text-xs">Any intent</SelectItem>
            {intents.map((item) => (
              <SelectItem key={item.value} value={item.value} className="py-0.5 px-2 text-xs">
                <span className="flex w-full min-w-0 items-center gap-1.5">
                  {(() => {
                    const Icon = intentIcon(item.value)
                    return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                  })()}
                  <span className="min-w-0 flex-1 truncate">{item.value}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground/70">{item.count}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedPlatform ?? '__any__'} onValueChange={(value) => onPlatformChange(value === '__any__' ? null : value)}>
          <SelectTrigger className="h-7 text-xs">
            {selectedPlatformItem ? (
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                {(() => {
                  const Icon = platformIcon(selectedPlatformItem.value)
                  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                })()}
                <span className="truncate">{selectedPlatformItem.value}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground/70">{selectedPlatformItem.count}</span>
              </div>
            ) : (
              <div className="truncate">Any platform</div>
            )}
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="__any__" className="py-0.5 px-2 text-xs">Any platform</SelectItem>
            {platforms.map((item) => (
              <SelectItem key={item.value} value={item.value} className="py-0.5 px-2 text-xs">
                <span className="flex w-full min-w-0 items-center gap-1.5">
                  {(() => {
                    const Icon = platformIcon(item.value)
                    return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                  })()}
                  <span className="min-w-0 flex-1 truncate">{item.value}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground/70">{item.count}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        value={tagQuery}
        onChange={(event) => setTagQuery(event.target.value)}
        placeholder="Search tags..."
        className="h-7 text-xs"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <div className="flex flex-wrap gap-x-2 gap-y-2">
          {visibleTags.map((item) => {
            const active = selectedTags.includes(item.value)
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onTagToggle(item.value)}
                className={cn(
                  'inline-flex max-w-full items-start gap-0.5 rounded px-1 py-0.5 text-[12px] leading-none transition-colors',
                  active
                    ? 'bg-card text-primary'
                    : 'bg-transparent text-muted-foreground hover:text-foreground',
                )}
                title={item.count > 1 ? `${item.value} (${item.count})` : item.value}
              >
                <span className="truncate">{item.value}</span>
                {item.count > 1 && (
                  <sup className={cn('tabular-nums text-[10px] leading-none', active ? 'text-primary/80' : 'text-muted-foreground/70')}>
                    {item.count}
                  </sup>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function GroupedCategoryList({
  groups,
  activeValues,
  onToggle,
}: {
  groups: CategoryGroupFacet[]
  activeValues: string[]
  onToggle: (value: string) => void
}) {
  const activeSet = useMemo(() => new Set(activeValues), [activeValues])

  return (
    <div className="py-1">
      {groups.map((group) => {
        const parentToken = `parent:${group.parent}`
        const parentActive = activeSet.has(parentToken)
        const visibleChildren = group.children.length === 1 && group.children[0]?.name === group.parent
          ? []
          : group.children
        return (
          <div key={group.parent} className="border-b border-border/30 last:border-b-0">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <button
                type="button"
                onClick={() => onToggle(parentToken)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-card',
                  parentActive && 'bg-card',
                )}
              >
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full transition-colors',
                    parentActive ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                />
                <span className={cn('truncate', parentActive ? 'text-primary' : 'text-muted-foreground')} title={group.parent}>
                  {group.parent}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/60">{group.totalCount}</span>
              </button>
            </div>
            {visibleChildren.length > 0 && (
              <div className="pb-1 pl-8">
                {visibleChildren.map((child) => {
                  const childToken = `child:${child.name}`
                  const childActive = activeSet.has(childToken)
                  return (
                    <button
                      key={`${group.parent}:${child.name}`}
                      type="button"
                      onClick={() => onToggle(childToken)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-card',
                        childActive && 'bg-card',
                      )}
                    >
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full transition-colors',
                          childActive ? 'bg-primary' : 'bg-muted-foreground/25',
                        )}
                      />
                      <span className={cn('min-w-0 flex-1 truncate', childActive ? 'text-primary' : 'text-muted-foreground')} title={child.name}>
                        {child.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground/60">{child.count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FacetRow({
  value,
  count,
  showDomainIcon,
  active,
  onClick,
}: {
  value: string
  count: number
  showDomainIcon: boolean
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
      {showDomainIcon && (
        <Favicon domain={value} />
      )}
      {!showDomainIcon && (
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full transition-colors',
            active ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        />
      )}
      <span
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 truncate',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
        title={value}
      >
        <span className="truncate">{value}</span>
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground/60">
        {count}
      </span>
    </button>
  )
}

function TriageChip({
  label,
  hint,
  active,
  count,
  onClick,
}: {
  label: string
  hint: string
  active: boolean
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      className={cn(
        'rounded px-2 py-0.5 text-xs transition-colors',
        count === 0 && 'pointer-events-none cursor-default opacity-40',
        active
          ? 'bg-primary/20 text-primary'
          : 'text-muted-foreground hover:bg-card hover:text-foreground',
      )}
    >
      {label}
      {count > 0 && (
        <sup className={cn('ml-0.5 tabular-nums text-[10px] leading-none', active ? 'text-primary/70' : 'text-muted-foreground/60')}>
          {count}
        </sup>
      )}
    </button>
  )
}
