import { useState } from 'react'
import { Favicon } from '@/components/Favicon'
import { parseDomain } from '@/lib/utils'
import { X } from 'lucide-react'

interface TabInfo {
  id: number
  title: string
  url: string
  domain: string
  favIconUrl?: string
}

export function Duplicates({
  currentTab,
  allTabs,
  onReload,
}: {
  currentTab: TabInfo
  allTabs: chrome.tabs.Tab[]
  onReload: () => void
}) {
  const [closed, setClosed] = useState<Set<number>>(new Set())

  // Normalize URL: strip hash and sort query params for matching
  const normalizedCurrent = normalizeUrl(currentTab.url)

  const duplicates = allTabs.filter((t) => {
    if (t.id === currentTab.id || !t.url || closed.has(t.id!)) return false
    return normalizeUrl(t.url) === normalizedCurrent
  })

  if (duplicates.length === 0) return null

  return (
    <details open className="group rounded-lg border border-[#2a2a2a] bg-[#1e1e1e]/50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#888] select-none">
        Duplicates · {duplicates.length}
      </summary>
      <div className="space-y-0.5 px-1 pb-2">
        {duplicates.map((tab) => {
          const tabInfo = {
            id: tab.id!,
            title: tab.title || tab.url!,
            url: tab.url!,
            domain: parseDomain(tab.url!),
            favIconUrl: tab.favIconUrl,
          }
          return <DupRow key={tab.id} tab={tabInfo} onClose={() => {
            setClosed(prev => new Set(prev).add(tab.id!))
            void chrome.tabs.remove(tab.id!)
          }} />
        })}
      </div>
    </details>
  )
}

function DupRow({ tab, onClose }: { tab: TabInfo; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-[#1e1e1e]">
      <Favicon domain={tab.domain} src={tab.favIconUrl} />
      <span className="flex-1 truncate text-[#ccc]" title={tab.title}>{tab.title}</span>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded p-0.5 text-[#555] hover:text-[#e55]"
        title="Close this tab"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    // Sort query params for consistent comparison
    const params = new URLSearchParams(u.search)
    const sorted = new URLSearchParams([...params.entries()].sort())
    u.search = sorted.toString()
    return u.toString()
  } catch {
    return url
  }
}
