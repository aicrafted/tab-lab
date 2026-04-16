import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { ListView } from '@/components/ListView'
import { LlmSettingsView } from '@/components/views/settings/LlmSettingsView'
import { KnowledgeSettingsView } from '@/components/views/settings/KnowledgeSettingsView'
import { AdvancedSettingsView } from '@/components/views/settings/AdvancedSettingsView'
import { FacetSidebar, type CategoryGroupFacet } from '@/components/FacetSidebar'
import { ViewBar, VIEW_HINTS } from '@/components/ViewBar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  getBookmarkFolderDescendantIds,
  getBookmarkFolderOptions,
  type BookmarkFolderOption,
} from '@/lib/bookmarks'
import { checkLlmAvailability, type LlmAvailability } from '@/lib/classifier'
import { loadCached2D } from '@/lib/embedder'
import { loadHydratedData } from '@/lib/initial-load'
import { loadClusterNames } from '@/lib/cluster-names'
import {
  getBookmarkScopeFilter,
  getLlmSettings,
  getSourceFilter,
  setBookmarkScopeFilter,
  setLlmSettings,
  setSourceFilter,
} from '@/lib/storage'
import { useResizable } from '@/hooks/useResizable'
import { useAiPipelines } from '@/hooks/useAiPipelines'
import { useOrchestratorTasks } from '@/hooks/useOrchestratorTasks'
import { useBrowserStateSync } from '@/hooks/useBrowserStateSync'
import type { BookmarkItem, BookmarkScopeFilter, TabItem, LlmSettings } from '@/lib/types'
import { DEFAULT_LLM_SETTINGS } from '@/lib/types'
import type { SourceFilter, ViewId, ViewProps } from '@/components/views/types'
import { DomainIconContext } from '@/components/Favicon'
import { effectiveIntent } from '@/lib/static-intent'
import { isLocalUrl } from '@/lib/local-network'
import { formatAge } from '@/lib/utils'
import { Brain, Database, Eraser, Hash, RefreshCw, Tag, Wand2, type LucideIcon } from 'lucide-react'
import { TriageView } from '@/components/views/TriageView'
import { KanbanView } from '@/components/views/KanbanView'
import { TimelineView } from '@/components/views/TimelineView'
import { MagazineView } from '@/components/views/MagazineView'
import { TreemapView } from '@/components/views/TreemapView'
import { SemanticMapView } from '@/components/views/SemanticMapView'
import { ActivityHeatmapView } from '@/components/views/ActivityHeatmapView'
import { DomainGraphView } from '@/components/views/DomainGraphView'
import { ReadingQueueView } from '@/components/views/ReadingQueueView'
import { TagConstellationView } from '@/components/views/TagConstellationView'
import { PersonalRadarView } from '@/components/views/PersonalRadarView'
import { TopicRiverView } from '@/components/views/TopicRiverView'
import { DomainDrillDownView } from '@/components/views/DomainDrillDownView'
import { FocusRingsView } from '@/components/views/FocusRingsView'
import { TagCooccurrenceView } from '@/components/views/TagCooccurrenceView'
import { ShelfView } from '@/components/views/ShelfView'
import { OverlapExplorerView } from '@/components/views/OverlapExplorerView'
import { ShadowMapView } from '@/components/views/ShadowMapView'
import { SessionStoryView } from '@/components/views/SessionStoryView'

function parseCategoryFacetTokens(values: string[]): {
  parentTokens: Set<string>
  childTokens: Set<string>
} {
  const parentTokens = new Set<string>()
  const childTokens = new Set<string>()
  for (const value of values) {
    if (value.startsWith('parent:')) {
      const parent = value.slice('parent:'.length).trim()
      if (parent) parentTokens.add(parent)
      continue
    }
    if (value.startsWith('child:')) {
      const child = value.slice('child:'.length).trim()
      if (child) childTokens.add(child)
      continue
    }
    const legacyValue = value.trim()
    if (legacyValue) childTokens.add(legacyValue)
  }
  return { parentTokens, childTokens }
}

