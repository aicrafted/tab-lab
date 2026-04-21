import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { ListView } from '@/components/ListView'
import { TableView } from '@/components/TableView'
import { LlmSettingsView } from '@/components/views/settings/LlmSettingsView'
import { DomainsSettingsView } from '@/components/views/settings/DomainsSettingsView'
import { AdvancedSettingsView } from '@/components/views/settings/AdvancedSettingsView'
import { FacetSidebar, type CategoryGroupFacet } from '@/components/FacetSidebar'
import { ViewBar, VIEW_HINTS } from '@/components/ViewBar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  getBookmarkFolderDescendantIds,
  getBookmarkFolderOptions,
  type BookmarkFolderOption,
} from '@/lib/browser/bookmarks'
import { createCheckingAiSetupState, resolveAiSetupState, type AiSetupState } from '@/lib/ai/setup'
import { loadProjectionForCurrentModel } from '@/lib/ai/embedder'
import { loadHydratedData } from '@/lib/pipeline/initial-load'
import { loadClusterNames } from '@/lib/ai/cluster-names'
import { DOMAIN_PREFILL } from '@/lib/ai/domain-prefill'
import {
  getBookmarkScopeFilter,
  getLlmSettings,
  getSourceFilter,
  setBookmarkScopeFilter,
  setLlmSettings,
  setSourceFilter,
} from '@/lib/core/storage'
import { useResizable } from '@/hooks/useResizable'
import { useAiPipelines } from '@/hooks/useAiPipelines'
import { useOrchestratorTasks } from '@/hooks/useOrchestratorTasks'
import { useBrowserStateSync } from '@/hooks/useBrowserStateSync'
import type { BookmarkItem, BookmarkScopeFilter, TabItem, LlmSettings } from '@/lib/core/types'
import { DEFAULT_LLM_SETTINGS } from '@/lib/core/types'
import type { SourceFilter, ViewId, ViewProps } from '@/components/views/types'
import { DomainIconContext } from '@/components/Favicon'
import { effectiveIntent } from '@/lib/ai/static-intent'
import { isLocalHost, isLocalUrl } from '@/lib/core/local-network'
import { parseCategoryFacetTokens } from '@/lib/core/facet-utils'
import { scoreFaviconCandidate } from '@/lib/ui/favicon-utils'
import { formatAge } from '@/lib/core/utils'
import { getAllDomainRows, type DomainRow } from '@/lib/db/domain-repo'
import { Brain, ChevronDown, ChevronUp, Database, Eraser, Hash, RefreshCw, Tag, Wand2, type LucideIcon } from 'lucide-react'
import { TriageView } from '@/components/views/TriageView'
import { KanbanView } from '@/components/views/KanbanView'
import { TimelineView } from '@/components/views/TimelineView'
import { MagazineView } from '@/components/views/MagazineView'
import { TreemapView } from '@/components/views/TreemapView'
import { SemanticMapView } from '@/components/views/SemanticMapView'
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
import { ACTIVE_BUILD, IS_DEV } from '@/lib/core/constants'

type FacetMode = 'domains' | 'categories' | 'universal'

interface UniversalFacetFilters {
  intent: string | null
  platform: string | null
  tags: string[]
}

interface DomainCategoryGroup {
  category: string
  domains: string[]
  count: number
}

const VIEW_HINTS_COLLAPSED_KEY = 'tablab.view-hints.collapsed'

const ALL_VIEW_COMPONENTS: Record<Exclude<ViewId, 'list' | 'table'>, (props: ViewProps) => JSX.Element> = {
  triage: TriageView,
  kanban: KanbanView,
  timeline: TimelineView,
  magazine: MagazineView,
  treemap: TreemapView,
  semantic: SemanticMapView,
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
  'settings-domains': DomainsSettingsView,
  'settings-advanced': AdvancedSettingsView,
}

