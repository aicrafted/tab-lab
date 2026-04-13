import { useCallback, useEffect, useState } from 'react'
import { PanelLeft, X } from 'lucide-react'
import { Favicon } from '@/components/Favicon'
import { Duplicates } from './sections/Duplicates'
import { SimilarTabs } from './sections/SimilarTabs'
import { RelatedBookmarks } from './sections/RelatedBookmarks'
import { Search } from './sections/Search'
import { RecentTabs } from './sections/RecentTabs'
import { parseDomain } from '@/lib/utils'

interface SidePanelData {
  tabs: chrome.tabs.Tab[]
  bookmarks: chrome.bookmarks.BookmarkTreeNode[]
  tabHistory: { tabId: number; windowId: number; url: string; title: string; favIconUrl?: string; ts: number }[]
}

type DockSide = 'left' | 'right'

export function SidePanel() {
  const [data, setData] = useState<SidePanelData | null>(null)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    const handler = (msg: { type: string; tabId: number }) => {
      if (msg.type === 'tabActivated') {
        setActiveTabId(msg.tabId)
        void loadData()
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => { chrome.runtime.onMessage.removeListener(handler) }
  }, [loadData])

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
            onClick={() => window.close()}
            className="shrink-0 rounded p-1 text-[#666] hover:bg-[#1e1e1e] hover:text-[#f0e6d0] transition-colors"
            title="Close panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 space-y-1 p-2">
        {currentTabData && data && (
          <Search data={data} currentTabId={currentTabData.id} currentWindowId={currentWindowId} />
        )}
        {data && (
          <RecentTabs
            history={data.tabHistory ?? []}
            currentTabId={activeTabId}
            currentWindowId={currentWindowId}
          />
        )}
        {currentTabData && data && (
          <Duplicates
            currentTab={currentTabData}
            allTabs={data.tabs}
            currentWindowId={currentWindowId}
            onReload={loadData}
          />
        )}
        {currentTabData && data && (
          <SimilarTabs
            currentTab={currentTabData}
            allTabs={data.tabs}
            currentWindowId={currentWindowId}
          />
        )}
        {currentTabData && bookmarkItems.length > 0 && (
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