const VIEW_COMPONENTS: Record<Exclude<ViewId, 'list'>, (props: ViewProps) => JSX.Element> = {
  triage: TriageView,
  kanban: KanbanView,
  timeline: TimelineView,
  magazine: MagazineView,
  treemap: TreemapView,
  semantic: SemanticMapView,
  heatmap: ActivityHeatmapView,
  'domain-graph': DomainGraphView,
  'reading-queue': ReadingQueueView,
  'tag-constellation': TagConstellationView,
  'personal-radar': PersonalRadarView,
  'topic-river': TopicRiverView,
  'domain-drill-down': DomainDrillDownView,
  'focus-rings': FocusRingsView,
  'tag-cooccurrence': TagCooccurrenceView,
  'shelf-view': ShelfView,
  'overlap-explorer': OverlapExplorerView,
  'shadow-map': ShadowMapView,
  'session-story': SessionStoryView,
  'settings-llm': LlmSettingsView,
  'settings-knowledge': KnowledgeSettingsView,
  'settings-advanced': AdvancedSettingsView,
}

const VIEW_SOURCE_FILTER_POLICY: Partial<Record<ViewId, SourceFilter[]>> = {
  // List is cleaner with separate entity modes; merged "both" is intentionally disabled.
  list: ['bookmarks', 'tabs'],
}

function scoreFaviconCandidate(iconUrl: string, domain: string): number {
  try {
    const parsed = new URL(iconUrl)
    const host = parsed.hostname.toLowerCase()
    const target = domain.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const query = parsed.search.toLowerCase()

    let score = 0

    if (host === target) score += 40
    else if (host.endsWith(`.${target}`)) score += 25

    if (path === '/favicon.ico') score += 140
    else if (path === '/favicon.png') score += 120
    else if (path === '/favicon.svg') score += 110
    else if (path.includes('favicon')) score += 90
    else if (path.includes('apple-touch-icon')) score += 80

    if (path.endsWith('.ico')) score += 45
    else if (path.endsWith('.png')) score += 30
    else if (path.endsWith('.webp')) score += 20
    else if (path.endsWith('.svg')) score += 10

    const noisyKeywords = ['copilot', 'avatar', 'profile', 'badge', 'emoji', 'user', 'team', 'topic']
    if (noisyKeywords.some((kw) => path.includes(kw) || query.includes(kw))) {
      score -= 120
    }

    score -= Math.min(path.length, 140) / 4
    score -= Math.min(parsed.search.length, 80) / 6
    return score
  } catch {
    return Number.NEGATIVE_INFINITY
  }
}

