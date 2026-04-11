import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'

type SourceMode = 'bookmarks' | 'tabs' | 'both'
type SortMode = 'count' | 'alpha'

interface PageEntry {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  visitCount?: number
  dateAdded?: number
  tabId?: number
  windowId?: number
  favIconUrl?: string
}

interface SubGroup {
  label: string
  entries: PageEntry[]
}

interface DomainGroup {
  domain: string
  total: number
  subgroups: SubGroup[]
  ungrouped: PageEntry[]
}

export function DomainDrillDownView({ bookmarks, tabs, loading }: ViewProps) {
  const [source, setSource] = useState<SourceMode>('both')
  const [sortMode, setSortMode] = useState<SortMode>('count')

  const entries = useMemo<PageEntry[]>(() => {
    const result: PageEntry[] = []
    if (source === 'bookmarks' || source === 'both') {
      for (const bookmark of bookmarks) {
        result.push({
          id: `bm-${bookmark.id}`,
          source: 'bookmark',
          title: bookmark.title || bookmark.url,
          url: bookmark.url,
          domain: bookmark.domain,
          visitCount: bookmark.visitCount,
          dateAdded: bookmark.dateAdded,
        })
      }
    }
    if (source === 'tabs' || source === 'both') {
      for (const tab of tabs) {
        result.push({
          id: `tab-${tab.id}`,
          source: 'tab',
          title: tab.title || tab.url,
          url: tab.url,
          domain: tab.domain,
          visitCount: tab.visitCount,
          dateAdded: tab.lastAccessed,
          tabId: tab.id,
          windowId: tab.windowId,
          favIconUrl: tab.favIconUrl,
        })
      }
    }
    return result
  }, [bookmarks, tabs, source])

  const groups = useMemo<DomainGroup[]>(() => {
    const byDomain = new Map<string, PageEntry[]>()
    for (const entry of entries) {
      byDomain.set(entry.domain, [...(byDomain.get(entry.domain) ?? []), entry])
    }

    const base: DomainGroup[] = Array.from(byDomain.entries()).map(([domain, domainEntries]) => {
      const { subgroups, ungrouped } = parseSubgroups(domain, domainEntries)
      return {
        domain,
        total: domainEntries.length,
        subgroups: subgroups
          .map((group) => ({
            ...group,
            entries: [...group.entries].sort((a, b) => (b.visitCount ?? 0) - (a.visitCount ?? 0)),
          }))
          .sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label)),
        ungrouped: [...ungrouped].sort((a, b) => (b.visitCount ?? 0) - (a.visitCount ?? 0)),
      }
    })

    if (sortMode === 'alpha') {
      return base.sort((a, b) => a.domain.localeCompare(b.domain))
    }
    return base.sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain))
  }, [entries, sortMode])

  async function openEntry(entry: PageEntry) {
    if (entry.source === 'tab' && entry.tabId != null && entry.windowId != null) {
      await chrome.tabs.update(entry.tabId, { active: true })
      await chrome.windows.update(entry.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: entry.url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading domain drill-down...</div>
  }

  if (groups.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No pages to group by domain.</div>
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={source === 'bookmarks' ? 'default' : 'outline'} onClick={() => setSource('bookmarks')}>Bookmarks</Button>
        <Button type="button" size="sm" variant={source === 'tabs' ? 'default' : 'outline'} onClick={() => setSource('tabs')}>Tabs</Button>
        <Button type="button" size="sm" variant={source === 'both' ? 'default' : 'outline'} onClick={() => setSource('both')}>Both</Button>
        <span className="ml-2 text-xs text-muted-foreground">Sort domains:</span>
        <Button type="button" size="sm" variant={sortMode === 'count' ? 'default' : 'outline'} onClick={() => setSortMode('count')}>By count</Button>
        <Button type="button" size="sm" variant={sortMode === 'alpha' ? 'default' : 'outline'} onClick={() => setSortMode('alpha')}>A-Z</Button>
      </div>

      <div className="space-y-2">
        {groups.map((group) => (
          <details key={group.domain} className="rounded-md border border-border bg-card/40">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
              {group.domain} ({group.total})
            </summary>
            <div className="space-y-2 border-t border-border px-3 py-3">
              {group.subgroups.map((subgroup) => (
                <details key={`${group.domain}-${subgroup.label}`} className="rounded-md border border-border/70 bg-background/40">
                  <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-foreground">
                    {subgroup.label} ({subgroup.entries.length})
                  </summary>
                  <div className="space-y-1.5 border-t border-border/60 px-2.5 py-2">
                    {subgroup.entries.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} onOpen={openEntry} />
                    ))}
                  </div>
                </details>
              ))}

              {group.ungrouped.length > 0 && (
                <details className="rounded-md border border-border/70 bg-background/40">
                  <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground">
                    other ({group.ungrouped.length})
                  </summary>
                  <div className="space-y-1.5 border-t border-border/60 px-2.5 py-2">
                    {group.ungrouped.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} onOpen={openEntry} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function EntryRow({ entry, onOpen }: { entry: PageEntry; onOpen: (entry: PageEntry) => Promise<void> }) {
  return (
    <button
      type="button"
      onClick={() => void onOpen(entry)}
      className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-left hover:bg-background"
    >
      <Favicon domain={entry.domain} src={entry.favIconUrl} />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{entry.title}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{entry.visitCount ?? 0}</span>
      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  )
}

function parseSubgroups(domain: string, entries: PageEntry[]): { subgroups: SubGroup[]; ungrouped: PageEntry[] } {
  const pathFromUrl = (url: string): string => {
    try {
      return new URL(url).pathname
    } catch {
      return ''
    }
  }

  if (domain === 'github.com' || domain === 'gitlab.com') {
    const byRepo = new Map<string, PageEntry[]>()
    const ungrouped: PageEntry[] = []
    for (const entry of entries) {
      const parts = pathFromUrl(entry.url).split('/').filter(Boolean)
      const key = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : ''
      if (!key) {
        ungrouped.push(entry)
        continue
      }
      byRepo.set(key, [...(byRepo.get(key) ?? []), entry])
    }
    return {
      subgroups: Array.from(byRepo.entries()).map(([label, groupedEntries]) => ({ label, entries: groupedEntries })),
      ungrouped,
    }
  }

  if (domain === 'youtube.com' || domain === 'youtu.be') {
    const groups = {
      videos: [] as PageEntry[],
      channels: [] as PageEntry[],
      playlists: [] as PageEntry[],
      other: [] as PageEntry[],
    }
    for (const entry of entries) {
      try {
        const url = new URL(entry.url)
        if (url.searchParams.has('v')) groups.videos.push(entry)
        else if (url.pathname.startsWith('/channel/') || url.pathname.startsWith('/@')) groups.channels.push(entry)
        else if (url.searchParams.has('list') || url.pathname.startsWith('/playlist')) groups.playlists.push(entry)
        else groups.other.push(entry)
      } catch {
        groups.other.push(entry)
      }
    }
    return {
      subgroups: [
        { label: 'videos', entries: groups.videos },
        { label: 'channels', entries: groups.channels },
        { label: 'playlists', entries: groups.playlists },
        { label: 'other', entries: groups.other },
      ].filter((group) => group.entries.length > 0),
      ungrouped: [],
    }
  }

  if (domain === 'reddit.com' || domain === 'old.reddit.com') {
    const bySubreddit = new Map<string, PageEntry[]>()
    for (const entry of entries) {
      const parts = pathFromUrl(entry.url).split('/').filter(Boolean)
      const label = parts[0] === 'r' && parts[1] ? `r/${parts[1]}` : 'other'
      bySubreddit.set(label, [...(bySubreddit.get(label) ?? []), entry])
    }
    return {
      subgroups: Array.from(bySubreddit.entries()).map(([label, groupedEntries]) => ({ label, entries: groupedEntries })),
      ungrouped: [],
    }
  }

  const byFirstSegment = new Map<string, PageEntry[]>()
  for (const entry of entries) {
    const firstSegment = pathFromUrl(entry.url).split('/').filter(Boolean)[0] ?? ''
    if (!firstSegment) continue
    byFirstSegment.set(firstSegment, [...(byFirstSegment.get(firstSegment) ?? []), entry])
  }

  const subgroups: SubGroup[] = []
  const grouped = new Set<string>()
  for (const [label, groupedEntries] of byFirstSegment.entries()) {
    if (groupedEntries.length >= 3) {
      subgroups.push({ label, entries: groupedEntries })
      for (const entry of groupedEntries) grouped.add(entry.id)
    }
  }
  const ungrouped = entries.filter((entry) => !grouped.has(entry.id))
  return { subgroups, ungrouped }
}


