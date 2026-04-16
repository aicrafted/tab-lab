import { Favicon } from '@/components/Favicon'
import { parseDomain } from '@/lib/core/utils'

interface HistoryEntry {
  tabId: number
  windowId: number
  url: string
  title: string
  favIconUrl?: string
  ts: number
}

async function activateTab(tabId: number, windowId: number) {
  await chrome.tabs.update(tabId, { active: true })
  await chrome.windows.update(windowId, { focused: true })
}

export function RecentTabs({
  history,
  currentTabId,
  currentWindowId,
}: {
  history: HistoryEntry[]
  currentTabId: number | null
  currentWindowId: number | null
}) {
  // Filter out current tab, deduplicate by URL, take last 10
  const seen = new Set<number>()
  const recent = history
    .filter((h) => h.tabId !== currentTabId)
    .filter((h) => {
      if (seen.has(h.tabId)) return false
      seen.add(h.tabId)
      return true
    })
    .slice(0, 10)

  const sameWindow = recent.filter((h) => h.windowId === currentWindowId)
  const otherWindows = recent.filter((h) => h.windowId !== currentWindowId)

  if (sameWindow.length === 0 && otherWindows.length === 0) return null

  return (
    <details open className="group rounded-lg border border-[#2a2a2a] bg-[#1a1a1a]">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#888] select-none">
        Recent Tabs · {recent.length}
      </summary>
      <div className="space-y-0.5 px-1 pb-2">
        {sameWindow.map((entry) => (
          <RecentRow key={entry.tabId} entry={entry} onActivate={activateTab} />
        ))}
        {otherWindows.length > 0 && (
          <div className="px-2 py-1 text-[10px] text-[#555]">
            Opened in other windows
          </div>
        )}
        {otherWindows.map((entry) => (
          <RecentRow key={entry.tabId} entry={entry} onActivate={activateTab} />
        ))}
      </div>
    </details>
  )
}

function RecentRow({
  entry,
  onActivate,
}: {
  entry: HistoryEntry
  onActivate: (id: number, windowId: number) => void
}) {
  const domain = parseDomain(entry.url)
  return (
    <button
      type="button"
      onClick={() => onActivate(entry.tabId, entry.windowId)}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-[#ccc] hover:bg-[#1e1e1e]"
    >
      <Favicon domain={domain} src={entry.favIconUrl} />
      <span className="flex-1 truncate text-left" title={entry.title}>{entry.title}</span>
    </button>
  )
}
