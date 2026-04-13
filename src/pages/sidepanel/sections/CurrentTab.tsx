import { Favicon } from '@/components/Favicon'

interface TabInfo {
  id: number
  title: string
  url: string
  domain: string
  favIconUrl?: string
}

export function CurrentTab({ tab }: { tab: TabInfo }) {
  return (
    <details open className="group rounded-lg border border-[#2a2a2a] bg-[#1e1e1e]/50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#888] select-none">
        Current Tab
      </summary>
      <div className="px-3 pb-3">
        <div className="flex items-start gap-2">
          <Favicon domain={tab.domain} src={tab.favIconUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[#f0e6d0]">{tab.title}</p>
            <p className="truncate text-xs text-[#666]" title={tab.url}>{tab.domain}</p>
          </div>
        </div>
      </div>
    </details>
  )
}