const VIEW_COMPONENTS = Object.fromEntries(
  Object.entries(ALL_VIEW_COMPONENTS).filter(([id, comp]) => !!comp && !ACTIVE_BUILD.views.hide.includes(id as ViewId))
) as Record<Exclude<ViewId, 'list' | 'table'>, (props: ViewProps) => JSX.Element>

const VIEW_SOURCE_FILTER_POLICY: Partial<Record<ViewId, SourceFilter[]>> = {
  list: ['bookmarks', 'tabs', 'both'],
  table: ['bookmarks', 'tabs', 'both'],
}
const STALE_BOOKMARK_MS = 180 * 86_400_000
const STALE_TAB_MS = 30 * 86_400_000
const isStaleBookmark = (bookmark: BookmarkItem, now: number) => {
  const marker = bookmark.lastVisited ?? bookmark.dateAdded
  return marker < now - STALE_BOOKMARK_MS
}

function filterItems<T extends TabItem | BookmarkItem>(
  items: T[],
  activeFacets: string[],
  facetMode: FacetMode,
  parentCategoryFilterMap: Map<string, Set<string>>,
  universalFilters: UniversalFacetFilters,
  activeDomainCategory: string | null,
  domainCategoryGroups: DomainCategoryGroup[],
): T[] {
  if (facetMode === 'domains') {
    if (activeDomainCategory) {
      const group = domainCategoryGroups.find((entry) => entry.category === activeDomainCategory)
      const domainsInCategory = new Set(group?.domains ?? [])
      if (domainsInCategory.size === 0) return items
      return items.filter((item) => domainsInCategory.has(item.domain))
    }
    if (activeFacets.length === 0) return items
    return items.filter((item) => activeFacets.includes(item.domain))
  }
  if (facetMode === 'categories') {
    if (activeFacets.length === 0) return items
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

    return items.filter((item) => {
      const child = item.category?.trim()
      if (!child) return false
      return childTokens.has(child) || categoriesFromParents.has(child)
    })
  }

  const hasUniversalFilter = Boolean(universalFilters.intent)
    || Boolean(universalFilters.platform)
    || universalFilters.tags.length > 0
  if (!hasUniversalFilter) return items

  return items.filter((item) => {
    if (universalFilters.intent && effectiveIntent(item) !== universalFilters.intent) return false
    if (universalFilters.platform && item.platform !== universalFilters.platform) return false
    if (universalFilters.tags.length > 0) {
      const tags = (item.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
      if (!tags.some((tag) => universalFilters.tags.includes(tag))) return false
    }
    return true
  })
}

export function App() {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [tabs, setTabs] = useState<TabItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [aiStartup, setAiStartup] = useState<AiSetupState>(() => createCheckingAiSetupState())
  const [, setLlmError] = useState<string | undefined>(undefined)
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS)
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const [activeView, setActiveView] = useState<ViewId>('table')
  const [sourceFilter, setSourceFilterState] = useState<SourceFilter>('both')
  const [triageFilter, setTriageFilter] = useState<string | null>(null)
  const [bookmarkScopeFilter, setBookmarkScopeFilterState] = useState<BookmarkScopeFilter>({ mode: 'root' })
  const [bookmarkFolderOptions, setBookmarkFolderOptions] = useState<BookmarkFolderOption[]>([])
  const [bookmarkScopeDescendants, setBookmarkScopeDescendants] = useState<Set<string> | null>(null)
  const [facetMode, setFacetMode] = useState<FacetMode>('domains')
  const [activeFacets, setActiveFacets] = useState<string[]>([])
  const [universalFilters, setUniversalFilters] = useState<UniversalFacetFilters>({ intent: null, platform: null, tags: [] })
  const [viewMenuHost, setViewMenuHost] = useState<HTMLDivElement | null>(null)
  const [, startFilterTransition] = useTransition()
  const { width: sidebarWidth, startDrag } = useResizable(280, 280, 400)
  const [projectedPoints, setProjectedPoints] = useState<Map<string, [number, number]>>(new Map())
  const [clusterNames, setClusterNames] = useState<Map<number, string>>(new Map())
  const [hintsCollapsed, setHintsCollapsed] = useState(false)
  const [manualFacetsCollapsed, setManualFacetsCollapsed] = useState(false)
  const [enrichedDomainRows, setEnrichedDomainRows] = useState<DomainRow[]>([])
  const [activeDomainCategory, setActiveDomainCategory] = useState<string | null>(null)
  const [lastDomainTaskFinishedAt, setLastDomainTaskFinishedAt] = useState<number | null>(null)

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
    setAiStartup(createCheckingAiSetupState(llmSettings))
    void resolveAiSetupState(llmSettings).then((status) => {
      if (!active) return
      setAiStartup(status)
    }).catch(() => {
      if (!active) return
      setAiStartup({
        ...createCheckingAiSetupState(llmSettings),
        chat: { provider: llmSettings.tasks.chat.provider, model: '', configured: false, status: 'error', message: 'Failed to check chat status' },
        embedding: { provider: llmSettings.tasks.embedding.provider, model: '', configured: false, status: 'error', message: 'Failed to check embedding status' },
        canRunPipeline: false,
        shouldOpenSettings: true,
        blockingReason: 'Failed to check AI startup state',
      })
    })
    return () => { active = false }
  }, [llmSettings, settingsHydrated])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_HINTS_COLLAPSED_KEY)
      if (stored === '1') setHintsCollapsed(true)
    } catch {
      // Ignore storage access issues and keep default state.
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_HINTS_COLLAPSED_KEY, hintsCollapsed ? '1' : '0')
    } catch {
      // Ignore storage access issues.
    }
  }, [hintsCollapsed])

  useEffect(() => {
    void getAllDomainRows().then(setEnrichedDomainRows).catch(() => {})
  }, [])

  const refreshEnrichedDomainRows = useCallback(async () => {
    const rows = await getAllDomainRows()
    setEnrichedDomainRows(rows)
  }, [])

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
    handleReintent,
    handlePostProcessCategories,
    handleNormalizeCategories,
    handleGroupRareCategories,
    handleSplitCategories,
    handleRunTags,
    handleRunLabels,
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

  const { tasks, activeTasks, lastError } = useOrchestratorTasks(orchestrator)
  const llmNeedsSetup = !aiStartup.canRunPipeline || Boolean(lastError)
  const chatStatusLabel = formatStartupCapabilityLabel(aiStartup.chat.status)
  const embeddingStatusLabel = formatStartupCapabilityLabel(aiStartup.embedding.status)
  const chatBadgeWarn = Boolean(lastError) || aiStartup.chat.status !== 'ready'
  const embedBadgeWarn = Boolean(lastError) || aiStartup.embedding.status !== 'ready'
  useEffect(() => {
    const finishedAt = tasks.find((task) => task.id === 'domains' && task.status === 'done')?.finishedAt ?? null
    if (!finishedAt || finishedAt === lastDomainTaskFinishedAt) return
    setLastDomainTaskFinishedAt(finishedAt)
    void refreshEnrichedDomainRows()
  }, [tasks, lastDomainTaskFinishedAt, refreshEnrichedDomainRows])

  // Sync data with browser events
  useBrowserStateSync(doLoad)



  const aiActionItems: AiActionItem[] = [
    { key: 'full', label: 'Run full AI pipeline', icon: Wand2, title: 'Run full processing pipeline (domains -> embeddings -> labels -> classification)', onClick: () => runAutoAiPipeline(tabs, bookmarks, tabs) },
    { key: 'domains', label: 'Domains enrichment', icon: Database, title: 'Fetch and cache domain metadata', onClick: handleRunDomainKnowledge },
    ...(IS_DEV ? [
      { key: 'redomains', label: 'Re-Domains', icon: Database, title: 'Clear and rebuild domain knowledge cache', onClick: handleRedomainKnowledge },
    ] : []),
    { key: 'embeddings', label: 'Build semantic', icon: Brain, title: 'Generate embeddings and 2D projection', onClick: () => runEmbeddingPass(tabs, bookmarks, llmSettings) },
    ...(IS_DEV ? [
      { key: 'reembed', label: 'Re-embed', icon: Brain, title: 'Clear embedding cache and re-embed all pages', onClick: handleReembedAll },
    ] : []),
    { key: 'labels', label: 'Labels inference', icon: Hash, title: 'Classify pages by tags and intent', onClick: handleRunLabels },
    ...(IS_DEV ? [
      { key: 'retag', label: 'Re-Tags', icon: Hash, title: 'Clear only tags cache and run tagging again', onClick: handleRetag },
      { key: 'reintent', label: 'Re-Intent', icon: Tag, title: 'Clear only intent cache and classify intent again', onClick: handleReintent },
    ] : []),
    { key: 'classify', label: 'Classify', icon: Wand2, title: 'Assign topical categories to all pages', onClick: handleClassify },
    ...(IS_DEV ? [
      { key: 'reclassify', label: 'Re-Classify', icon: Wand2, title: 'Clear only category cache and classify again', onClick: handleReclassify },
      { key: 'postcategories', label: 'Post-Categories', icon: Wand2, title: 'Run ALL category post-processing (normalize + group rare)', onClick: handlePostProcessCategories },
      { key: 'normalize', label: 'Normalize', icon: RefreshCw, title: 'Normalize category labels (Phase 1: Discovery + Phase 2: Vector mapping)', onClick: handleNormalizeCategories },
      { key: 'grouprare', label: 'Group Rare', icon: Tag, title: 'Group sparse categories into frequent ones', onClick: handleGroupRareCategories },
      { key: 'split', label: 'Split Clusters', icon: Hash, title: 'Split large categories using sub-clustering', onClick: handleSplitCategories },
    ] : []),
    { key: 'clear', label: 'Clear cache', icon: Eraser, title: 'Clear all cached AI data', onClick: handleClearCache, danger: true },
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
    const cached2D = await loadProjectionForCurrentModel(llmSettings)
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
  const triageFacetSupported = activeView === 'table'
  const isSettingsView = activeView.startsWith('settings-')
  const facetsCollapsed = isSettingsView || manualFacetsCollapsed

  useEffect(() => {
    if (allowedSourceFilters.includes(sourceFilter)) return
    const fallback = allowedSourceFilters[0] ?? 'both'
    setSourceFilterState(fallback)
    void setSourceFilter(fallback)
  }, [allowedSourceFilters, sourceFilter])

  useEffect(() => {
    setTriageFilter(null)
  }, [sourceFilter])

  useEffect(() => {
    setActiveDomainCategory(null)
  }, [sourceFilter])

  useEffect(() => {
    if (triageFacetSupported) return
    setTriageFilter(null)
  }, [triageFacetSupported])

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

  const domainCategoryMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of enrichedDomainRows) {
      if (row.category) map.set(row.domain, row.category)
    }
    for (const [domain, info] of Object.entries(DOMAIN_PREFILL)) {
      if (info.category) map.set(domain, info.category)
    }
    return map
  }, [enrichedDomainRows])

  const domainCategoryGroups = useMemo<DomainCategoryGroup[]>(() => {
    const byCategory = new Map<string, { domains: string[]; count: number }>()
    const localNetworks = llmSettings.localNetworks
    for (const { value: domain, count } of domainsFacet) {
      const category = isLocalHost(domain, localNetworks)
        ? 'Local'
        : domainCategoryMap.get(domain)
      if (!category) continue
      const entry = byCategory.get(category) ?? { domains: [], count: 0 }
      entry.domains.push(domain)
      entry.count += count
      byCategory.set(category, entry)
    }
    return Array.from(byCategory.entries())
      .map(([category, { domains, count }]) => ({ category, domains, count }))
      .sort((a, b) => b.count - a.count)
  }, [domainCategoryMap, domainsFacet, llmSettings.localNetworks])

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
      const key = effectiveIntent(t)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const b of sourceScopedBookmarks) {
      const key = effectiveIntent(b)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
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
    return filterItems(
      sourceScopedBookmarks,
      activeFacets,
      facetMode,
      parentCategoryFilterMap,
      universalFilters,
      activeDomainCategory,
      domainCategoryGroups,
    )
  }, [sourceScopedBookmarks, activeFacets, facetMode, parentCategoryFilterMap, universalFilters, activeDomainCategory, domainCategoryGroups])

  const filteredTabs = useMemo(() => {
    return filterItems(
      sourceScopedTabs,
      activeFacets,
      facetMode,
      parentCategoryFilterMap,
      universalFilters,
      activeDomainCategory,
      domainCategoryGroups,
    )
  }, [sourceScopedTabs, activeFacets, facetMode, parentCategoryFilterMap, universalFilters, activeDomainCategory, domainCategoryGroups])

  const { multiFolderUrls, triageChipCounts } = useMemo(() => {
    const now = Date.now()
    const foldersByUrl = new Map<string, Set<string>>()

    let duplicateBookmarksCount = 0
    let neverOpenedCount = 0
    let transactionalBookmarksCount = 0
    let staleBookmarksCount = 0
    let openNowCount = 0

    for (const bookmark of filteredBookmarks) {
      if (bookmark.isDuplicate === true) duplicateBookmarksCount += 1
      if (bookmark.lastVisited == null && bookmark.visitCount == null) neverOpenedCount += 1
      if (effectiveIntent(bookmark) === 'transactional') transactionalBookmarksCount += 1
      if (isStaleBookmark(bookmark, now)) staleBookmarksCount += 1
      if (bookmark.isOpen === true) openNowCount += 1

      const folders = foldersByUrl.get(bookmark.url) ?? new Set<string>()
      if (bookmark.folder) folders.add(bookmark.folder)
      foldersByUrl.set(bookmark.url, folders)
    }

    const multiFolderUrlsLocal = new Set(
      Array.from(foldersByUrl.entries())
        .filter(([, folders]) => folders.size > 1)
        .map(([url]) => url),
    )

    let multiFolderCount = 0
    for (const bookmark of filteredBookmarks) {
      if (multiFolderUrlsLocal.has(bookmark.url)) multiFolderCount += 1
    }

    let duplicateTabsCount = 0
    let transactionalTabsCount = 0
    let staleTabsCount = 0
    let bookmarkedTabsCount = 0

    for (const tab of filteredTabs) {
      if (tab.isDuplicate === true) duplicateTabsCount += 1
      if (effectiveIntent(tab) === 'transactional') transactionalTabsCount += 1
      if (tab.lastAccessed < now - STALE_TAB_MS) staleTabsCount += 1
      if (tab.isBookmarked === true) bookmarkedTabsCount += 1
    }

    return {
      multiFolderUrls: multiFolderUrlsLocal,
      triageChipCounts: {
        duplicates: duplicateBookmarksCount + duplicateTabsCount,
        'never-opened': neverOpenedCount,
        transactional: transactionalBookmarksCount + transactionalTabsCount,
        stale: staleBookmarksCount + staleTabsCount,
        'open-now': openNowCount,
        'multi-folder': multiFolderCount,
        bookmarked: bookmarkedTabsCount,
      } as Record<string, number>,
    }
  }, [filteredBookmarks, filteredTabs])

  const handleViewChange = useCallback((view: ViewId) => {
    setActiveView(view)
    setActiveFacets([])
  }, [])

  function renderActiveView() {
    const common: ViewProps = {
      bookmarks: filteredBookmarks,
      tabs: filteredTabs,
      sourceFilter,
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
      viewMenuHost,
    }

    if (activeView === 'table') {
      return (
        <TableView
          bookmarks={filteredBookmarks}
          tabs={filteredTabs}
          localUrlSet={localUrlSet}
          triageFilter={triageFilter}
          multiFolderUrls={multiFolderUrls}
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
    if (activeView === 'list') {
      return (
        <ListView
          bookmarks={filteredBookmarks}
          tabs={filteredTabs}
          sourceFilter={sourceFilter}
          loading={loading}
          viewMenuHost={viewMenuHost}
        />
      )
    }

    const ActiveView = VIEW_COMPONENTS[activeView as keyof typeof VIEW_COMPONENTS]
    if (!ActiveView) {
      // Fallback to Triage if requested view is hidden/unavailable
      return <TriageView {...common} />
    }
    return <ActiveView {...common} />
  }

  return (
    <DomainIconContext.Provider value={domainIconMap}>
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="shrink-0 px-6 py-2">
        <header className="flex items-center justify-between gap-4 pb-2">
          <div className="flex items-center gap-3">
            <img src="/icons/icon-48.png" alt="TabLab" className="h-6 w-6 rounded-sm" />
            <h1 className="text-xl font-bold tracking-tight text-foreground">TabLab</h1>
            <div className="flex flex-col leading-tight">
              <span className="text-sm text-muted-foreground">Lab for bookmark hoarders</span>
              <span className="text-xs text-muted-foreground/50">v{chrome.runtime.getManifest().version}</span>
            </div>
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
            <Button
              size="sm"
              onClick={() => {
                if (llmNeedsSetup) {
                  setActiveView('settings-llm')
                } else {
                  void runAutoAiPipeline(tabs, bookmarks, tabs)
                }
              }}
              disabled={activeTasks.length > 0 || loading}
              className="h-6 gap-1 px-2 text-[11px]"
              title={llmNeedsSetup ? 'AI is not ready — open settings' : 'Run full AI processing pipeline'}
            >
              <Wand2 className="h-3 w-3" />
              Run AI
            </Button>
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
                <button
                  type="button"
                  onClick={() => setActiveView('settings-llm')}
                  className="flex items-center gap-1 text-destructive transition-opacity hover:opacity-100 opacity-90"
                  title={`${lastError} (click to open settings)`}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                  LLM: error
                </button>
              )}
              {activeTasks.length === 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => { if (llmNeedsSetup) setActiveView('settings-llm') }}
                    className={chatBadgeWarn
                      ? 'rounded bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300 transition-opacity hover:opacity-100'
                      : 'rounded bg-primary/15 px-2 py-0.5 text-[11px] text-primary'}
                    title={[
                      `Chat: ${aiStartup.chat.provider} (${chatStatusLabel})${aiStartup.chat.model ? ` — ${aiStartup.chat.model}` : ''}`,
                      aiStartup.chat.message ?? '',
                      lastError ? `Last error: ${lastError}` : '',
                    ].filter(Boolean).join('\n')}
                  >
                    chat
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (llmNeedsSetup) setActiveView('settings-llm') }}
                    className={embedBadgeWarn
                      ? 'rounded bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300 transition-opacity hover:opacity-100'
                      : 'rounded bg-primary/15 px-2 py-0.5 text-[11px] text-primary'}
                    title={[
                      `Embeddings: ${aiStartup.embedding.provider} (${embeddingStatusLabel})${aiStartup.embedding.model ? ` — ${aiStartup.embedding.model}` : ''}`,
                      aiStartup.embedding.message ?? '',
                      lastError ? `Last error: ${lastError}` : '',
                    ].filter(Boolean).join('\n')}
                  >
                    embed
                  </button>
                </>
              )}
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
          triageFilter={triageFilter}
          onTriageFilterChange={setTriageFilter}
          triageChipCounts={triageChipCounts}
          showTriageFilters={triageFacetSupported}
          allowedSourceFilters={allowedSourceFilters}
          sourceCounts={sourceCounts}
          bookmarkScopeFilter={bookmarkScopeFilter}
          bookmarkFolderOptions={bookmarkFolderOptions}
          onBookmarkScopeChange={handleBookmarkScopeChange}
          domains={domainsFacet}
          domainCategoryGroups={domainCategoryGroups}
          categories={categoriesFacet}
          intents={intentFacet}
          platforms={platformFacet}
          tags={tagsFacet}
          activeMode={facetMode}
          activeValues={activeFacets}
          activeDomainCategory={activeDomainCategory}
          universalIntent={universalFilters.intent}
          universalPlatform={universalFilters.platform}
          universalTags={universalFilters.tags}
          onModeChange={(m) => {
            setFacetMode(m)
            setActiveFacets([])
            setActiveDomainCategory(null)
          }}
          onToggle={(v) => setActiveFacets((prev) => {
            if (facetMode === 'categories' || facetMode === 'domains') {
              if (facetMode === 'domains') setActiveDomainCategory(null)
              return prev.includes(v) ? [] : [v]
            }
            return prev
          })}
          onUniversalIntentChange={(value) => setUniversalFilters((prev) => ({ ...prev, intent: value }))}
          onUniversalPlatformChange={(value) => setUniversalFilters((prev) => ({ ...prev, platform: value }))}
          onUniversalTagToggle={(value) => setUniversalFilters((prev) => (
            prev.tags.includes(value)
              ? { ...prev, tags: [] }
              : { ...prev, tags: [value] }
          ))}
          onDomainCategoryChange={(category) => {
            setActiveFacets([])
            setActiveDomainCategory((prev) => (prev === category ? null : category))
          }}
          onClear={() => {
            if (facetMode === 'universal') {
              setUniversalFilters({ intent: null, platform: null, tags: [] })
              return
            }
            setActiveFacets([])
            setActiveDomainCategory(null)
          }}
          width={sidebarWidth}
          collapsed={facetsCollapsed}
          onCollapsedChange={isSettingsView ? undefined : setManualFacetsCollapsed}
        />

        {!facetsCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startDrag}
            className="relative w-2 shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border/35 after:transition-colors hover:after:bg-border/70"
          />
        )}

        <div className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden px-6">
          <div className="shrink-0">
            <ViewBar activeView={activeView} onChange={handleViewChange} />
          </div>

          <div className="shrink-0 pb-3 flex flex-col gap-3">
            {VIEW_HINTS[activeView] && (
              <div className="rounded-md border border-border/40 bg-card/10 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-xs leading-5 text-muted-foreground/55 ${hintsCollapsed ? 'overflow-hidden text-ellipsis whitespace-nowrap' : ''}`}>
                    {VIEW_HINTS[activeView]}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setHintsCollapsed((prev) => !prev)}
                    className="h-6 shrink-0 px-1.5 text-muted-foreground/55 hover:text-muted-foreground"
                    title={hintsCollapsed ? 'Expand hints' : 'Collapse hints to one line'}
                  >
                    {hintsCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
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
            href="https://aicrafted.github.io/tab-lab/privacy.html"
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

function formatStartupCapabilityLabel(status: 'checking' | 'ready' | 'loading' | 'unavailable' | 'unsupported' | 'error'): string {
  if (status === 'checking') return 'checking'
  if (status === 'ready') return 'ready'
  if (status === 'loading') return 'loading'
  if (status === 'unsupported') return 'unsupported'
  if (status === 'error') return 'error'
  return 'unavailable'
}

interface AiActionItem {
  key: string
  label: string
  icon: LucideIcon
  title: string
  onClick: () => Promise<void>
  danger?: boolean
}