export function App() {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [tabs, setTabs] = useState<TabItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [llmAvailability, setLlmAvailability] = useState<LlmAvailability>('checking')
  const [, setLlmError] = useState<string | undefined>(undefined)
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS)
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const [activeView, setActiveView] = useState<ViewId>('list')
  const [sourceFilter, setSourceFilterState] = useState<SourceFilter>('both')
  const [bookmarkScopeFilter, setBookmarkScopeFilterState] = useState<BookmarkScopeFilter>({ mode: 'root' })
  const [bookmarkFolderOptions, setBookmarkFolderOptions] = useState<BookmarkFolderOption[]>([])
  const [bookmarkScopeDescendants, setBookmarkScopeDescendants] = useState<Set<string> | null>(null)
  const [facetMode, setFacetMode] = useState<'domains' | 'categories' | 'intent' | 'platform' | 'tags'>('domains')
  const [activeFacets, setActiveFacets] = useState<string[]>([])
  const [viewMenuHost, setViewMenuHost] = useState<HTMLDivElement | null>(null)
  const [, startFilterTransition] = useTransition()
  const { width: sidebarWidth, startDrag } = useResizable(280, 280, 400)
  const [projectedPoints, setProjectedPoints] = useState<Map<string, [number, number]>>(new Map())
  const [clusterNames, setClusterNames] = useState<Map<number, string>>(new Map())

  // Build domain → favicon map from open tabs (for bookmark favicon fallback)
  const domainIconMap = useMemo(() => {
    const map = new Map<string, { url: string; score: number }>()
    for (const tab of tabs) {
      if (!tab.favIconUrl || !tab.domain) continue
      const score = scoreFaviconCandidate(tab.favIconUrl, tab.domain)
      const prev = map.get(tab.domain)
      if (!prev || score > prev.score) map.set(tab.domain, { url: tab.favIconUrl, score })
    }
    return new Map(Array.from(map.entries()).map(([domain, item]) => [domain, item.url]))
  }, [tabs])

  const localUrlSet = useMemo(() => {
    const patterns = llmSettings.localNetworks
    const urls = new Set<string>()
    for (const tab of tabs) {
      if (isLocalUrl(tab.url, patterns)) urls.add(tab.url)
    }
    for (const bookmark of bookmarks) {
      if (isLocalUrl(bookmark.url, patterns)) urls.add(bookmark.url)
    }
    return urls
  }, [bookmarks, llmSettings.localNetworks, tabs])

  // Load settings on mount
  useEffect(() => {
    void Promise.all([getLlmSettings(), getSourceFilter(), getBookmarkScopeFilter()]).then(([settings, source, scope]) => {
      setLlmSettingsState(settings)
      setSourceFilterState(source)
      setBookmarkScopeFilterState(scope)
      setSettingsHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (!settingsHydrated) return
    let active = true
    setLlmAvailability('checking')
    void checkLlmAvailability(llmSettings).then((status) => {
      if (!active) return
      setLlmAvailability(status)
    }).catch(() => {
      if (!active) return
      setLlmAvailability('unavailable')
    })
    return () => { active = false }
  }, [llmSettings, settingsHydrated])

  const handleSourceFilterChange = useCallback((value: SourceFilter) => {
    startFilterTransition(() => {
      setSourceFilterState(value)
    })
    void setSourceFilter(value)
  }, [startFilterTransition])

  const handleBookmarkScopeChange = useCallback((scope: BookmarkScopeFilter) => {
    setBookmarkScopeFilterState(scope)
    void setBookmarkScopeFilter(scope)
  }, [])

  function reload() {
    setBookmarks([])
    setTabs([])
    setLastUpdated(null)
    setLoading(true)
    void doLoad()
  }

  const {
    orchestrator,
    runAutoAiPipeline,
    runEmbeddingPass,
    handleClearCache,
    handleClassify,
    handleRunDomainKnowledge,
    handleRedomainKnowledge,
    handleReclassify,
    handleRunIntent,
    handleReintent,
    handlePostProcessCategories,
    handleRunTags,
    handleRetag,
    handleReembedAll,
    handleStopPipeline,
  } = useAiPipelines({
    bookmarks,
    tabs,
    llmSettings,
    setBookmarks,
    setTabs,
    setLlmError,
    setClusterNames,
    setProjectedPoints,
    reload,
  })

  const { activeTasks, lastError } = useOrchestratorTasks(orchestrator)

  // Sync data with browser events
  useBrowserStateSync(doLoad)

  const aiActionItems: AiActionItem[] = [
    { key: 'domains', label: 'Domains', icon: Database, title: 'Save domain knowledge (site descriptions) to cache', onClick: handleRunDomainKnowledge },
    { key: 'redomains', label: 'Re-Domains', icon: Database, title: 'Clear and rebuild domain knowledge cache', onClick: handleRedomainKnowledge },
    { key: 'classify', label: 'Classify', icon: Wand2, title: 'Run category classification (pass 1)', onClick: handleClassify },
    { key: 'reclassify', label: 'Re-Classify', icon: Wand2, title: 'Clear only category cache and classify again', onClick: handleReclassify },
    { key: 'postcategories', label: 'Post-Categories', icon: Wand2, title: 'Run category post-processing (normalize + group rare)', onClick: handlePostProcessCategories },
    { key: 'tags', label: 'Tags', icon: Hash, title: 'Generate tags for all items', onClick: handleRunTags },
    { key: 'retag', label: 'Re-Tags', icon: Hash, title: 'Clear only tags cache and run tagging again', onClick: handleRetag },
    { key: 'intent', label: 'Intent', icon: Tag, title: 'Classify pages by intent', onClick: handleRunIntent },
    { key: 'reintent', label: 'Re-Intent', icon: Tag, title: 'Clear only intent cache and classify intent again', onClick: handleReintent },
    { key: 'embeddings', label: 'Embeddings', icon: Brain, title: 'Run embeddings + 2D projection', onClick: () => runEmbeddingPass(tabs, bookmarks, llmSettings) },
    { key: 'reembed', label: 'Re-embed', icon: Brain, title: 'Clear embedding cache and re-embed all pages', onClick: handleReembedAll },
    { key: 'full-pipeline', label: 'Run full pipeline', icon: Wand2, title: 'Run full AI pipeline (domains, classify, post-process, tags, intent, embeddings)', onClick: () => runAutoAiPipeline(tabs, bookmarks, tabs) },
    { key: 'clear', label: 'Clear', icon: Eraser, title: 'Clear all cached AI data', onClick: handleClearCache, danger: true },
  ]

  const footerTaskStatus = useMemo(() => {
    const running = activeTasks
      .filter((task) => task.status === 'running')
      .sort((a, b) => a.label.localeCompare(b.label))

    if (running.length === 0) return 'Standby'
    return running
      .map((task) => `${task.label}: ${task.done}/${task.total} ${formatProgressPercent(task.percent)}%`)
      .join(' · ')
  }, [activeTasks])

  async function doLoad() {
    const [hydrated, folderOptions, storedClusterNames] = await Promise.all([
      loadHydratedData(),
      getBookmarkFolderOptions(),
      loadClusterNames(),
    ])
    setBookmarks(hydrated.bookmarks)
    setTabs(hydrated.tabs)
    setBookmarkFolderOptions(folderOptions)
    setClusterNames(storedClusterNames)

    // Restore cached 2D projection (Semantic Map coords)
    const cached2D = await loadCached2D()
    if (cached2D.size > 0) setProjectedPoints(cached2D)

    setLastUpdated(Date.now())
    setLoading(false)

    // void runAutoAiPipeline(
    //   hydrated.rawLinked.tabs,
    //   hydrated.rawLinked.bookmarks,
    //   hydrated.tabsWithCategoryCache,
    // )
  }

  useEffect(() => {
    if (!settingsHydrated) return
    setLoading(true)
    void doLoad()
  }, [settingsHydrated])

  useEffect(() => {
    if (bookmarkScopeFilter.mode === 'root') {
      setBookmarkScopeDescendants(null)
      return
    }
    const targetFolderId = bookmarkScopeFilter.folderId
    if (!targetFolderId) {
      setBookmarkScopeFilterState({ mode: 'root' })
      void setBookmarkScopeFilter({ mode: 'root' })
      setBookmarkScopeDescendants(null)
      return
    }

    let active = true
    void getBookmarkFolderDescendantIds(targetFolderId).then((descendants) => {
      if (!active) return
      if (!descendants) {
        setBookmarkScopeFilterState({ mode: 'root' })
        void setBookmarkScopeFilter({ mode: 'root' })
        setBookmarkScopeDescendants(null)
        return
      }
      setBookmarkScopeDescendants(descendants)
    }).catch(() => {
      if (!active) return
      setBookmarkScopeFilterState({ mode: 'root' })
      void setBookmarkScopeFilter({ mode: 'root' })
      setBookmarkScopeDescendants(null)
    })
    return () => { active = false }
  }, [bookmarkScopeFilter])

  async function activateTab(id: number) {
    try {
      const tab = await chrome.tabs.update(id, { active: true })
      await chrome.windows.update(tab.windowId!, { focused: true })
    } catch {
      // Tab no longer exists — remove from state
      setTabs(prev => prev.filter(t => t.id !== id))
    }
  }

  // Export categorized bookmarks to Chrome folders
  const bookmarkScopeBookmarks = useMemo(
    () => {
      if (bookmarkScopeFilter.mode === 'root') return bookmarks
      if (!bookmarkScopeDescendants) return bookmarks
      return bookmarks.filter((bookmark) => (
        bookmark.folderId ? bookmarkScopeDescendants.has(bookmark.folderId) : false
      ))
    },
    [bookmarkScopeDescendants, bookmarkScopeFilter.mode, bookmarks],
  )

  const sourceScopedBookmarks = useMemo(
    () => (sourceFilter === 'tabs' ? [] : bookmarkScopeBookmarks),
    [bookmarkScopeBookmarks, sourceFilter],
  )
  const sourceScopedTabs = useMemo(
    () => (sourceFilter === 'bookmarks' ? [] : tabs),
    [sourceFilter, tabs],
  )

  const sourceCounts = useMemo(
    () => ({
      bookmarks: bookmarkScopeBookmarks.length,
      tabs: tabs.length,
    }),
    [bookmarkScopeBookmarks.length, tabs.length],
  )

  const allowedSourceFilters = useMemo<SourceFilter[]>(
    () => VIEW_SOURCE_FILTER_POLICY[activeView] ?? ['bookmarks', 'tabs', 'both'],
    [activeView],
  )

  useEffect(() => {
    if (allowedSourceFilters.includes(sourceFilter)) return
    const fallback = allowedSourceFilters[0] ?? 'both'
    setSourceFilterState(fallback)
    void setSourceFilter(fallback)
  }, [allowedSourceFilters, sourceFilter])

  // --- Facet computation ---
  const domainsFacet = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of sourceScopedBookmarks) {
      if (b.domain) counts.set(b.domain, (counts.get(b.domain) ?? 0) + 1)
    }
    for (const t of sourceScopedTabs) {
      if (t.domain) counts.set(t.domain, (counts.get(t.domain) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .filter((item) => item.count > 1)
      .sort((a, b) => b.count - a.count)
  }, [sourceScopedBookmarks, sourceScopedTabs])

  const categoriesFacet = useMemo<CategoryGroupFacet[]>(() => {
    const rawGroups = new Map<string, Map<string, number>>()
    const globalChildCounts = new Map<string, number>()
    const append = (category: string | undefined, parentCategory: string | undefined) => {
      const child = category?.trim()
      if (!child) return
      const parent = parentCategory?.trim() || child
      const children = rawGroups.get(parent) ?? new Map<string, number>()
      children.set(child, (children.get(child) ?? 0) + 1)
      rawGroups.set(parent, children)
      globalChildCounts.set(child, (globalChildCounts.get(child) ?? 0) + 1)
    }

    for (const item of sourceScopedTabs) append(item.category, item.parentCategory)
    for (const item of sourceScopedBookmarks) append(item.category, item.parentCategory)

    const groups = new Map<string, Map<string, number>>()
    for (const [rawParent, childrenMap] of rawGroups.entries()) {
      const candidateNames = new Set<string>([rawParent, ...Array.from(childrenMap.keys())])
      let chosenParent = rawParent
      let bestCount = globalChildCounts.get(rawParent) ?? 0
      for (const name of candidateNames) {
        const count = globalChildCounts.get(name) ?? 0
        if (count > bestCount) {
          bestCount = count
          chosenParent = name
        }
      }
      const targetChildren = groups.get(chosenParent) ?? new Map<string, number>()
      for (const [name, count] of childrenMap.entries()) {
        targetChildren.set(name, (targetChildren.get(name) ?? 0) + count)
      }
      groups.set(chosenParent, targetChildren)
    }

    return Array.from(groups.entries())
      .map(([parent, childrenMap]) => {
        const children = Array.from(childrenMap.entries())
          .map(([name, localCount]) => ({
            name,
            count: globalChildCounts.get(name) ?? localCount,
          }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        const aggregateNames = new Set<string>([parent, ...Array.from(childrenMap.keys())])
        const totalCount = Array.from(aggregateNames)
          .reduce((sum, name) => sum + (globalChildCounts.get(name) ?? 0), 0)
        return { parent, children, totalCount }
      })
      .sort((a, b) => b.totalCount - a.totalCount || a.parent.localeCompare(b.parent))
  }, [sourceScopedTabs, sourceScopedBookmarks])

  const parentCategoryFilterMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const group of categoriesFacet) {
      map.set(group.parent, new Set([group.parent, ...group.children.map((child) => child.name)]))
    }
    return map
  }, [categoriesFacet])

  const intentFacet = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of sourceScopedTabs) {
      const key = effectiveIntent(t) ?? 'other'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const b of sourceScopedBookmarks) {
      const key = effectiveIntent(b) ?? 'other'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
  }, [sourceScopedTabs, sourceScopedBookmarks])

  const platformFacet = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of sourceScopedTabs) {
      if (t.platform) counts.set(t.platform, (counts.get(t.platform) ?? 0) + 1)
    }
    for (const b of sourceScopedBookmarks) {
      if (b.platform) counts.set(b.platform, (counts.get(b.platform) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
  }, [sourceScopedTabs, sourceScopedBookmarks])

  const tagsFacet = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of sourceScopedTabs) {
      for (const tag of t.tags ?? []) {
        const value = tag.trim()
        if (!value) continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
    }
    for (const b of sourceScopedBookmarks) {
      for (const tag of b.tags ?? []) {
        const value = tag.trim()
        if (!value) continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  }, [sourceScopedTabs, sourceScopedBookmarks])

  const filteredBookmarks = useMemo(() => {
    if (activeFacets.length === 0) return sourceScopedBookmarks
    if (facetMode === 'domains') {
      return sourceScopedBookmarks.filter((item) => activeFacets.includes(item.domain))
    }
    if (facetMode === 'intent') {
      return sourceScopedBookmarks.filter((item) => activeFacets.includes(effectiveIntent(item) ?? 'other'))
    }
    if (facetMode === 'platform') {
      return sourceScopedBookmarks.filter((item) => item.platform != null && activeFacets.includes(item.platform))
    }
    if (facetMode === 'tags') {
      return sourceScopedBookmarks.filter((item) => {
        const tags = (item.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
        return tags.some((tag) => activeFacets.includes(tag))
      })
    }
    const { parentTokens, childTokens } = parseCategoryFacetTokens(activeFacets)
    const categoriesFromParents = new Set<string>()
    for (const parent of parentTokens) {
      const names = parentCategoryFilterMap.get(parent)
      if (!names) {
        categoriesFromParents.add(parent)
        continue
      }
      for (const name of names) categoriesFromParents.add(name)
    }
    return sourceScopedBookmarks.filter((item) => {
      const child = item.category?.trim()
      if (!child) return false
      return childTokens.has(child) || categoriesFromParents.has(child)
    })
  }, [sourceScopedBookmarks, activeFacets, facetMode, parentCategoryFilterMap])

  const filteredTabs = useMemo(() => {
    if (activeFacets.length === 0) return sourceScopedTabs
    if (facetMode === 'domains') {
      return sourceScopedTabs.filter((item) => activeFacets.includes(item.domain))
    }
    if (facetMode === 'intent') {
      return sourceScopedTabs.filter((item) => activeFacets.includes(effectiveIntent(item) ?? 'other'))
    }
    if (facetMode === 'platform') {
      return sourceScopedTabs.filter((item) => item.platform != null && activeFacets.includes(item.platform))
    }
    if (facetMode === 'tags') {
      return sourceScopedTabs.filter((item) => {
        const tags = (item.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
        return tags.some((tag) => activeFacets.includes(tag))
      })
    }
    const { parentTokens, childTokens } = parseCategoryFacetTokens(activeFacets)
    const categoriesFromParents = new Set<string>()
    for (const parent of parentTokens) {
      const names = parentCategoryFilterMap.get(parent)
      if (!names) {
        categoriesFromParents.add(parent)
        continue
      }
      for (const name of names) categoriesFromParents.add(name)
    }
    return sourceScopedTabs.filter((item) => {
      const child = item.category?.trim()
      if (!child) return false
      return childTokens.has(child) || categoriesFromParents.has(child)
    })
  }, [sourceScopedTabs, activeFacets, facetMode, parentCategoryFilterMap])

  const handleViewChange = useCallback((view: ViewId) => {
    setActiveView(view)
    setActiveFacets([])
  }, [])

  function renderActiveView() {
    const common: ViewProps = {
      bookmarks: filteredBookmarks,
      tabs: filteredTabs,
      loading,
      projectedPoints,
      clusterNames,
      onRunTags: handleRunTags,
      onRunEmbeddings: () => runEmbeddingPass(filteredTabs, filteredBookmarks, llmSettings),
      llmSettings,
      onSaveSettings: async (s) => {
        await setLlmSettings(s)
        setLlmSettingsState(s)
      },
    }

    if (activeView === 'list') {
      return (
        <ListView
          bookmarks={filteredBookmarks}
          tabs={filteredTabs}
          localUrlSet={localUrlSet}
          sourceFilter={sourceFilter}
          settings={llmSettings}
          loading={loading}
          viewMenuHost={viewMenuHost}
          onDeleteBookmark={async (id) => {
            await chrome.bookmarks.remove(id)
            setBookmarks((prev) => prev.filter((b) => b.id !== id))
          }}
          onCloseTab={async (id) => {
            await chrome.tabs.remove(id)
            setTabs((prev) => prev.filter((t) => t.id !== id))
          }}
          onActivateTab={activateTab}
        />
      )
    }

    const ActiveView = VIEW_COMPONENTS[activeView]
    return <ActiveView {...common} />
  }

  return (
    <DomainIconContext.Provider value={domainIconMap}>
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="shrink-0 px-6 py-4">
        <header className="flex items-center justify-between gap-4 pb-3">
          <div className="flex items-center gap-3">
            <img src="/icons/icon-48.png" alt="TabLab" className="h-6 w-6 rounded-sm" />
            <h1 className="text-xl font-bold tracking-tight text-foreground">TabLab</h1>
            <span className="text-sm text-muted-foreground">Lab for bookmark hoarders</span>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {loading && (
              <span className="flex items-center gap-1.5 text-accent">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </span>
            )}
            {!loading && lastUpdated && (
              <span>Updated {formatAge(lastUpdated)}</span>
            )}
            <span className="text-border">·</span>
            <DropdownMenu trigger="AI Actions" align="right">
              <>
                {aiActionItems.map((item) => (
                  <DropdownMenuItem
                    key={item.key}
                    onClick={item.onClick}
                    title={item.title}
                    className={
                      item.danger
                        ? 'text-muted-foreground/70 hover:bg-card hover:text-destructive'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground'
                    }
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                ))}
              </>
            </DropdownMenu>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1">
              {lastError && (
                <span className="flex items-center gap-1 text-destructive" title={lastError}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                  LLM: error
                </span>
              )}
              {llmAvailability === 'unavailable' && <span className="opacity-40">LLM: unavailable</span>}
              {llmAvailability === 'checking' && <span className="opacity-40">LLM: checking…</span>}
              {llmAvailability === 'after-download' && <span className="text-accent">LLM: downloading…</span>}
              {activeTasks.length === 0 && llmAvailability === 'ready' && <span className="text-primary">LLM: ready</span>}
              {activeTasks.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { void handleStopPipeline() }}
                  className="h-6 px-2 text-[11px] text-accent hover:text-destructive"
                  title="Stop current AI pipeline"
                >
                  {activeTasks.length > 0 ? `${activeTasks[0].label}: ${Math.round(activeTasks[0].percent)}% Stop` : 'LLM: running… Stop'}
                </Button>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={reload}
              disabled={loading}
              className="h-7 w-7"
              title="Reload"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </header>
        <div className="h-px bg-border/60" />
      </div>

      <div className="flex min-h-0 flex-1">
        <FacetSidebar
          sourceFilter={sourceFilter}
          onSourceFilterChange={handleSourceFilterChange}
          allowedSourceFilters={allowedSourceFilters}
          sourceCounts={sourceCounts}
          bookmarkScopeFilter={bookmarkScopeFilter}
          bookmarkFolderOptions={bookmarkFolderOptions}
          onBookmarkScopeChange={handleBookmarkScopeChange}
          domains={domainsFacet}
          categories={categoriesFacet}
          intents={intentFacet}
          platforms={platformFacet}
          tags={tagsFacet}
          activeMode={facetMode}
          activeValues={activeFacets}
          onModeChange={(m) => { setFacetMode(m); setActiveFacets([]) }}
          onToggle={(v) => setActiveFacets((prev) => {
            if (facetMode === 'categories') {
              return prev.includes(v) ? [] : [v]
            }
            return prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
          })}
          onClear={() => setActiveFacets([])}
          width={sidebarWidth}
        />

        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startDrag}
          className="relative w-2 shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border/35 after:transition-colors hover:after:bg-border/70"
        />

        <div className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden px-6">
          <div className="shrink-0">
            <ViewBar activeView={activeView} onChange={handleViewChange} />
          </div>

          <div className="shrink-0 pb-3">
            {VIEW_HINTS[activeView] && (
              <p className="mt-2 text-xs text-muted-foreground/70">{VIEW_HINTS[activeView]}</p>
            )}
            <div ref={setViewMenuHost} />
          </div>

          <div className="min-h-0 flex-1 overflow-auto pb-4">
            {renderActiveView()}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border/40 px-6 py-2 text-[11px] text-muted-foreground/50 flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <img src="/icons/aicrafted.png" alt="" className="h-4 w-4 rounded-sm opacity-60" />
          <span>{new Date().getFullYear()} AICrafted</span>
          <span>·</span>
          <a
            href="https://github.com/aicrafted/tab-lab/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-muted-foreground transition-colors"
          >
            Bugreport / feature request
          </a>
          <span>·</span>
          <a
            href="https://github.io/aicrafted/tab-lab/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-muted-foreground transition-colors"
          >
            Privacy policy
          </a>          
        </div>
        <div className="min-w-0 max-w-[50%] truncate text-left text-muted-foreground/70" title={footerTaskStatus}>
          Active tasks: &nbsp;
          {footerTaskStatus}
        </div>
      </footer>
    </div>
    </DomainIconContext.Provider>
  )
}

function formatProgressPercent(percent: number): string {
  if (!Number.isFinite(percent)) return '0'
  if (Math.abs(percent - Math.round(percent)) < 0.05) return String(Math.round(percent))
  return percent.toFixed(1)
}

interface AiActionItem {
  key: string
  label: string
  icon: LucideIcon
  title: string
  onClick: () => Promise<void>
  danger?: boolean
}
