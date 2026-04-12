import { useCallback } from 'react'
import { applyCategoryUpdates, applyIntentUpdates, applyTagsUpdates } from '@/lib/apply-updates'
import { checkLlmAvailability, classifyBookmarks, classifyTabs, classifyWithLmStudio, normalizeCategoryLabels, splitLargeClusters, type LlmStatus } from '@/lib/classifier'
import { clearEmbeddingCache, fetchEmbeddingsBatch, reprojectAllEmbeddings } from '@/lib/embedder'
import { classifyIntentGeminiNano, classifyIntentLmStudio } from '@/lib/intent'
import { clearAllAICache, setCached } from '@/lib/storage'
import { tagWithGeminiNano, tagWithLmStudio } from '@/lib/tagger'
import type { BookmarkItem, LlmSettings, PageIntent, TabItem } from '@/lib/types'

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

function hasChatProviderConfig(settings: LlmSettings): boolean {
  const provider = settings.tasks.chat.provider
  if (provider === 'gemini-nano') return true
  if (provider === 'webllm') return Boolean(settings.tasks.chat.model)
  if (provider === 'lmstudio') {
    return Boolean(settings.providers.lmstudio.baseUrl && settings.tasks.chat.model)
  }
  if (provider === 'openrouter') {
    return Boolean(settings.providers.openrouter.apiKey && settings.tasks.chat.model)
  }
  return false
}

interface UseAiPipelinesArgs {
  bookmarks: BookmarkItem[]
  tabs: TabItem[]
  llmSettings: LlmSettings
  setBookmarks: React.Dispatch<React.SetStateAction<BookmarkItem[]>>
  setTabs: React.Dispatch<React.SetStateAction<TabItem[]>>
  setLlmStatus: React.Dispatch<React.SetStateAction<LlmStatus>>
  setProjectedPoints: React.Dispatch<React.SetStateAction<Map<string, [number, number]>>>
  reload: () => void
}

