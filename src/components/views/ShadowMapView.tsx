import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { loadCachedEmbeddings } from '@/lib/embedder'

type ClusterType = 'exact' | 'title-similar' | 'semantic'

interface Page {
  id: string
  title: string
  url: string
  domain: string
  visitCount: number
  isDuplicate: boolean
  source: 'bookmark' | 'tab'
  tabId?: number
  windowId?: number
  favIconUrl?: string
}

interface Cluster {
  id: string
  type: ClusterType
  label: string
  pages: Page[]
}

export function ShadowMapView({ bookmarks, tabs, loading }: ViewProps) {
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [hiddenClusters, setHiddenClusters] = useState<string[]>([])
  const [embeddingByUrl, setEmbeddingByUrl] = useState<Map<string, number[]>>(new Map())

  const removedSet = useMemo(() => new Set(removedIds), [removedIds])
  const hiddenSet = useMemo(() => new Set(hiddenClusters), [hiddenClusters])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const map = await loadCachedEmbeddings()
      if (!cancelled) setEmbeddingByUrl(map)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const pages = useMemo<Page[]>(() => {
    const base: Page[] = [
      ...bookmarks.map((bookmark) => ({
        id: `bm-${bookmark.id}`,
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        visitCount: bookmark.visitCount ?? 0,
        isDuplicate: Boolean(bookmark.isDuplicate),
        source: 'bookmark' as const,
      })),
      ...tabs.map((tab) => ({
        id: `tab-${tab.id}`,
        title: tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        visitCount: tab.visitCount ?? 0,
        isDuplicate: Boolean(tab.isDuplicate),
        source: 'tab' as const,
        tabId: tab.id,
        windowId: tab.windowId,
        favIconUrl: tab.favIconUrl,
      })),
    ]
    return base.filter((page) => !removedSet.has(page.id))
  }, [bookmarks, tabs, removedSet])

  const clusters = useMemo<Cluster[]>(() => {
    const result: Cluster[] = []
    const usedUrls = new Set<string>()

    const byUrl = new Map<string, Page[]>()
    for (const page of pages) {
      byUrl.set(page.url, [...(byUrl.get(page.url) ?? []), page])
    }
    for (const [url, sameUrlPages] of byUrl.entries()) {
      if (sameUrlPages.length > 1 || sameUrlPages.some((page) => page.isDuplicate)) {
        result.push({
          id: `exact:${url}`,
          type: 'exact',
          label: sameUrlPages[0]?.title || url,
          pages: [...sameUrlPages].sort((a, b) => b.visitCount - a.visitCount),
        })
        usedUrls.add(url)
      }
    }

    const candidates = pages
      .filter((page) => !usedUrls.has(page.url))
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 500)
    const titleSimilarGroups = buildSimilarityComponents(
      candidates,
      (a, b) => a.domain === b.domain && jaccardTitleSim(a.title, b.title) > 0.7,
    )
    for (const [index, component] of titleSimilarGroups.entries()) {
      result.push({
        id: `title:${index}`,
        type: 'title-similar',
        label: component[0]?.domain || 'similar titles',
        pages: [...component].sort((a, b) => b.visitCount - a.visitCount),
      })
      for (const page of component) usedUrls.add(page.url)
    }

    const semanticCandidates = pages
      .filter((page) => embeddingByUrl.has(page.url))
      .slice(0, 350)
    const semanticGroups = buildSimilarityComponents(
      semanticCandidates,
      (a, b) => cosineSim(embeddingByUrl.get(a.url) ?? [], embeddingByUrl.get(b.url) ?? []) > 0.85,
    )
    for (const [index, component] of semanticGroups.entries()) {
      result.push({
        id: `semantic:${index}`,
        type: 'semantic',
        label: component[0]?.title || 'semantic cluster',
        pages: [...component].sort((a, b) => b.visitCount - a.visitCount),
      })
    }

    return result
      .filter((cluster) => cluster.pages.length > 1)
      .filter((cluster) => !hiddenSet.has(cluster.id))
      .sort((a, b) => b.pages.length - a.pages.length || a.label.localeCompare(b.label))
  }, [pages, embeddingByUrl, hiddenSet])

  async function openPage(page: Page) {
    if (page.source === 'tab' && page.tabId != null && page.windowId != null) {
      await chrome.tabs.update(page.tabId, { active: true })
      await chrome.windows.update(page.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: page.url })
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading shadow map...</div>

  return (
    <section className="space-y-3">
      {embeddingByUrl.size === 0 && (
        <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Run embeddings to find semantic duplicates.
        </div>
      )}

      {clusters.length === 0 ? (
        <div className="p-8 text-sm text-muted-foreground">No duplicate clusters found.</div>
      ) : (
        <div className="space-y-4">
          {clusters.map((cluster) => (
            <section key={cluster.id} className="rounded-md border border-border bg-card/40 p-3">
              <header className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{cluster.label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{cluster.type}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{cluster.pages.length} pages</span>
                <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setHiddenClusters((prev) => [...prev, cluster.id])}>
                  Keep all
                </Button>
              </header>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {cluster.pages.map((page, index) => (
                  <article key={page.id} className="rounded-md border border-border bg-background/60 p-2">
                    <div className="mb-1.5 flex items-center gap-2">
                      <Favicon domain={page.domain} src={page.favIconUrl} />
                      <div className="line-clamp-2 text-xs font-medium text-foreground">{page.title}</div>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{page.domain} · {page.visitCount} visits</div>
                    {index === 0 && (
                      <div className="mt-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">★ KEEP</div>
                    )}
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void openPage(page)}>Keep</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setRemovedIds((prev) => [...prev, page.id])}>Delete</Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}

function jaccardTitleSim(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (setA.size === 0 && setB.size === 0) return 1
  const intersection = Array.from(setA).filter((word) => setB.has(word)).length
  return intersection / (setA.size + setB.size - intersection || 1)
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

function buildSimilarityComponents(
  pages: Page[],
  isLinked: (a: Page, b: Page) => boolean,
): Page[][] {
  if (pages.length < 2) return []
  const parent = pages.map((_, idx) => idx)

  const find = (x: number): number => {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }
  const union = (a: number, b: number) => {
    const pa = find(a)
    const pb = find(b)
    if (pa !== pb) parent[pb] = pa
  }

  for (let i = 0; i < pages.length; i += 1) {
    for (let j = i + 1; j < pages.length; j += 1) {
      if (isLinked(pages[i], pages[j])) union(i, j)
    }
  }

  const groups = new Map<number, Page[]>()
  for (let i = 0; i < pages.length; i += 1) {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), pages[i]])
  }
  return Array.from(groups.values()).filter((group) => group.length > 1)
}

