import { useMemo, useState } from 'react'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import {
  InteractiveStreamGraph,
  type StreamBandSelection,
  type StreamRecord,
} from '@/components/views/topic-river/InteractiveStreamGraph'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { effectiveIntent } from '@/lib/ai/static-intent'

type GroupBy = 'categories' | 'domains' | 'tags' | 'platforms' | 'intents'

interface RiverItem {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  category: string
  platform?: string
  tags: string[]
  intent: string
  timestamp: number
  favIconUrl?: string
  tabId?: number
  windowId?: number
}

export function TopicRiverView({ bookmarks, tabs, loading }: ViewProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('categories')
  const [selectedBand, setSelectedBand] = useState<StreamBandSelection<RiverItem> | null>(null)

  const items = useMemo<RiverItem[]>(() => {
    const bookmarkItems = bookmarks
      .filter((bookmark) => (bookmark.lastVisited ?? 0) > 0 || bookmark.dateAdded > 0)
      .map((bookmark) => ({
        id: `bm-${bookmark.id}`,
        source: 'bookmark' as const,
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        category: bookmark.category?.trim() || bookmark.domain,
        platform: bookmark.platform,
        tags: bookmark.tags ?? [],
        intent: effectiveIntent(bookmark) ?? 'other',
        timestamp: (bookmark.lastVisited ?? 0) > 0 ? (bookmark.lastVisited as number) : bookmark.dateAdded,
      }))

    const tabItems = tabs
      .filter((tab) => tab.lastAccessed > 0)
      .map((tab) => ({
        id: `tab-${tab.id}`,
        source: 'tab' as const,
        title: tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        category: tab.category?.trim() || tab.domain,
        platform: tab.platform,
        tags: tab.tags ?? [],
        intent: effectiveIntent(tab) ?? 'other',
        timestamp: tab.lastAccessed,
        favIconUrl: tab.favIconUrl,
        tabId: tab.id,
        windowId: tab.windowId,
      }))

    return [...bookmarkItems, ...tabItems]
  }, [bookmarks, tabs])

  const records = useMemo<StreamRecord<RiverItem>[]>(() => {
    return items.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      groups: groupValues(item, groupBy),
      payload: item,
    }))
  }, [groupBy, items])

  async function openItem(item: RiverItem) {
    if (item.source === 'tab' && item.tabId != null && item.windowId != null) {
      await chrome.tabs.update(item.tabId, { active: true })
      await chrome.windows.update(item.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: item.url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading topic river...</div>
  }

  if (items.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No items available for topic river.</div>
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <span className="truncate">Group: {groupBy}</span>
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="categories" className="py-0.5 px-2 text-xs">Categories</SelectItem>
            <SelectItem value="domains" className="py-0.5 px-2 text-xs">Domains</SelectItem>
            <SelectItem value="tags" className="py-0.5 px-2 text-xs">Tags</SelectItem>
            <SelectItem value="platforms" className="py-0.5 px-2 text-xs">Platforms</SelectItem>
            <SelectItem value="intents" className="py-0.5 px-2 text-xs">Intents</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <InteractiveStreamGraph
          records={records}
          legendSide="bottom"
          maxTopGroups={19}
          onSelectionChange={setSelectedBand}
        />

        <aside className="rounded-md border border-border bg-card/30 p-3">
          <h3 className="text-sm font-semibold text-foreground">
            {selectedBand ? `${selectedBand.group} · ${selectedBand.bucketLabel}` : 'Select a band'}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedBand ? `${selectedBand.items.length} pages` : 'Click a stream segment to inspect pages'}
          </p>

          <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto">
            {selectedBand?.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openItem(item)}
                className="w-full rounded-md border border-border bg-background/60 p-2 text-left hover:bg-background"
              >
                <div className="flex items-start gap-2">
                  <Favicon domain={item.domain} src={item.favIconUrl} />
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-xs font-medium text-foreground">{item.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{item.domain}</div>
                  </div>
                </div>
              </button>
            ))}
            {selectedBand && selectedBand.items.length === 0 && (
              <div className="text-xs text-muted-foreground">No pages in this bucket/category.</div>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

function groupValues(item: RiverItem, groupBy: GroupBy): string[] {
  if (groupBy === 'domains') {
    return [item.domain]
  }
  if (groupBy === 'platforms') {
    return [item.platform?.trim() || 'unknown']
  }
  if (groupBy === 'intents') {
    return [item.intent || 'other']
  }
  if (groupBy === 'tags') {
    const normalized = Array.from(new Set(item.tags.map((tag) => tag.trim()).filter(Boolean)))
    return normalized.length > 0 ? normalized : ['untagged']
  }
  return [item.category]
}
