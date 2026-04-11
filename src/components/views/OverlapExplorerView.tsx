import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'

type Mode = 'venn' | 'upset'
type VennZone = 'tabs-only' | 'both' | 'bookmarks-only'

interface Page {
  id: string
  title: string
  url: string
  domain: string
  tags: string[]
  inTabs: boolean
  inBookmarks: boolean
  favIconUrl?: string
  tabId?: number
  windowId?: number
}

interface SubsetRow {
  key: string
  label: string
  count: number
  pages: Page[]
}

export function OverlapExplorerView({ bookmarks, tabs, loading }: ViewProps) {
  const [mode, setMode] = useState<Mode>('venn')
  const [selectedZone, setSelectedZone] = useState<VennZone>('both')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedSubset, setSelectedSubset] = useState<string | null>(null)

  const pages = useMemo<Page[]>(() => {
    const byUrl = new Map<string, Page>()
    for (const bookmark of bookmarks) {
      const existing = byUrl.get(bookmark.url)
      byUrl.set(bookmark.url, {
        id: existing?.id ?? `bm-${bookmark.id}`,
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        tags: Array.from(new Set([...(existing?.tags ?? []), ...(bookmark.tags ?? [])])),
        inTabs: existing?.inTabs ?? Boolean(bookmark.isOpen),
        inBookmarks: true,
        favIconUrl: existing?.favIconUrl,
        tabId: existing?.tabId,
        windowId: existing?.windowId,
      })
    }
    for (const tab of tabs) {
      const existing = byUrl.get(tab.url)
      byUrl.set(tab.url, {
        id: existing?.id ?? `tab-${tab.id}`,
        title: existing?.title || tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        tags: Array.from(new Set([...(existing?.tags ?? []), ...(tab.tags ?? [])])),
        inTabs: true,
        inBookmarks: existing?.inBookmarks ?? Boolean(tab.isBookmarked),
        favIconUrl: tab.favIconUrl,
        tabId: tab.id,
        windowId: tab.windowId,
      })
    }
    return Array.from(byUrl.values())
  }, [bookmarks, tabs])

  const venn = useMemo(() => {
    return {
      'tabs-only': pages.filter((page) => page.inTabs && !page.inBookmarks),
      both: pages.filter((page) => page.inTabs && page.inBookmarks),
      'bookmarks-only': pages.filter((page) => !page.inTabs && page.inBookmarks),
    }
  }, [pages])

  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const page of pages) {
      for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag)
  }, [pages])

  const subsets = useMemo<SubsetRow[]>(() => {
    if (selectedTags.length < 2) return []
    const rows: SubsetRow[] = []
    const count = 1 << selectedTags.length
    for (let mask = 1; mask < count; mask += 1) {
      const includeTags = selectedTags.filter((_, idx) => (mask & (1 << idx)) !== 0)
      const pagesInSubset = pages.filter((page) => {
        const hasAll = includeTags.every((tag) => page.tags.includes(tag))
        if (!hasAll) return false
        const excluded = selectedTags.filter((tag) => !includeTags.includes(tag))
        return excluded.every((tag) => !page.tags.includes(tag))
      })
      if (pagesInSubset.length === 0) continue
      rows.push({
        key: includeTags.join('|'),
        label: subsetLabel(includeTags, selectedTags),
        count: pagesInSubset.length,
        pages: pagesInSubset,
      })
    }
    return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [pages, selectedTags])

  const selectedSubsetPages = useMemo(
    () => subsets.find((row) => row.key === selectedSubset)?.pages ?? [],
    [subsets, selectedSubset],
  )

  const selectedVennPages = venn[selectedZone]
  const canUpset = allTags.length > 0

  async function openPage(page: Page) {
    if (page.tabId != null && page.windowId != null && page.inTabs) {
      await chrome.tabs.update(page.tabId, { active: true })
      await chrome.windows.update(page.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: page.url })
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading overlap explorer...</div>

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={mode === 'venn' ? 'default' : 'outline'} onClick={() => setMode('venn')}>Tabs ∩ Bookmarks</Button>
        <Button type="button" size="sm" variant={mode === 'upset' ? 'default' : 'outline'} onClick={() => setMode('upset')} disabled={!canUpset}>Tag UpSet</Button>
      </div>

      {!canUpset && mode === 'upset' && (
        <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          No tags available. UpSet mode needs tagging.
        </div>
      )}

      {mode === 'venn' && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" onClick={() => setSelectedZone('tabs-only')} className={zoneClass(selectedZone === 'tabs-only')}>
              Tabs only ({venn['tabs-only'].length})
            </button>
            <button type="button" onClick={() => setSelectedZone('both')} className={zoneClass(selectedZone === 'both')}>
              Both ({venn.both.length})
            </button>
            <button type="button" onClick={() => setSelectedZone('bookmarks-only')} className={zoneClass(selectedZone === 'bookmarks-only')}>
              Bookmarks only ({venn['bookmarks-only'].length})
            </button>
          </div>
          <PageList pages={selectedVennPages} onOpen={openPage} />
        </>
      )}

      {mode === 'upset' && canUpset && (
        <>
          <div className="space-y-2 rounded-md border border-border bg-card/30 p-3">
            <div className="text-xs text-muted-foreground">Select 2-4 tags:</div>
            <div className="flex flex-wrap gap-1.5">
              {allTags.slice(0, 24).map((tag) => {
                const active = selectedTags.includes(tag)
                const blocked = !active && selectedTags.length >= 4
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={blocked}
                    onClick={() =>
                      setSelectedTags((prev) =>
                        prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag],
                      )
                    }
                    className={[
                      'rounded-full border px-2 py-0.5 text-xs',
                      active ? 'border-primary bg-primary/20 text-primary' : 'border-border text-muted-foreground',
                      blocked ? 'opacity-40' : '',
                    ].join(' ')}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          </div>

          {selectedTags.length < 2 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
              Select at least two tags to build intersections.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
              <div className="rounded-md border border-border bg-card/30 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Subset | Count</div>
                <div className="space-y-1.5">
                  {subsets.map((row) => (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => setSelectedSubset(row.key)}
                      className={[
                        'flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-xs',
                        selectedSubset === row.key ? 'border-primary bg-primary/15' : 'border-border bg-background/60',
                      ].join(' ')}
                    >
                      <span className="truncate pr-2">{row.label}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{row.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <PageList pages={selectedSubsetPages} onOpen={openPage} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

function PageList({ pages, onOpen }: { pages: Page[]; onOpen: (page: Page) => Promise<void> }) {
  return (
    <div className="max-h-[560px] space-y-2 overflow-y-auto rounded-md border border-border bg-card/30 p-3">
      {pages.map((page) => (
        <button
          key={page.id}
          type="button"
          onClick={() => void onOpen(page)}
          className="w-full rounded-md border border-border bg-background/60 p-2 text-left hover:bg-background"
        >
          <div className="flex items-start gap-2">
            <Favicon domain={page.domain} src={page.favIconUrl} />
            <div className="min-w-0">
              <div className="line-clamp-2 text-xs font-medium text-foreground">{page.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">{page.domain}</div>
            </div>
          </div>
        </button>
      ))}
      {pages.length === 0 && (
        <div className="text-xs text-muted-foreground">No pages in this selection.</div>
      )}
    </div>
  )
}

function subsetLabel(includeTags: string[], selectedTags: string[]): string {
  if (includeTags.length === selectedTags.length) return 'all selected'
  if (includeTags.length === 1) return `${includeTags[0]} only`
  return includeTags.join(' + ')
}

function zoneClass(active: boolean): string {
  return [
    'rounded-md border px-3 py-4 text-sm',
    active ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card/30 text-muted-foreground',
  ].join(' ')
}


