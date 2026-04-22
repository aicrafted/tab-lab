import { useCallback, useEffect, useState } from 'react'
import { useBrowserStateSync } from '@/hooks/useBrowserStateSync'
import { PanelLeft, QrCode, Settings } from 'lucide-react'
import QRCode from 'react-qr-code'
import { Favicon } from '@/components/Favicon'
import { Duplicates } from './sections/Duplicates'
import { SimilarTabs } from './sections/SimilarTabs'
import { RelatedBookmarks } from './sections/RelatedBookmarks'
import { Search } from './sections/Search'
import { RecentTabs } from './sections/RecentTabs'
import { PageSummary } from './sections/PageSummary'
import { deepMerge, parseDomain, type DeepPartial } from '@/lib/core/utils'
import type { LlmSettings } from '@/lib/core/types'
import { getLlmSettings } from '@/lib/core/storage'
import { SIDEPANEL_SETTINGS_KEY } from '@/lib/core/storage-keys'
import { SidePanelSettingsPanel } from './SidePanelSettingsPanel'
import { DEFAULT_SIDEPANEL_SETTINGS, mergeSidePanelSettings, type SidePanelSettings } from './sidepanel-settings'

interface SidePanelData {
  tabs: chrome.tabs.Tab[]
  bookmarks: chrome.bookmarks.BookmarkTreeNode[]
  tabHistory: { tabId: number; windowId: number; url: string; title: string; favIconUrl?: string; ts: number }[]
}



export function SidePanel() {
  const [data, setData] = useState<SidePanelData | null>(null)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null)
  const [spSettings, setSpSettings] = useState<SidePanelSettings>(DEFAULT_SIDEPANEL_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await chrome.runtime.sendMessage({ type: 'getSidePanelData' })
      if (result && !result.error) {
        setData(result)
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        setActiveTabId(tab?.id ?? null)
        setCurrentWindowId(tab?.windowId ?? null)
      }
    } catch {
      // ignore
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useBrowserStateSync(loadData)

  useEffect(() => {
    void getLlmSettings().then((settings) => {
      setLlmSettings(settings)
    }).catch(() => {
      setLlmSettings(null)
    })
  }, [])

  useEffect(() => {
    void chrome.storage.local.get(SIDEPANEL_SETTINGS_KEY).then((res) => {
      const raw = res[SIDEPANEL_SETTINGS_KEY]
      if (raw) {
        setSpSettings(mergeSidePanelSettings(raw))
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (msg: { type: string; tabId: number }) => {
      if (msg.type === 'tabActivated') {
        setActiveTabId(msg.tabId)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => { chrome.runtime.onMessage.removeListener(handler) }
  }, [])

  function updateSettings(patch: DeepPartial<SidePanelSettings>) {
    setSpSettings((prev) => {
      const next = deepMerge(prev, patch)
      void chrome.storage.local.set({ [SIDEPANEL_SETTINGS_KEY]: next })
      return next
    })
  }

  const bookmarkItems = flattenBookmarks(data?.bookmarks ?? [])

  const currentTab = data?.tabs.find(t => t.id === activeTabId)
  const currentTabData = currentTab && currentTab.url
    ? {
        id: currentTab.id!,
        title: currentTab.title || currentTab.url,
        url: currentTab.url,
        domain: parseDomain(currentTab.url),
        favIconUrl: currentTab.favIconUrl,
      }
    : null

  useEffect(() => {
    setQrOpen(false)
  }, [currentTabData?.url])

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center bg-[#111] p-4 text-sm text-[#888]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#111] text-[#f0e6d0]">
      {/* Domain bar — replaces Chrome's native header */}
      {currentTabData && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[#2a2a2a] bg-[#111]/95 px-3 py-2 backdrop-blur">
          <Favicon domain={currentTabData.domain} src={currentTabData.favIconUrl} />
          <span className="flex-1 truncate text-sm text-[#f0e6d0]">{currentTabData.domain}</span>
          <button
            type="button"
            onClick={() => setQrOpen((prev) => !prev)}
            className="shrink-0 text-[#555] transition-colors hover:text-[#888]"
            title="QR code for current URL"
          >
            <QrCode className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="shrink-0 text-[#555] transition-colors hover:text-[#888]"
            title="SidePanel settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 space-y-1 p-2">
        {qrOpen && currentTabData?.url && (
          <div className="mx-2 mt-1 flex flex-col items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#1a1a1a] p-4">
            <div className="rounded bg-white p-2">
              <QRCode value={currentTabData.url} size={160} />
            </div>
            <span className="max-w-[200px] break-all text-center text-xs text-[#555]">
              {currentTabData.url}
            </span>
          </div>
        )}
        {settingsOpen && (
          <SidePanelSettingsPanel
            settings={spSettings}
            onUpdate={updateSettings}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {spSettings.sections.summary && currentTabData && llmSettings && (
          <PageSummary
            tabId={currentTabData.id}
            url={currentTabData.url}
            llmSettings={llmSettings}
            summaryProvider={spSettings.summarization.provider}
            systemPrompt={spSettings.summarization.systemPrompt}
          />
        )}
        {spSettings.sections.search && currentTabData && data && (
          <Search data={data} currentTabId={currentTabData.id} currentWindowId={currentWindowId} />
        )}
        {spSettings.sections.recentTabsLimit > 0 && data && (
          <RecentTabs
            history={data.tabHistory ?? []}
            limit={spSettings.sections.recentTabsLimit}
            currentTabId={activeTabId}
            currentWindowId={currentWindowId}
          />
        )}
        {spSettings.sections.duplicates && currentTabData && data && (
          <Duplicates
            currentTab={currentTabData}
            allTabs={data.tabs}
            currentWindowId={currentWindowId}
          />
        )}
        {spSettings.sections.similarTabs && currentTabData && data && (
          <SimilarTabs
            currentTab={currentTabData}
            allTabs={data.tabs}
            currentWindowId={currentWindowId}
          />
        )}
        {spSettings.sections.relatedBookmarks && currentTabData && bookmarkItems.length > 0 && (
          <RelatedBookmarks currentTab={currentTabData} bookmarks={bookmarkItems} />
        )}
        {!currentTabData && (
          <p className="px-2 py-3 text-xs text-[#666]">
            No active tab. Open a web page to see context.
          </p>
        )}
      </div>

      {/* Move side panel hint — at the very bottom */}
      <div className="flex items-center gap-1.5 border-t border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5 text-[10px] text-[#555] leading-snug">
        <PanelLeft className="h-3 w-3 shrink-0 text-[#444]" />
        <span>
          To move to other side: <span className="text-[#666]">⋮ → Settings → Appearance → Side panel</span>
        </span>
      </div>
    </div>
  )
}

function flattenBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  folderPath = '',
): { id: string; title: string; url: string; domain: string; folder: string }[] {
  const items: { id: string; title: string; url: string; domain: string; folder: string }[] = []
  for (const node of nodes) {
    const path = node.title ? (folderPath ? `${folderPath}/${node.title}` : node.title) : folderPath
    if (node.url) {
      items.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        domain: parseDomain(node.url),
        folder: path,
      })
    }
    if (node.children) {
      items.push(...flattenBookmarks(node.children, path))
    }
  }
  return items
}
