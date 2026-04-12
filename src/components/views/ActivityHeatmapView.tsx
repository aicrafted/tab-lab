import { useMemo, useState } from 'react'
import { Favicon } from '@/components/Favicon'
import type { ViewProps } from '@/components/views/types'

interface HeatmapPage {
  id: string
  title: string
  url: string
  domain: string
  visits: number
}

interface DayData {
  key: string
  date: Date
  count: number
  domains: string[]
  pages: HeatmapPage[]
}

interface HoverState {
  day: DayData
  x: number
  y: number
}

const CELL_DAYS = 52 * 7

export function ActivityHeatmapView({ bookmarks, tabs, loading }: ViewProps) {
  const [hover, setHover] = useState<HoverState | null>(null)
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)

  const days = useMemo(() => {
    const end = startOfDay(new Date())
    const start = new Date(end)
    start.setDate(start.getDate() - (CELL_DAYS - 1))

    const byDay = new Map<string, DayData>()
    for (let i = 0; i < CELL_DAYS; i += 1) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      const key = toDayKey(date)
      byDay.set(key, {
        key,
        date,
        count: 0,
        domains: [],
        pages: [],
      })
    }

    for (const bookmark of bookmarks) {
      if (!bookmark.lastVisited) continue
      const key = toDayKey(new Date(bookmark.lastVisited))
      const entry = byDay.get(key)
      if (!entry) continue
      const visits = bookmark.visitCount ?? 1
      entry.count += visits
      if (!entry.domains.includes(bookmark.domain)) entry.domains.push(bookmark.domain)
      entry.pages.push({
        id: `bm-${bookmark.id}`,
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        domain: bookmark.domain,
        visits,
      })
    }

    for (const tab of tabs) {
      if (!tab.lastAccessed) continue
      const key = toDayKey(new Date(tab.lastAccessed))
      const entry = byDay.get(key)
      if (!entry) continue
      const visits = tab.visitCount ?? 1
      entry.count += visits
      if (!entry.domains.includes(tab.domain)) entry.domains.push(tab.domain)
      entry.pages.push({
        id: `tab-${tab.id}`,
        title: tab.title || tab.url,
        url: tab.url,
        domain: tab.domain,
        visits,
      })
    }

    return Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [bookmarks, tabs])

  const monthLabels = useMemo(() => {
    const labels: Array<{ label: string; week: number }> = []
    let prevMonth = -1
    for (let i = 0; i < days.length; i += 1) {
      const day = days[i]
      const month = day.date.getMonth()
      if (month !== prevMonth) {
        labels.push({
          label: day.date.toLocaleDateString(undefined, { month: 'short' }),
          week: Math.floor(i / 7),
        })
        prevMonth = month
      }
    }
    return labels
  }, [days])

  const maxCount = useMemo(
    () => days.reduce((max, day) => Math.max(max, day.count), 0),
    [days],
  )

  const selectedDay = selectedDayKey ? days.find((day) => day.key === selectedDayKey) ?? null : null

  async function openPage(url: string) {
    await chrome.tabs.create({ url })
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading activity heatmap...</div>
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Approximate: based on lastVisited/lastAccessed only.</span>
        </div>

        <div className="relative overflow-x-auto rounded-md border border-border bg-card/40 p-3">
          <div className="relative ml-8 h-5 w-[624px]">
            {monthLabels.map((month) => (
              <span
                key={`${month.label}-${month.week}`}
                className="absolute text-[10px] text-muted-foreground"
                style={{ left: month.week * 12 }}
              >
                {month.label}
              </span>
            ))}
          </div>

          <div className="flex items-start gap-2">
            <div className="mt-1 flex h-[82px] flex-col justify-between text-[10px] text-muted-foreground">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
              <span>Sun</span>
            </div>

            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: 'repeat(52, 10px)',
                gridTemplateRows: 'repeat(7, 10px)',
              }}
            >
              {days.map((day, index) => {
                const week = Math.floor(index / 7)
                const row = (day.date.getDay() + 6) % 7
                return (
                  <button
                    key={day.key}
                    type="button"
                    className={[
                      'h-2.5 w-2.5 rounded-sm border border-background transition-colors',
                      colorForCount(day.count, maxCount),
                      selectedDayKey === day.key ? 'ring-1 ring-primary' : '',
                    ].join(' ')}
                    style={{ gridColumn: week + 1, gridRow: row + 1 }}
                    onMouseMove={(event) =>
                      setHover({
                        day,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelectedDayKey(day.key)}
                    aria-label={`${formatLongDate(day.date)}: ${day.count} visits`}
                  />
                )
              })}
            </div>
          </div>

          {hover && (
            <div
              className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-background px-2.5 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              <div className="font-medium text-foreground">{formatLongDate(hover.day.date)}</div>
              <div className="text-muted-foreground">{hover.day.count} visits</div>
              <div className="mt-1 text-muted-foreground">
                {(hover.day.domains.length > 0 ? hover.day.domains.slice(0, 5) : ['No domains']).join(', ')}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card/40 p-3">
        <h3 className="text-sm font-semibold text-foreground">
          {selectedDay ? formatLongDate(selectedDay.date) : 'Select a day'}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedDay ? `${selectedDay.count} visits` : 'Click a cell to inspect pages'}
        </p>

        <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
          {selectedDay?.pages.map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => void openPage(page.url)}
              className="w-full rounded-md border border-border bg-background/60 p-2 text-left hover:bg-background"
            >
              <div className="flex items-start gap-2">
                <Favicon domain={page.domain} />
                <div className="min-w-0">
                  <div className="line-clamp-2 text-xs font-medium text-foreground">{page.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{page.url}</div>
                </div>
              </div>
            </button>
          ))}
          {selectedDay && selectedDay.pages.length === 0 && (
            <div className="text-xs text-muted-foreground">No pages recorded for this day.</div>
          )}
        </div>
      </aside>
    </section>
  )
}

function toDayKey(date: Date): string {
  return startOfDay(date).toDateString()
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function formatLongDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function colorForCount(count: number, max: number): string {
  if (count <= 0) return 'bg-muted/40'
  if (max <= 1) return 'bg-emerald-400/40'
  const ratio = count / max
  if (ratio <= 0.25) return 'bg-emerald-400/35'
  if (ratio <= 0.5) return 'bg-emerald-400/55'
  if (ratio <= 0.75) return 'bg-emerald-400/75'
  return 'bg-emerald-400'
}

