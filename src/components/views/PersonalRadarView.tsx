import { useMemo, useState } from 'react'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'
import { effectiveIntent } from '@/lib/ai/static-intent'
import type { PageIntent } from '@/lib/core/types'

const AXES = ['Work', 'Learning', 'Entertainment', 'Tools', 'Reference', 'Social', 'News', 'Other'] as const
type AxisName = (typeof AXES)[number]

interface RadarItem {
  id: string
  source: 'bookmark' | 'tab'
  title: string
  url: string
  domain: string
  favIconUrl?: string
  tabId?: number
  windowId?: number
  axis: AxisName
}

const INTENT_TO_AXIS: Partial<Record<PageIntent, AxisName>> = {
  article: 'Learning',
  document: 'Learning',
  reference: 'Reference',
  tool: 'Tools',
  code: 'Work',
  data: 'Work',
  service: 'Tools',
  video: 'Entertainment',
  image: 'Entertainment',
  audio: 'Entertainment',
  transactional: 'Other',
  archive: 'Other',
  repository: 'Work',
  other: 'Other',
}

export function PersonalRadarView({ bookmarks, tabs, loading }: ViewProps) {
  const [selectedAxis, setSelectedAxis] = useState<AxisName | null>(null)

  const bookmarkItems = useMemo<RadarItem[]>(
    () =>
      bookmarks.map((bookmark) => ({
        id: `bm-${bookmark.id}`,
        source: 'bookmark',
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        axis: axisFromItem(effectiveIntent(bookmark), bookmark.category),
      })),
    [bookmarks],
  )

  const tabItems = useMemo<RadarItem[]>(
    () =>
      tabs.map((tab) => ({
        id: `tab-${tab.id}`,
        source: 'tab',
        title: tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        favIconUrl: tab.favIconUrl,
        tabId: tab.id,
        windowId: tab.windowId,
        axis: axisFromItem(effectiveIntent(tab), tab.category),
      })),
    [tabs],
  )

  const bookmarkValues = useMemo(() => axisPercentages(bookmarkItems), [bookmarkItems])
  const tabValues = useMemo(() => axisPercentages(tabItems), [tabItems])

  const selectedItems = useMemo(() => {
    if (!selectedAxis) return []
    return [...bookmarkItems, ...tabItems].filter((item) => item.axis === selectedAxis)
  }, [bookmarkItems, tabItems, selectedAxis])

  async function openItem(item: RadarItem) {
    if (item.source === 'tab' && item.tabId != null && item.windowId != null) {
      await chrome.tabs.update(item.tabId, { active: true })
      await chrome.windows.update(item.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url: item.url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading personal radar...</div>
  }

  if (bookmarkItems.length === 0 && tabItems.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">No data available for personal radar.</div>
  }

  const width = 620
  const height = 620
  const centerX = width / 2
  const centerY = height / 2
  const radius = 235

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="overflow-hidden rounded-md border border-border bg-card/30 p-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[620px] w-full">
          {[0.25, 0.5, 0.75, 1].map((ring) => (
            <polygon
              key={ring}
              points={polygonPoints(AXES.length, centerX, centerY, radius * ring, AXES.map(() => 1))}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="1"
            />
          ))}

          {AXES.map((axis, index) => {
            const angle = angleForIndex(index, AXES.length)
            const x = centerX + Math.cos(angle) * radius
            const y = centerY + Math.sin(angle) * radius
            return (
              <g key={axis}>
                <line x1={centerX} y1={centerY} x2={x} y2={y} stroke="hsl(var(--border))" strokeWidth="1" />
                <text
                  x={centerX + Math.cos(angle) * (radius + 20)}
                  y={centerY + Math.sin(angle) * (radius + 20)}
                  textAnchor="middle"
                  className="cursor-pointer fill-foreground text-[12px] font-medium"
                  onClick={() => setSelectedAxis(axis)}
                >
                  {axis}
                </text>
              </g>
            )
          })}

          <polygon
            points={polygonPoints(AXES.length, centerX, centerY, radius, bookmarkValues)}
            fill="rgba(59, 130, 246, 0.2)"
            stroke="rgb(59, 130, 246)"
            strokeWidth="2"
          />
          <polygon
            points={polygonPoints(AXES.length, centerX, centerY, radius, tabValues)}
            fill="rgba(249, 115, 22, 0.2)"
            stroke="rgb(249, 115, 22)"
            strokeWidth="2"
          />
        </svg>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <div className="inline-flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
            Bookmarks
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" />
            Tabs
          </div>
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card/30 p-3">
        <h3 className="text-sm font-semibold text-foreground">
          {selectedAxis ? selectedAxis : 'Select an axis'}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedAxis ? `${selectedItems.length} items in this axis` : 'Click an axis label to drill down'}
        </p>

        <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto">
          {selectedItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void openItem(item)}
              className="w-full rounded-md border border-border bg-background/60 p-2 text-left hover:bg-background"
            >
              <div className="flex items-start gap-2">
                <Favicon domain={item.domain} src={item.favIconUrl} />
                <div className="min-w-0">
                  <div className="line-clamp-2 text-xs font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {item.domain} · {item.source}
                  </div>
                </div>
              </div>
            </button>
          ))}
          {selectedAxis && selectedItems.length === 0 && (
            <div className="text-xs text-muted-foreground">No items in this axis.</div>
          )}
        </div>
      </aside>
    </section>
  )
}

function axisFromItem(intent: PageIntent | undefined, category: string | undefined): AxisName {
  if (intent && INTENT_TO_AXIS[intent]) return INTENT_TO_AXIS[intent] as AxisName
  const value = (category ?? '').toLowerCase()
  if (value.includes('learn') || value.includes('tutorial') || value.includes('course')) return 'Learning'
  if (value.includes('tool') || value.includes('saas') || value.includes('app')) return 'Tools'
  if (value.includes('doc') || value.includes('reference') || value.includes('spec')) return 'Reference'
  if (value.includes('social') || value.includes('reddit') || value.includes('forum')) return 'Social'
  if (value.includes('video') || value.includes('entertainment') || value.includes('music')) return 'Entertainment'
  if (value.includes('news')) return 'News'
  if (value.includes('work') || value.includes('dev') || value.includes('finance') || value.includes('business')) return 'Work'
  return 'Other'
}

function axisPercentages(items: RadarItem[]): number[] {
  if (items.length === 0) return AXES.map(() => 0)
  const counts = new Map<AxisName, number>()
  for (const axis of AXES) counts.set(axis, 0)
  for (const item of items) {
    counts.set(item.axis, (counts.get(item.axis) ?? 0) + 1)
  }
  return AXES.map((axis) => (counts.get(axis) ?? 0) / items.length)
}

function angleForIndex(index: number, total: number): number {
  return -Math.PI / 2 + (index / total) * Math.PI * 2
}

function polygonPoints(total: number, centerX: number, centerY: number, radius: number, values: number[]): string {
  const points = []
  for (let i = 0; i < total; i += 1) {
    const ratio = values[i] ?? 0
    const angle = angleForIndex(i, total)
    const x = centerX + Math.cos(angle) * radius * ratio
    const y = centerY + Math.sin(angle) * radius * ratio
    points.push(`${x},${y}`)
  }
  return points.join(' ')
}

