import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { ListView } from '@/components/ListView'
import { StatusBar } from '@/components/StatusBar'
import { LlmSettingsPanel } from '@/components/LlmSettings'
import { FacetSidebar } from '@/components/FacetSidebar'
import { ViewBar, VIEW_HINTS } from '@/components/ViewBar'
import {
  exportToChromeFolders,
  getBookmarkFolderDescendantIds,
  getBookmarkFolderOptions,
  type BookmarkFolderOption,
} from '@/lib/bookmarks'
import { checkLlmAvailability, type LlmStatus } from '@/lib/classifier'
import { loadCached2D } from '@/lib/embedder'
import { loadHydratedData } from '@/lib/initial-load'
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
import type { PipelineTaskProgress } from '@/hooks/useAiPipelines'
import type { BookmarkItem, BookmarkScopeFilter, TabItem, LlmSettings } from '@/lib/types'
import { DEFAULT_LLM_SETTINGS } from '@/lib/types'
import type { SourceFilter, ViewId, ViewProps } from '@/components/views/types'
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
}

export function App() {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [tabs, setTabs] = useState<TabItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [llmStatus, setLlmStatus] = useState<LlmStatus>('checking')
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS)
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [activeView, setActiveView] = useState<ViewId>('list')
  const [sourceFilter, setSourceFilterState] = useState<SourceFilter>('both')
  const [bookmarkScopeFilter, setBookmarkScopeFilterState] = useState<BookmarkScopeFilter>({ mode: 'root' })
  const [bookmarkFolderOptions, setBookmarkFolderOptions] = useState<BookmarkFolderOption[]>([])
  const [bookmarkScopeDescendants, setBookmarkScopeDescendants] = useState<Set<string> | null>(null)
  const [facetMode, setFacetMode] = useState<'domains' | 'categories'>('domains')
  const [activeFacets, setActiveFacets] = useState<string[]>([])
  const [activeTasks, setActiveTasks] = useState<Record<string, PipelineTaskProgress>>({})
  const [, startFilterTransition] = useTransition()
  const { width: sidebarWidth, startDrag } = useResizable(220, 220, 400)
  const [projectedPoints, setProjectedPoints] = useState<Map<string, [number, number]>>(new Map())

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
    setLlmStatus('checking')
    void checkLlmAvailability(llmSettings).then((status) => {
      if (!active) return
      setLlmStatus(status)
    }).catch(() => {
      if (!active) return
      setLlmStatus('unavailable')
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
    runEmbeddingPass,
    runAutoAiPipeline,
    handleClearCache,
    handleClassify,
    handleRunIntent,
    handlePass2,
    handlePass3,
    handleRunTags,
    handleReembedAll,
  } = useAiPipelines({
    bookmarks,
    tabs,
    llmSettings,
    setBookmarks,
    setTabs,
    setLlmStatus,
    setProjectedPoints,
    reload,
    onTaskProgress: (update) => {
      setActiveTasks((prev) => {
        if (update.status === 'running') {
          return { ...prev, [update.id]: update }
        }
        if (!(update.id in prev)) return prev
        const next = { ...prev }
        delete next[update.id]
        return next
      })
    },
  })

  const footerTaskStatus = useMemo(() => {
    const running = Object.values(activeTasks)
      .filter((task) => task.status === 'running')
      .sort((a, b) => a.label.localeCompare(b.label))

    if (running.length === 0) return 'Standby'
    return running
      .map((task) => `${task.label}: ${task.done}/${task.total} ${formatProgressPercent(task.percent)}%`)
      .join(' · ')
  }, [activeTasks])

  useEffect(() => {
    if (llmStatus === 'ready' || llmStatus === 'unavailable') {
      setActiveTasks({})
    }
  }, [llmStatus])

  async function doLoad() {
    const [hydrated, folderOptions] = await Promise.all([
      loadHydratedData(),
      getBookmarkFolderOptions(),
    ])
    setBookmarks(hydrated.bookmarks)
    setTabs(hydrated.tabs)
    setBookmarkFolderOptions(folderOptions)

    // Restore cached 2D projection (Semantic Map coords)
    const cached2D = await loadCached2D()
    if (cached2D.size > 0) setProjectedPoints(cached2D)

    setLastUpdated(Date.now())
    setLoading(false)

    void runAutoAiPipeline(
      hydrated.rawLinked.tabs,
      hydrated.rawLinked.bookmarks,
      hydrated.tabsWithCategoryCache,
    )
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
  const handleExport = async () => {
    const withCategory = bookmarks.filter(b => b.category && !b.isDuplicate)
    if (withCategory.length === 0) return
    const confirmed = confirm(
      `Create ${[...new Set(withCategory.map(b => b.category!))].length} folders under "TabLab" in your bookmarks bar and move ${withCategory.length} bookmarks? This reorganizes your bookmarks.`,
    )
    if (!confirmed) return
    try {
      const result = await exportToChromeFolders(bookmarks)
      alert(`Exported ${result.exported} bookmarks into ${result.folders} folders.`)
      reload()
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

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

  const categoriesFacet = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of sourceScopedTabs) {
      if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
    }
    for (const b of sourceScopedBookmarks) {
      if (b.category) counts.set(b.category, (counts.get(b.category) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
  }, [sourceScopedTabs, sourceScopedBookmarks])

  const filteredBookmarks = useMemo(() => {
    if (activeFacets.length === 0) return sourceScopedBookmarks
    if (facetMode === 'domains') {
      return sourceScopedBookmarks.filter((item) => activeFacets.includes(item.domain))
    }
    return sourceScopedBookmarks.filter((item) => item.category != null && activeFacets.includes(item.category))
  }, [sourceScopedBookmarks, activeFacets, facetMode])

  const filteredTabs = useMemo(() => {
    if (activeFacets.length === 0) return sourceScopedTabs
    if (facetMode === 'domains') {
      return sourceScopedTabs.filter((item) => activeFacets.includes(item.domain))
    }
    return sourceScopedTabs.filter((item) => item.category != null && activeFacets.includes(item.category))
  }, [sourceScopedTabs, activeFacets, facetMode])

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
      onRunTags: handleRunTags,
      onRunEmbeddings: () => runEmbeddingPass(filteredTabs, filteredBookmarks, llmSettings),
    }

    if (activeView === 'list') {
      return (
        <ListView
          bookmarks={filteredBookmarks}
          tabs={filteredTabs}
          sourceFilter={sourceFilter}
          settings={llmSettings}
          loading={loading}
          onDeleteBookmark={async (id) => {
            await chrome.bookmarks.remove(id)
            setBookmarks((prev) => prev.filter((b) => b.id !== id))
          }}
          onExport={handleExport}
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
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="shrink-0 px-6 py-4">
        <header className="mb-3 flex items-center gap-3">
          <img src="/icons/aicrafted.png" alt="TabLab" className="h-6 w-6 rounded-sm" />
          <h1 className="text-xl font-bold tracking-tight text-foreground">TabLab</h1>
          <span className="text-sm text-muted-foreground">Lab for bookmark hoarders</span>
        </header>

        <StatusBar
          bookmarkCount={bookmarks.length}
          tabCount={tabs.length}
          loading={loading}
          lastUpdated={lastUpdated}
          onReload={reload}
          llmStatus={llmStatus}
          onSettingsClick={() => setShowSettings(s => !s)}
          ai={{
            onClearCache: handleClearCache,
            onClassify: handleClassify,
            onRunTags: handleRunTags,
            onMergeCategories: handlePass2,
            onSplitLarge: handlePass3,
            onRunIntent: handleRunIntent,
            onRunEmbeddings: () => runEmbeddingPass(tabs, bookmarks, llmSettings),
            onReembed: handleReembedAll,
          }}
        />
        <LlmSettingsPanel
          open={showSettings}
          settings={llmSettings}
          onSave={async (s) => {
            await setLlmSettings(s)
            setLlmSettingsState(s)
          }}
          onClose={() => setShowSettings(false)}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <FacetSidebar
          sourceFilter={sourceFilter}
          onSourceFilterChange={handleSourceFilterChange}
          sourceCounts={sourceCounts}
          bookmarkScopeFilter={bookmarkScopeFilter}
          bookmarkFolderOptions={bookmarkFolderOptions}
          onBookmarkScopeChange={handleBookmarkScopeChange}
          domains={domainsFacet}
          categories={categoriesFacet}
          activeMode={facetMode}
          activeValues={activeFacets}
          onModeChange={(m) => { setFacetMode(m); setActiveFacets([]) }}
          onToggle={(v) => setActiveFacets(prev =>
            prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v],
          )}
          onClear={() => setActiveFacets([])}
          width={sidebarWidth}
        />

        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startDrag}
          className="relative w-2 shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border/35 after:transition-colors hover:after:bg-border/70"
        />

        <div className="min-w-0 flex flex-1 flex-col px-6">
          <div className="shrink-0 py-3">
            <ViewBar activeView={activeView} onChange={handleViewChange} />
            {VIEW_HINTS[activeView] && (
              <p className="mt-2 text-xs text-muted-foreground/70">{VIEW_HINTS[activeView]}</p>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto pb-4">
            {renderActiveView()}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border/40 px-6 py-2 text-[11px] text-muted-foreground/50 flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/icons/aicrafted.png" alt="" className="h-3 w-3 rounded-sm opacity-60" />
          <span>© {new Date().getFullYear()} AICrafted</span>
          <span>·</span>
          <a
            href="https://github.com/aicrafted/tab-lab"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-muted-foreground transition-colors"
          >
            github.com/aicrafted/tab-lab
          </a>
        </div>
        <div className="min-w-0 max-w-[50%] truncate text-left text-muted-foreground/70" title={footerTaskStatus}>
          {footerTaskStatus}
        </div>
      </footer>
    </div>
  )
}

function formatProgressPercent(percent: number): string {
  if (!Number.isFinite(percent)) return '0'
  if (Math.abs(percent - Math.round(percent)) < 0.05) return String(Math.round(percent))
  return percent.toFixed(1)
}
