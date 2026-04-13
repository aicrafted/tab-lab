import { Favicon } from '@/components/Favicon'
import { parseDomain } from '@/lib/utils'

interface TabInfo {
  id: number
  title: string
  url: string
  domain: string
  windowId?: number
  favIconUrl?: string
}

async function activateTab(tabId: number, windowId?: number) {
  await chrome.tabs.update(tabId, { active: true })
  if (windowId != null) {
    await chrome.windows.update(windowId, { focused: true })
  }
}

export function SimilarTabs({
  currentTab,
  allTabs,
  currentWindowId,
}: {
  currentTab: TabInfo
  allTabs: chrome.tabs.Tab[]
  currentWindowId: number | null
}) {
  // Find tabs on the same domain (excluding current tab)
  const similar = allTabs
    .filter((t) => t.id !== currentTab.id && t.url && parseDomain(t.url) === currentTab.domain)
    .map((t) => ({
      id: t.id!,
      title: t.title || t.url!,
      url: t.url!,
      domain: parseDomain(t.url!),
      windowId: t.windowId,
      favIconUrl: t.favIconUrl,
    }))

  const sameWindow = similar.filter((t) => t.windowId === currentWindowId)
  const otherWindows = similar.filter((t) => t.windowId !== currentWindowId)

  if (sameWindow.length === 0 && otherWindows.length === 0) return null

  return (
    <details open className="group rounded-lg border border-[#2a2a2a] bg-[#1a1a1a]">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#888] select-none">
        Same Domain · {similar.length}
      </summary>
      <div className="space-y-0.5 px-1 pb-2">
        {sameWindow.map((tab) => (
          <SimilarRow key={tab.id} tab={tab} onActivate={activateTab} />
        ))}
        {otherWindows.length > 0 && (
          <div className="px-2 py-1 text-[10px] text-[#555]">
            Opened in other windows
          </div>
        )}
        {otherWindows.map((tab) => (
          <SimilarRow key={tab.id} tab={tab} onActivate={activateTab} />
        ))}
      </div>
    </details>
  )
}

function SimilarRow({ tab, onActivate }: { tab: TabInfo; onActivate: (id: number, windowId?: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onActivate(tab.id, tab.windowId)}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-[#ccc] hover:bg-[#1e1e1e]"
    >
      <Favicon domain={tab.domain} src={tab.favIconUrl} />
      <span className="flex-1 truncate text-left" title={tab.title}>{tab.title}</span>
    </button>
  )
}
