import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListView } from '@/components/ListView'
import { StatusBar } from '@/components/StatusBar'
import { LlmSettingsPanel } from '@/components/LlmSettings'
import { FacetSidebar } from '@/components/FacetSidebar'
import { ViewBar, VIEW_HINTS } from '@/components/ViewBar'
import { getAllBookmarks, exportToChromeFolders } from '@/lib/bookmarks'
import { getAllTabs } from '@/lib/tabs'
import { crossLink } from '@/lib/crosslink'
import { checkLlmAvailability, classifyTabs, classifyBookmarks, classifyWithLmStudio, loadCachedCategories, loadCachedTags, loadCachedIntents, normalizeCategoryLabels, splitLargeClusters, type LlmStatus } from '@/lib/classifier'
import { tagWithGeminiNano, tagWithLmStudio } from '@/lib/tagger'
import { classifyIntentGeminiNano, classifyIntentLmStudio } from '@/lib/intent'
import { clearEmbeddingCache, fetchEmbeddingsBatch, loadCached2D, reprojectAllEmbeddings } from '@/lib/embedder'
import { getLlmSettings, getSourceFilter, setLlmSettings, setSourceFilter, setCached, clearAllAICache } from '@/lib/storage'
import { useResizable } from '@/hooks/useResizable'
import type { BookmarkItem, TabItem, LlmSettings } from '@/lib/types'
import { DEFAULT_LLM_SETTINGS } from '@/lib/types'
import type { SourceFilter, ViewId } from '@/components/views/types'
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

function createTaskLogger(task: string, total: number) {
  const safeTotal = Math.max(1, total)
  let done = 0
  const startedAt = Date.now()
  console.info(`[llm:${task}] start`, { total })

  return {
    progress(delta: number) {
      done = Math.min(safeTotal, done + Math.max(0, delta))
      const pct = Math.round((done / safeTotal) * 100)
      console.info(`[llm:${task}] progress ${done}/${safeTotal} (${pct}%)`)
    },
    done(extra?: Record<string, unknown>) {
      console.info(`[llm:${task}] done`, {
        elapsedMs: Date.now() - startedAt,
        ...extra,
      })
    },
    failed(error: unknown) {
      console.error(`[llm:${task}] failed`, error)
    },
  }
}

