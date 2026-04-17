import { useMemo } from 'react'
import { SourceFilterToggle } from '@/components/SourceFilter'
import { IntentIcon } from '@/components/IntentIcon'
import { PlatformIcon } from '@/components/PlatformIcon'
import { Favicon } from '@/components/Favicon'
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
  activeMode: 'domains' | 'categories' | 'intent' | 'platform' | 'tags'
  activeValues: string[]
  onModeChange: (mode: 'domains' | 'categories' | 'intent' | 'platform' | 'tags') => void
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
  intents,
  platforms,
  tags,
  activeMode,
  activeValues,
  onModeChange,
  onToggle,
  onClear,
  width,
}: FacetSidebarProps) {
  const items = activeMode === 'domains'
    ? domains
    : activeMode === 'intent'
      ? intents
      : activeMode === 'platform'
        ? platforms
        : tags
  const showEmpty = activeMode === 'categories'
    ? categories.length === 0
    : activeMode === 'intent'
      ? intents.length === 0
      : activeMode === 'platform'
        ? platforms.length === 0
        : activeMode === 'tags'
          ? tags.length === 0
          : false
  const bookmarkScopeValue = bookmarkScopeFilter.mode === 'folder' && bookmarkScopeFilter.folderId
    ? bookmarkScopeFilter.folderId
    : 'root'
  const selectedFolder = bookmarkScopeValue === 'root'
    ? null
    : bookmarkFolderOptions.find((option) => option.id === bookmarkScopeValue) ?? null
  const bookmarkScopeLabel = selectedFolder
    ? selectedFolder.path
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

      <div className="shrink-0 border-b border-border px-1 pt-0.5 pb-0">
        <div className="flex items-center justify-center">
          {(['domains', 'categories', 'intent', 'platform', 'tags'] as const).map((mode, index, all) => (
            <div key={mode} className="flex items-center">
              <button
                type="button"
                onClick={() => onModeChange(mode)}
                className={cn(
                  'border-b-2 border-transparent px-1 pt-1 pb-1  font-medium leading-none transition-colors',
                  activeMode === mode
                    ? 'border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode === 'domains'
                  ? 'Domains'
                  : mode === 'categories'
                    ? 'Categories'
                    : mode === 'intent'
                      ? 'Intent'
                      : mode === 'platform'
                        ? 'Platform'
                        : 'Tags'}
              </button>
              {index < all.length - 1 && (
                <span className="mx-0.5 text-[10px] leading-none text-muted-foreground/45">·</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showEmpty ? (
          <p className="p-4 text-xs text-muted-foreground">
            {activeMode === 'intent'
              ? 'No intents yet'
              : activeMode === 'platform'
                ? 'No platforms yet'
                : activeMode === 'tags'
                  ? 'No tags yet'
                : 'No categories yet'}
          </p>
        ) : activeMode === 'categories' ? (
          <GroupedCategoryList
            groups={categories}
            activeValues={activeValues}
            onToggle={onToggle}
          />
        ) : activeMode === 'tags' ? (
          <CompactTagList
            items={tags}
            activeValues={activeValues}
            onToggle={onToggle}
          />
        ) : (
          items.map(item => (
            <FacetRow
              key={item.value}
              value={item.value}
              count={item.count}
              showDomainIcon={activeMode === 'domains'}
              showIntentIcon={activeMode === 'intent'}
              showPlatformIcon={activeMode === 'platform'}
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

function CompactTagList({
  items,
  activeValues,
  onToggle,
}: {
  items: FacetItem[]
  activeValues: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-2 p-3">
      {items.map((item) => {
        const active = activeValues.includes(item.value)
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onToggle(item.value)}
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
  showIntentIcon,
  showPlatformIcon,
  active,
  onClick,
}: {
  value: string
  count: number
  showDomainIcon: boolean
  showIntentIcon: boolean
  showPlatformIcon: boolean
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
      {!showDomainIcon && !showIntentIcon && !showPlatformIcon && (
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
        {showIntentIcon && <IntentIcon intent={value} className={active ? 'text-primary/80' : undefined} />}
        {showPlatformIcon && <PlatformIcon platform={value} className={active ? 'text-primary/80' : undefined} />}
        <span className="truncate">{value}</span>
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground/60">
        {count}
      </span>
    </button>
  )
}