export function useAiPipelines({
  bookmarks,
  tabs,
  llmSettings,
  setBookmarks,
  setTabs,
  setLlmStatus,
  setProjectedPoints,
  reload,
}: UseAiPipelinesArgs) {
  const applyTabCategoryBatch = useCallback((updates: { url: string; category: string }[]) => {
    setTabs((prev) => applyCategoryUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkCategoryBatch = useCallback((updates: { url: string; category: string }[]) => {
    setBookmarks((prev) => applyCategoryUpdates(prev, updates))
  }, [setBookmarks])

  const applyTabTagsBatch = useCallback((updates: { url: string; tags: string[] }[]) => {
    setTabs((prev) => applyTagsUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkTagsBatch = useCallback((updates: { url: string; tags: string[] }[]) => {
    setBookmarks((prev) => applyTagsUpdates(prev, updates))
  }, [setBookmarks])

  const applyTabIntentBatch = useCallback((updates: { url: string; intent: PageIntent }[]) => {
    setTabs((prev) => applyIntentUpdates(prev, updates))
  }, [setTabs])

  const applyBookmarkIntentBatch = useCallback((updates: { url: string; intent: PageIntent }[]) => {
    setBookmarks((prev) => applyIntentUpdates(prev, updates))
  }, [setBookmarks])

  const runEmbeddingPass = useCallback(async (
    tb: TabItem[],
    bm: BookmarkItem[],
    settings: LlmSettings,
  ) => {
    const embeddingProvider = settings.tasks.embedding.provider
    if (embeddingProvider === 'lmstudio' && !settings.tasks.embedding.model) return
    if (embeddingProvider === 'openrouter' && (!settings.providers.openrouter.apiKey || !settings.tasks.embedding.model)) return

    const allItems = [
      ...tb.map(t => ({ url: t.url, title: t.title || t.url, domain: t.domain, category: t.category })),
      ...bm.map(b => ({ url: b.url, title: b.title || b.url, domain: b.domain, category: b.category })),
    ]

    const embeddingLog = createTaskLogger('embeddings', allItems.length)
    await fetchEmbeddingsBatch(allItems, settings, (updates) => {
      embeddingLog.progress(updates.length)
    })

    const map = await reprojectAllEmbeddings()
    embeddingLog.done({ projectedPoints: map.size })
    if (map.size > 0) setProjectedPoints(map)
  }, [setProjectedPoints])

  const runAutoAiPipeline = useCallback(async (
    tb: TabItem[],
    bm: BookmarkItem[],
    tabsWithCache: TabItem[],
  ) => {
    const nanoStatus = await checkLlmAvailability(llmSettings)
    console.info('[llm:auto] evaluate provider', {
      provider: llmSettings.tasks.chat.provider,
      status: nanoStatus,
      tabs: tb.length,
      bookmarks: bm.length,
    })

    if (llmSettings.tasks.classification.method === 'nli' && llmSettings.tasks.embedding.provider === 'transformers') {
      setLlmStatus('classifying')
      void classifyWithLmStudio(
        tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        applyTabCategoryBatch,
      ).then(() =>
        classifyWithLmStudio(
          bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          applyBookmarkCategoryBatch,
        ).then(() => {
          setLlmStatus('ready')
          void classifyIntentLmStudio(
            tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
            'tab',
            llmSettings,
            applyTabIntentBatch,
          )
          void classifyIntentLmStudio(
            bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
            'bm',
            llmSettings,
            applyBookmarkIntentBatch,
          )
        }),
      )
      void runEmbeddingPass(tb, bm, llmSettings)
      return
    }

    if (llmSettings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      setLlmStatus('classifying')
      void classifyTabs(tb, (updates) => {
        applyTabCategoryBatch(updates)
      }).then(() =>
        classifyBookmarks(bm, (updates) => {
          applyBookmarkCategoryBatch(updates)
        }).then(() => {
          setLlmStatus('ready')
          void tagWithGeminiNano(tb, 'tab', (updates) => {
            applyTabTagsBatch(updates)
          })
          void tagWithGeminiNano(bm, 'bm', (updates) => {
            applyBookmarkTagsBatch(updates)
          })
          void classifyIntentGeminiNano(tb, 'tab', (updates) => {
            applyTabIntentBatch(updates)
          })
          void classifyIntentGeminiNano(bm, 'bm', (updates) => {
            applyBookmarkIntentBatch(updates)
          })
        }),
      )
      return
    }

    if (hasChatProviderConfig(llmSettings)) {
      setLlmStatus('classifying')
      try {
        await classifyWithLmStudio(
          tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
          'tab',
          llmSettings,
          applyTabCategoryBatch,
        )
        await classifyWithLmStudio(
          bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          applyBookmarkCategoryBatch,
        )

        setLlmStatus('normalizing')
        const allLabels = [...new Set(tabsWithCache.map(t => t.category).filter(Boolean) as string[])]
        if (allLabels.length > 1) {
          console.group('[Auto Pass 2] Merge categories')
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
          for (const t of tabsWithCache) {
            if (t.category && mergeMap[t.category]) {
              t.category = mergeMap[t.category]
            }
          }
          await Promise.all(
            tabsWithCache
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

        setLlmStatus('normalizing')
        console.group('[Auto Pass 3] Split large categories')
        void splitLargeClusters(
          tabsWithCache.map(t => ({
            url: t.url,
            title: t.title,
            domain: t.domain,
            category: t.category ?? '',
          })),
          'tab',
          llmSettings,
          applyTabCategoryBatch,
        ).then(() => {
          setLlmStatus('ready')
          console.groupEnd()
          void tagWithLmStudio(
            tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
            'tab',
            llmSettings,
            applyTabTagsBatch,
          )
          void tagWithLmStudio(
            bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
            'bm',
            llmSettings,
            applyBookmarkTagsBatch,
          )
          void classifyIntentLmStudio(
            tb.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
            'tab',
            llmSettings,
            applyTabIntentBatch,
          )
          void classifyIntentLmStudio(
            bm.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
            'bm',
            llmSettings,
            applyBookmarkIntentBatch,
          )
        })

        void runEmbeddingPass(tb, bm, llmSettings)
      } catch {
        setLlmStatus('unavailable')
      }
      return
    }

    setLlmStatus('unavailable')
  }, [
    applyBookmarkCategoryBatch,
    applyBookmarkIntentBatch,
    applyBookmarkTagsBatch,
    applyTabCategoryBatch,
    applyTabIntentBatch,
    applyTabTagsBatch,
    llmSettings,
    runEmbeddingPass,
    setLlmStatus,
    setTabs,
  ])

  const handleClearCache = useCallback(async () => {
    if (!confirm('Clear all cached AI data (categories, tags, intents, embeddings)?')) return
    await clearAllAICache()
    setProjectedPoints(new Map())
    reload()
  }, [reload, setProjectedPoints])

  const handleClassify = useCallback(async () => {
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-classify-tabs', tabs.length)
    const bookmarksLog = createTaskLogger('manual-classify-bookmarks', bookmarks.length)
    if (llmSettings.tasks.classification.method === 'nli' && llmSettings.tasks.embedding.provider === 'transformers') {
      setLlmStatus('classifying')
      void classifyWithLmStudio(
        tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        (updates) => {
          tabsLog.progress(updates.length)
          applyTabCategoryBatch(updates)
        },
      ).then(() =>
        classifyWithLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            bookmarksLog.progress(updates.length)
            applyBookmarkCategoryBatch(updates)
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
    } else if (llmSettings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      setLlmStatus('classifying')
      void classifyTabs(tabs, (updates) => {
        tabsLog.progress(updates.length)
        applyTabCategoryBatch(updates)
      }).then(() =>
        classifyBookmarks(bookmarks, (updates) => {
          bookmarksLog.progress(updates.length)
          applyBookmarkCategoryBatch(updates)
        }).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      )
    } else if (hasChatProviderConfig(llmSettings)) {
      setLlmStatus('classifying')
      void classifyWithLmStudio(
        tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        (updates) => {
          tabsLog.progress(updates.length)
          applyTabCategoryBatch(updates)
        },
      ).then(() =>
        classifyWithLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            bookmarksLog.progress(updates.length)
            applyBookmarkCategoryBatch(updates)
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
  }, [
    applyBookmarkCategoryBatch,
    applyTabCategoryBatch,
    bookmarks,
    llmSettings,
    setLlmStatus,
    tabs,
  ])

  const handleRunIntent = useCallback(async () => {
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-intent-tabs', tabs.length)
    const bookmarksLog = createTaskLogger('manual-intent-bookmarks', bookmarks.length)

    if (llmSettings.tasks.classification.method === 'nli' && llmSettings.tasks.embedding.provider === 'transformers') {
      setLlmStatus('classifying')
      void classifyIntentLmStudio(
        tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        (updates) => {
          tabsLog.progress(updates.length)
          applyTabIntentBatch(updates)
        },
      ).then(() =>
        classifyIntentLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            bookmarksLog.progress(updates.length)
            applyBookmarkIntentBatch(updates)
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
    } else if (llmSettings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      setLlmStatus('classifying')
      void classifyIntentGeminiNano(tabs, 'tab', (updates) => {
        tabsLog.progress(updates.length)
        applyTabIntentBatch(updates)
      }).then(() =>
        classifyIntentGeminiNano(bookmarks, 'bm', (updates) => {
          bookmarksLog.progress(updates.length)
          applyBookmarkIntentBatch(updates)
        }).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      )
    } else if (hasChatProviderConfig(llmSettings)) {
      setLlmStatus('classifying')
      void classifyIntentLmStudio(
        tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        (updates) => {
          tabsLog.progress(updates.length)
          applyTabIntentBatch(updates)
        },
      ).then(() =>
        classifyIntentLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            bookmarksLog.progress(updates.length)
            applyBookmarkIntentBatch(updates)
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
  }, [
    applyBookmarkIntentBatch,
    applyTabIntentBatch,
    bookmarks,
    llmSettings,
    setLlmStatus,
    tabs,
  ])

  const handlePass2 = useCallback(async () => {
    if (!hasChatProviderConfig(llmSettings)) return
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

      const affectedCount = tabs.filter(t => t.category && mergeMap[t.category] !== t.category).length
      console.log(`Affected ${affectedCount} tabs`)

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
  }, [llmSettings, setLlmStatus, setTabs, tabs])

  const handlePass3 = useCallback(async () => {
    if (!hasChatProviderConfig(llmSettings)) return
    setLlmStatus('normalizing')
    try {
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
          applyTabCategoryBatch(updates)
        },
      )
      console.groupEnd()
    } catch (err) {
      console.error('[Pass 3] Failed:', err)
    }
    setLlmStatus('ready')
  }, [applyTabCategoryBatch, llmSettings, setLlmStatus, tabs])

  const handleRunTags = useCallback(async () => {
    const nanoStatus = await checkLlmAvailability(llmSettings)
    const tabsLog = createTaskLogger('manual-tags-tabs', tabs.length)
    const bookmarksLog = createTaskLogger('manual-tags-bookmarks', bookmarks.length)
    if (llmSettings.tasks.chat.provider === 'gemini-nano' && (nanoStatus === 'ready' || nanoStatus === 'after-download')) {
      setLlmStatus('classifying')
      void tagWithGeminiNano(tabs, 'tab', (updates) => {
        tabsLog.progress(updates.length)
        applyTabTagsBatch(updates)
      }).then(() =>
        tagWithGeminiNano(bookmarks, 'bm', (updates) => {
          bookmarksLog.progress(updates.length)
          applyBookmarkTagsBatch(updates)
        }).then(() => {
          tabsLog.done()
          bookmarksLog.done()
          setLlmStatus('ready')
        }),
      )
    } else if (hasChatProviderConfig(llmSettings)) {
      setLlmStatus('classifying')
      void tagWithLmStudio(
        tabs.map(t => ({ url: t.url, title: t.title, domain: t.domain })),
        'tab',
        llmSettings,
        (updates) => {
          tabsLog.progress(updates.length)
          applyTabTagsBatch(updates)
        },
      ).then(() =>
        tagWithLmStudio(
          bookmarks.map(b => ({ url: b.url, title: b.title, domain: b.domain })),
          'bm',
          llmSettings,
          (updates) => {
            bookmarksLog.progress(updates.length)
            applyBookmarkTagsBatch(updates)
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
  }, [
    applyBookmarkTagsBatch,
    applyTabTagsBatch,
    bookmarks,
    llmSettings,
    setLlmStatus,
    tabs,
  ])

  const handleReembedAll = useCallback(async () => {
    if (!confirm('Re-embed all pages using the new text format? This clears cached embeddings first.')) return
    await clearEmbeddingCache()
    setProjectedPoints(new Map())
    await runEmbeddingPass(tabs, bookmarks, llmSettings)
  }, [bookmarks, llmSettings, runEmbeddingPass, setProjectedPoints, tabs])

  return {
    applyTabCategoryBatch,
    applyBookmarkCategoryBatch,
    applyTabTagsBatch,
    applyBookmarkTagsBatch,
    applyTabIntentBatch,
    applyBookmarkIntentBatch,
    runEmbeddingPass,
    runAutoAiPipeline,
    handleClearCache,
    handleClassify,
    handleRunIntent,
    handlePass2,
    handlePass3,
    handleRunTags,
    handleReembedAll,
  }
}