export function App() {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [tabs, setTabs] = useState<TabItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [llmStatus, setLlmStatus] = useState<LlmStatus>('checking')
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [activeView, setActiveView] = useState<ViewId>('list')
  const [sourceFilter, setSourceFilterState] = useState<SourceFilter>('both')
  const [facetMode, setFacetMode] = useState<'domains' | 'categories'>('domains')
  const [activeFacets, setActiveFacets] = useState<string[]>([])
  const { width: sidebarWidth, startDrag } = useResizable(220, 160, 400)
  const [projectedPoints, setProjectedPoints] = useState<Map<string, [number, number]>>(new Map())

  // Load settings on mount
  useEffect(() => {
    void Promise.all([getLlmSettings(), getSourceFilter()]).then(([settings, source]) => {
      setLlmSettingsState(settings)
      setSourceFilterState(source)
    })
  }, [])

  const handleSourceFilterChange = useCallback((value: SourceFilter) => {
    setSourceFilterState(value)
    void setSourceFilter(value)
  }, [])

  async function doLoad() {
    const [rawBookmarks, rawTabs] = await Promise.all([
      getAllBookmarks(),
      getAllTabs(),
    ])
    const { bookmarks: bm, tabs: tb } = crossLink(rawBookmarks, rawTabs)

    // Always restore cached categories on refresh
    const [tabCache, bmCache] = await Promise.all([
      loadCachedCategories(tb, 'tab'),
      loadCachedCategories(bm, 'bm'),
    ])
    const bmWithCache = bm.map(b => {
      const cat = bmCache.get(b.url)
      return cat ? { ...b, category: cat } : b
    })
    const tbWithCache = tb.map(t => {
      const cat = tabCache.get(t.url)
      return cat ? { ...t, category: cat } : t
    })

    // Restore cached tags too
    const [tabTagCache, bmTagCache] = await Promise.all([
      loadCachedTags(tb, 'tab'),
      loadCachedTags(bm, 'bm'),
    ])
    const bmWithTags = bmWithCache.map(b => {
      const tags = bmTagCache.get(b.url)
      return tags ? { ...b, tags } : b
    })
    const tbWithTags = tbWithCache.map(t => {
      const tags = tabTagCache.get(t.url)
      return tags ? { ...t, tags } : t
    })

    // Restore cached intents too
    const [tabIntentCache, bmIntentCache] = await Promise.all([
      loadCachedIntents(tb, 'tab'),
      loadCachedIntents(bm, 'bm'),
    ])
    const bmFinal = bmWithTags.map(b => {
      const intent = bmIntentCache.get(b.url)
      return intent ? { ...b, intent } : b
    })
    const tbFinal = tbWithTags.map(t => {
      const intent = tabIntentCache.get(t.url)
      return intent ? { ...t, intent } : t
    })

    setBookmarks(bmFinal)
    setTabs(tbFinal)

    // Restore cached 2D projection (Semantic Map coords)
    const cached2D = await loadCached2D()
    if (cached2D.size > 0) setProjectedPoints(cached2D)

    setLastUpdated(Date.now())
    setLoading(false)

    // Check LLM availability — fallback chain
    const nanoStatus = await checkLlmAvailability(llmSettings)
    console.info('[llm:auto] evaluate provider', {
      provider: llmSettings.chatProvider,
      status: nanoStatus,
      tabs: tb.length,
      bookmarks: bm.length,
    })

    if (llmSettings.chatProvider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      // Gemini Nano takes priority
      setLlmStatus('classifying')
      void classifyTabs(tb, (updates) => {
        setTabs(prev =>
          prev.map(t => {
            const hit = updates.find(u => u.url === t.url)
            return hit ? { ...t, category: hit.category } : t
          }),
        )
      }).then(() =>
        classifyBookmarks(bm, (updates) => {
          setBookmarks(prev =>
            prev.map(b => {
              const hit = updates.find(u => u.url === b.url)
              return hit ? { ...b, category: hit.category } : b
            }),
          )
        }).then(() => {
          setLlmStatus('ready')
          // Tagging pass — run silently after classification
          void tagWithGeminiNano(tb, 'tab', (updates) => {
            setTabs(prev =>
              prev.map(t => {
                const hit = updates.find(u => u.url === t.url)
                return hit ? { ...t, tags: hit.tags } : t
              }),
            )
          })
          void tagWithGeminiNano(bm, 'bm', (updates) => {
            setBookmarks(prev =>
              prev.map(b => {
                const hit = updates.find(u => u.url === b.url)
                return hit ? { ...b, tags: hit.tags } : b
              }),
            )
          })
          // Intent pass
          void classifyIntentGeminiNano(tb, 'tab', (updates) => {
            setTabs(prev =>
              prev.map(t => {
                const hit = updates.find(u => u.url === t.url)
                return hit ? { ...t, intent: hit.intent } : t
              }),
            )
          })
          void classifyIntentGeminiNano(bm, 'bm', (updates) => {
            setBookmarks(prev =>
              prev.map(b => {
                const hit = updates.find(u => u.url === b.url)
                return hit ? { ...b, intent: hit.intent } : b
              }),
            )
          })
        }),
      )
    } else if (
      (llmSettings.chatProvider === 'lmstudio' && llmSettings.model && llmSettings.baseUrl) ||
      (llmSettings.chatProvider === 'webllm' && llmSettings.webllmModel)
    ) {
      // Fall back to LM Studio
      setLlmStatus('classifying')
      try {
        await classifyWithLmStudio(
          tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          (updates) => {
            setTabs(prev =>
              prev.map(t => {
                const hit = updates.find(u => u.url === t.url)
                return hit ? { ...t, category: hit.category } : t
              }),
            )
          },
        )
        await classifyWithLmStudio(
          bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            setBookmarks(prev =>
              prev.map(b => {
                const hit = updates.find(u => u.url === b.url)
                return hit ? { ...b, category: hit.category } : b
              }),
            )
          },
        )

        // Pass 2 — merge near-duplicates (tabs only)
        setLlmStatus('normalizing')
        const allLabels = [...new Set(tbWithCache.map(t => t.category).filter(Boolean) as string[])]
        if (allLabels.length > 1) {
          console.group('[Auto Pass 2] Merge categories')
          console.log('Input labels:', allLabels)
          const mergeMap = await normalizeCategoryLabels(allLabels, llmSettings)
          console.log('Merge map:', mergeMap)
          const changes = Object.entries(mergeMap).filter(([from, to]) => from !== to)
          console.log('Changes:', changes)
          // Apply merge to tabs state
          setTabs(prev =>
            prev.map(t => ({
              ...t,
              category: t.category ? mergeMap[t.category] ?? t.category : t.category,
            })),
          )
          // Also merge the local tb reference for Pass 3
          for (const t of tbWithCache) {
            if (t.category && mergeMap[t.category]) {
              t.category = mergeMap[t.category]
            }
          }
          // Persist changed categories to cache
          await Promise.all(
            tbWithCache
              .filter(t => t.category && mergeMap[t.category])
              .map(t =>
                setCached('tab', t.url, {
                  category: t.category!,
                  processedAt: Date.now(),
                }),
              ),
          )
          console.groupEnd()
        }

        // Pass 3 — split overcrowded categories
        setLlmStatus('normalizing')
        console.group('[Auto Pass 3] Split large categories')
        void splitLargeClusters(
          tbWithCache.map(t => ({
            url: t.url,
            title: t.title,
            domain: t.domain,
            category: t.category ?? '',
          })),
          'tab',
          llmSettings,
          (updates) =>
            setTabs(prev =>
              prev.map(t => {
                const hit = updates.find(u => u.url === t.url)
                return hit ? { ...t, category: hit.category } : t
              }),
            ),
        ).then(() => {
          setLlmStatus('ready')
          console.groupEnd()
          // Tagging pass — run silently after classification
          void tagWithLmStudio(
            tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
            'tab',
            llmSettings,
            (updates) =>
              setTabs(prev =>
                prev.map(t => {
                  const hit = updates.find(u => u.url === t.url)
                  return hit ? { ...t, tags: hit.tags } : t
                }),
              ),
          )
          void tagWithLmStudio(
            bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
            'bm',
            llmSettings,
            (updates) =>
              setBookmarks(prev =>
                prev.map(b => {
                  const hit = updates.find(u => u.url === b.url)
                  return hit ? { ...b, tags: hit.tags } : b
                }),
              ),
          )
          // Intent pass
          void classifyIntentLmStudio(
            tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
            'tab',
            llmSettings,
            (updates) =>
              setTabs(prev =>
                prev.map(t => {
                  const hit = updates.find(u => u.url === t.url)
                  return hit ? { ...t, intent: hit.intent } : t
                }),
              ),
          )
          void classifyIntentLmStudio(
            bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
            'bm',
            llmSettings,
            (updates) =>
              setBookmarks(prev =>
                prev.map(b => {
                  const hit = updates.find(u => u.url === b.url)
                  return hit ? { ...b, intent: hit.intent } : b
                }),
              ),
          )
        })

        // Embedding pass — non-blocking, runs after tagging
        void runEmbeddingPass(tb, bm, llmSettings)
      } catch {
        setLlmStatus('unavailable')
      }
    } else {
      setLlmStatus('unavailable')
    }
  }

  // Clear cache
  const handleClearCache = async () => {
    if (!confirm('Clear all cached AI data (categories, tags, intents, embeddings)?')) return
    await clearAllAICache()
    setProjectedPoints(new Map())
    reload()
  }

  // Classification only (pass 1)
  const handleClassify = async () => {
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-classify-tabs', tabs.length)
    const bookmarksLog = createTaskLogger('manual-classify-bookmarks', bookmarks.length)
    if (llmSettings.chatProvider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      setLlmStatus('classifying')
      void classifyTabs(tabs, (updates) => {
        tabsLog.progress(updates.length)
        setTabs(prev =>
          prev.map(t => {
            const hit = updates.find(u => u.url === t.url)
            return hit ? { ...t, category: hit.category } : t
          }),
        )
      }).then(() =>
        classifyBookmarks(bookmarks, (updates) => {
          bookmarksLog.progress(updates.length)
          setBookmarks(prev =>
            prev.map(b => {
              const hit = updates.find(u => u.url === b.url)
              return hit ? { ...b, category: hit.category } : b
            }),
          )
        }).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      )
    } else if (
      (llmSettings.chatProvider === 'lmstudio' && llmSettings.model && llmSettings.baseUrl) ||
      (llmSettings.chatProvider === 'webllm' && llmSettings.webllmModel)
    ) {
      setLlmStatus('classifying')
      void classifyWithLmStudio(
        tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        (updates) => {
          tabsLog.progress(updates.length)
          setTabs(prev =>
            prev.map(t => {
              const hit = updates.find(u => u.url === t.url)
              return hit ? { ...t, category: hit.category } : t
            }),
          )
        },
      ).then(() =>
        classifyWithLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            bookmarksLog.progress(updates.length)
            setBookmarks(prev =>
              prev.map(b => {
                const hit = updates.find(u => u.url === b.url)
                return hit ? { ...b, category: hit.category } : b
              }),
            )
          },
        ).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      ).catch((err) => {
        tabsLog.failed(err)
        bookmarksLog.failed(err)
        setLlmStatus('unavailable')
      })
    } else {
      setLlmStatus('unavailable')
    }
  }

  // Run intent only
  const handleRunIntent = async () => {
    // Check Gemini Nano first
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-intent-tabs', tabs.length)
    const bookmarksLog = createTaskLogger('manual-intent-bookmarks', bookmarks.length)

    if (llmSettings.chatProvider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      setLlmStatus('classifying')
      void classifyIntentGeminiNano(tabs, 'tab', (updates) => {
        tabsLog.progress(updates.length)
        setTabs(prev =>
          prev.map(t => {
            const hit = updates.find(u => u.url === t.url)
            return hit ? { ...t, intent: hit.intent } : t
          }),
        )
      }).then(() =>
        classifyIntentGeminiNano(bookmarks, 'bm', (updates) => {
          bookmarksLog.progress(updates.length)
          setBookmarks(prev =>
            prev.map(b => {
              const hit = updates.find(u => u.url === b.url)
              return hit ? { ...b, intent: hit.intent } : b
            }),
          )
        }).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      )
    } else if (
      (llmSettings.chatProvider === 'lmstudio' && llmSettings.model && llmSettings.baseUrl) ||
      (llmSettings.chatProvider === 'webllm' && llmSettings.webllmModel)
    ) {
      setLlmStatus('classifying')
      void classifyIntentLmStudio(
        tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        (updates) => {
          tabsLog.progress(updates.length)
          setTabs(prev =>
            prev.map(t => {
              const hit = updates.find(u => u.url === t.url)
              return hit ? { ...t, intent: hit.intent } : t
            }),
          )
        },
      ).then(() =>
        classifyIntentLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            bookmarksLog.progress(updates.length)
            setBookmarks(prev =>
              prev.map(b => {
                const hit = updates.find(u => u.url === b.url)
                return hit ? { ...b, intent: hit.intent } : b
              }),
            )
          },
        ).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      ).catch((err) => {
        tabsLog.failed(err)
        bookmarksLog.failed(err)
        setLlmStatus('unavailable')
      })
    } else {
      setLlmStatus('unavailable')
    }
  }

  useEffect(() => {
    setLoading(true)
    void doLoad()
  }, [])

  function reload() {
    setBookmarks([])
    setTabs([])
    setLastUpdated(null)
    setLoading(true)
    void doLoad()
  }

  async function activateTab(id: number) {
    try {
      const tab = await chrome.tabs.update(id, { active: true })
      await chrome.windows.update(tab.windowId!, { focused: true })
    } catch {
      // Tab no longer exists — remove from state
      setTabs(prev => prev.filter(t => t.id !== id))
    }
  }

  // Manual Pass 2 — merge near-duplicate categories
  const handlePass2 = async () => {
    if (
      (llmSettings.chatProvider === 'lmstudio' && (!llmSettings.model || !llmSettings.baseUrl)) ||
      (llmSettings.chatProvider === 'webllm' && !llmSettings.webllmModel)
    ) return
    setLlmStatus('normalizing')
    try {
      const allLabels = [...new Set(tabs.map(t => t.category).filter(Boolean) as string[])]
      if (allLabels.length <= 1) { setLlmStatus('ready'); return }

      console.group('[Pass 2] Merge categories')
      console.log('Input labels:', allLabels)

      const mergeMap = await normalizeCategoryLabels(allLabels, llmSettings)
      console.log('Merge map:', mergeMap)

      const changes = Object.entries(mergeMap).filter(([from, to]) => from !== to)
      console.log('Changes:', changes)

      setTabs(prev =>
        prev.map(t => ({
          ...t,
          category: t.category ? mergeMap[t.category] ?? t.category : t.category,
        })),
      )

      // Count affected items
      const affectedCount = tabs.filter(t => t.category && mergeMap[t.category] !== t.category).length
      console.log(`Affected ${affectedCount} tabs`)

      // Persist changed categories
      await Promise.all(
        Object.entries(mergeMap)
          .filter(([from, to]) => from !== to)
          .flatMap(([from, to]) =>
            tabs.filter(t => t.category === from).map(t =>
              setCached('tab', t.url, { category: to, processedAt: Date.now() }),
            ),
          ),
      )

      if (changes.length === 0) {
        console.log('No merges needed')
      }

      console.groupEnd()
    } catch (err) {
      console.error('[Pass 2] Failed:', err)
    }
    setLlmStatus('ready')
  }

  // Manual Pass 3 — split overcrowded categories
  const handlePass3 = async () => {
    if (
      (llmSettings.chatProvider === 'lmstudio' && (!llmSettings.model || !llmSettings.baseUrl)) ||
      (llmSettings.chatProvider === 'webllm' && !llmSettings.webllmModel)
    ) return
    setLlmStatus('normalizing')
    try {
      // Count items in large categories
      const categoryCounts = new Map<string, number>()
      for (const t of tabs) {
        if (t.category) categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1)
      }
      const large = [...categoryCounts.entries()].filter(([, c]) => c > 15)
      console.group('[Pass 3] Split large categories')
      console.log('Categories to split:', large)

      await splitLargeClusters(
        tabs.map(t => ({
          url: t.url,
          title: t.title,
          domain: t.domain,
          category: t.category ?? '',
        })),
        'tab',
        llmSettings,
        (updates) => {
          console.log('Split batch updates:', updates.map(u => u.category))
          setTabs(prev =>
            prev.map(t => {
              const hit = updates.find(u => u.url === t.url)
              return hit ? { ...t, category: hit.category } : t
            }),
          )
        },
      )
      console.groupEnd()
    } catch (err) {
      console.error('[Pass 3] Failed:', err)
    }
    setLlmStatus('ready')
  }

  // Run tags only
  const handleRunTags = async () => {
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-tags-tabs', tabs.length)
    const bookmarksLog = createTaskLogger('manual-tags-bookmarks', bookmarks.length)
    if (llmSettings.chatProvider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      setLlmStatus('classifying')
      void tagWithGeminiNano(tabs, 'tab', (updates) => {
        tabsLog.progress(updates.length)
        setTabs(prev =>
          prev.map(t => {
            const hit = updates.find(u => u.url === t.url)
            return hit ? { ...t, tags: hit.tags } : t
          }),
        )
      }).then(() =>
        tagWithGeminiNano(bookmarks, 'bm', (updates) => {
          bookmarksLog.progress(updates.length)
          setBookmarks(prev =>
            prev.map(b => {
              const hit = updates.find(u => u.url === b.url)
              return hit ? { ...b, tags: hit.tags } : b
            }),
          )
        }).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      )
    } else if (
      (llmSettings.chatProvider === 'lmstudio' && llmSettings.model && llmSettings.baseUrl) ||
      (llmSettings.chatProvider === 'webllm' && llmSettings.webllmModel)
    ) {
      setLlmStatus('classifying')
      void tagWithLmStudio(
        tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        (updates) => {
          tabsLog.progress(updates.length)
          setTabs(prev =>
            prev.map(t => {
              const hit = updates.find(u => u.url === t.url)
              return hit ? { ...t, tags: hit.tags } : t
            }),
          )
        },
      ).then(() =>
        tagWithLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            bookmarksLog.progress(updates.length)
            setBookmarks(prev =>
              prev.map(b => {
                const hit = updates.find(u => u.url === b.url)
                return hit ? { ...b, tags: hit.tags } : b
              }),
            )
          },
        ).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      ).catch((err) => {
        tabsLog.failed(err)
        bookmarksLog.failed(err)
        setLlmStatus('unavailable')
      })
    } else {
      setLlmStatus('unavailable')
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

  const sourceScopedBookmarks = useMemo(
    () => (sourceFilter === 'tabs' ? [] : bookmarks),
    [sourceFilter, bookmarks],
  )
  const sourceScopedTabs = useMemo(
    () => (sourceFilter === 'bookmarks' ? [] : tabs),
    [sourceFilter, tabs],
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
    return Array.from(counts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
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

  // Embedding + projection pass
  const runEmbeddingPass = useCallback(async (
    tb: TabItem[],
    bm: BookmarkItem[],
    settings: LlmSettings,
  ) => {
    if (settings.embeddingProvider === 'lmstudio' && !settings.model && !settings.embeddingModel) return

    const allItems = [
      ...tb.map(t => ({ url: t.url, title: t.title || t.url, domain: t.domain, category: t.category })),
      ...bm.map(b => ({ url: b.url, title: b.title || b.url, domain: b.domain, category: b.category })),
    ]

    // Fetch embeddings (stores in IndexedDB, doesn't persist raw vectors in chrome.storage)
    const embeddingLog = createTaskLogger('embeddings', allItems.length)
    await fetchEmbeddingsBatch(allItems, settings, (updates) => {
      embeddingLog.progress(updates.length)
      // Progress callback — reproject on each new embedding
    })

    // Re-project all cached embeddings to 2D
    const map = await reprojectAllEmbeddings()
    embeddingLog.done({ projectedPoints: map.size })
    if (map.size > 0) setProjectedPoints(map)
  }, [])

  const handleReembedAll = useCallback(async () => {
    if (!confirm('Re-embed all pages using the new text format? This clears cached embeddings first.')) return
    await clearEmbeddingCache()
    setProjectedPoints(new Map())
    await runEmbeddingPass(tabs, bookmarks, llmSettings)
  }, [tabs, bookmarks, llmSettings, runEmbeddingPass])

  function renderActiveView() {
    const common = {
      bookmarks: filteredBookmarks,
      tabs: filteredTabs,
      loading,
      onRunTags: handleRunTags,
      onRunEmbeddings: () => runEmbeddingPass(filteredTabs, filteredBookmarks, llmSettings),
    }

    switch (activeView) {
      case 'list':
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
      case 'triage':
        return <TriageView {...common} />
      case 'kanban':
        return <KanbanView {...common} />
      case 'timeline':
        return <TimelineView {...common} />
      case 'magazine':
        return <MagazineView {...common} />
      case 'treemap':
        return <TreemapView {...common} />
      case 'semantic':
        return <SemanticMapView {...common} projectedPoints={projectedPoints} />
      case 'heatmap':
        return <ActivityHeatmapView {...common} />
      case 'domain-graph':
        return <DomainGraphView {...common} />
      case 'reading-queue':
        return <ReadingQueueView {...common} />
      case 'tag-constellation':
        return <TagConstellationView {...common} />
      case 'personal-radar':
        return <PersonalRadarView {...common} />
      case 'topic-river':
        return <TopicRiverView {...common} />
      case 'domain-drill-down':
        return <DomainDrillDownView {...common} />
      case 'focus-rings':
        return <FocusRingsView {...common} />
      case 'tag-cooccurrence':
        return <TagCooccurrenceView {...common} />
      case 'shelf-view':
        return <ShelfView {...common} />
      case 'overlap-explorer':
        return <OverlapExplorerView {...common} />
      case 'shadow-map':
        return <ShadowMapView {...common} />
      case 'session-story':
        return <SessionStoryView {...common} />
      default:
        return <ListView
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
    }
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
          sourceFilter={sourceFilter}
          onSourceFilterChange={handleSourceFilterChange}
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
        <div className="mt-3">
          <ViewBar activeView={activeView} onChange={handleViewChange} />
          {VIEW_HINTS[activeView] && (
            <p className="mt-2 text-xs text-muted-foreground/70">{VIEW_HINTS[activeView]}</p>
          )}
        </div>
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
          className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
        />

        <div className="min-w-0 flex-1 overflow-auto px-6 py-4">
          {renderActiveView()}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border/40 px-6 py-2 text-[11px] text-muted-foreground/50 flex items-center gap-2">
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
        <span>·</span>
        <span>Open source</span>
      </footer>
    </div>
  )
}
