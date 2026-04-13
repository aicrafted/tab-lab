import { Favicon } from '@/components/Favicon'
import { parseDomain } from '@/lib/utils'

interface TabInfo {
  id: number
  title: string
  url: string
  domain: string
  favIconUrl?: string
}

export function SimilarTabs({
  currentTab,
  allTabs,
}: {
  currentTab: TabInfo
  allTabs: chrome.tabs.Tab[]
}) {
  // Find tabs on the same domain (excluding current tab)
  const similar = allTabs.filter((t) => {
    if (t.id === currentTab.id || !t.url) return false
    return parseDomain(t.url) === currentTab.domain
  })

  if (similar.length === 0) return null

  return (
    <details open className="group rounded-lg border border-[#2a2a2a] bg-[#1e1e1e]/50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#888] select-none">
        Same Domain · {similar.length}
      </summary>
      <div className="space-y-0.5 px-1 pb-2">
        {similar.map((tab) => {
          const tabInfo: TabInfo = {
            id: tab.id!,
            title: tab.title || tab.url!,
            url: tab.url!,
            domain: parseDomain(tab.url!),
            favIconUrl: tab.favIconUrl,
          }
          return <SimilarRow key={tab.id} tab={tabInfo} />
        })}
      </div>
    </details>
  )
}

function SimilarRow({ tab }: { tab: TabInfo }) {
  return (
    <button
      type="button"
      onClick={() => void chrome.tabs.update(tab.id, { active: true })}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-[#ccc] hover:bg-[#1e1e1e]"
    >
      <Favicon domain={tab.domain} src={tab.favIconUrl} />
      <span className="flex-1 truncate text-left" title={tab.title}>{tab.title}</span>
    </button>
  )
}
