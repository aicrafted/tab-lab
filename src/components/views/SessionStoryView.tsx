import { useEffect, useMemo, useState } from 'react'
import { Favicon } from '@/components/Favicon'
import { colorFromKey } from '@/components/views/stubs'
import type { ViewProps } from '@/components/views/types'
import { cn } from '@/lib/utils'

interface Visit {
  url: string
  title: string
  visitTime: number
  visitId: string
  referringVisitId: string
  transition: 'typed' | 'link' | 'auto_bookmark' | 'form_submit' | 'reload' | 'generated' | string
  typedCount: number
  timeOnPage: number
}

type SessionType = 'research' | 'exploration' | 'routine' | 'browsing'

interface Session {
  id: string
  visits: Visit[]
  type: SessionType
  startTime: number
  durationMs: number
}

const SESSION_BREAK_MS = 30 * 60_000
const DAY_MS = 86_400_000
const HISTORY_LOOKBACK_DAYS = 30
const VISIT_BATCH_SIZE = 50

const SESSION_TYPE_META: Record<SessionType, { label: string; color: string }> = {
  research: { label: 'Research', color: 'hsl(220 80% 60%)' },
  exploration: { label: 'Exploration', color: 'hsl(280 70% 60%)' },
  routine: { label: 'Routine', color: 'hsl(140 60% 45%)' },
  browsing: { label: 'Browsing', color: 'hsl(40 70% 55%)' },
}

export function SessionStoryView(_: ViewProps) {
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [historyAvailable, setHistoryAvailable] = useState(true)
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const built = await loadSessions()
        if (!cancelled) {
          setHistoryAvailable(true)
          setSessions(built)
          setSelectedSessionId(built[0]?.id ?? null)
        }
      } catch {
        if (!cancelled) {
          setHistoryAvailable(false)
          setSessions([])
          setSelectedSessionId(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId],
  )
  const sessionGroups = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const session of sessions) {
      const key = getMonthKey(session.startTime)
      const existing = map.get(key)
      if (existing) existing.push(session)
      else map.set(key, [session])
    }
    return Array.from(map.entries()).map(([key, monthSessions]) => ({
      key,
      label: formatMonthLabel(key),
      sessions: monthSessions,
    }))
  }, [sessions])
  const detailBlocks = useMemo(() => buildDetailBlocks(selected?.visits ?? []), [selected])

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading session story...</div>
  }

  if (!historyAvailable || sessions.length === 0) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Enable history permission to see session story
      </div>
    )
  }

  return (
    <section className="flex items-start gap-4">
      <aside className="w-[220px] shrink-0 space-y-2 overflow-y-auto border-r border-border pr-2 max-h-[70vh]">
        {sessionGroups.map((group) => {
          const isExpanded = expandedMonths.has(group.key)
          return (
            <div key={group.key} className="space-y-1">
              <button
                type="button"
                onClick={() =>
                  setExpandedMonths((previous) => {
                    const next = new Set(previous)
                    if (next.has(group.key)) next.delete(group.key)
                    else next.add(group.key)
                    return next
                  })
                }
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-semibold text-muted-foreground hover:bg-accent/40"
              >
                <span>{group.label}</span>
                <span className="text-[10px]">{isExpanded ? '▾' : '▸'} {group.sessions.length}</span>
              </button>

              {isExpanded && group.sessions.map((session) => {
                const active = selected?.id === session.id
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-yellow-400/50',
                      active && 'bg-[#60853d] text-white hover:bg-[#60853d]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('font-medium text-foreground', active && 'text-white')}>{formatSessionTime(session.startTime)}</span>
                      <span
                        className="rounded px-1 py-0.5 text-[10px] font-semibold text-white"
                        style={{ backgroundColor: active ? 'rgba(255,255,255,0.22)' : SESSION_TYPE_META[session.type].color }}
                      >
                        {SESSION_TYPE_META[session.type].label}
                      </span>
                    </div>
                    <div className={cn('mt-0.5 text-muted-foreground', active && 'text-white/90')}>
                      {session.visits.length} pages · {formatDuration(session.durationMs)}
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </aside>

      <div className="flex-1 self-start overflow-visible rounded-md border border-border/60">
        {!selected && (
          <div className="p-4 text-sm text-muted-foreground">Select a session to see the detail ribbon.</div>
        )}
        {selected && detailBlocks.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No visits to render for this session.</div>
        )}
        <div className="flex flex-wrap content-start items-end gap-x-1 gap-y-4 px-4 py-8">
          {detailBlocks.map((block, blockIndex) => {
            if (block.kind === 'single') {
              return (
                <NodeWithArrow
                  key={`single-${block.visit.visitId}-${blockIndex}`}
                  visit={block.visit}
                  index={block.index}
                  previousVisit={block.index > 0 ? selected?.visits[block.index - 1] ?? null : null}
                  sessionStart={selected?.visits[0]?.visitTime ?? block.visit.visitTime}
                />
              )
            }

            const domain = getDomain(block.visits[0]?.url ?? '')
            return (
              <div
                key={`group-${block.startIndex}-${blockIndex}`}
                className="rounded-md px-1 py-2"
                style={{ backgroundColor: withAlpha(colorFromKey(domain), 0.14) }}
              >
                <div className="flex items-end gap-1">
                  {block.visits.map((visit, groupIndex) => {
                    const index = block.startIndex + groupIndex
                    return (
                      <NodeWithArrow
                        key={`group-node-${visit.visitId}-${index}`}
                        visit={visit}
                        index={index}
                        previousVisit={index > 0 ? selected?.visits[index - 1] ?? null : null}
                        sessionStart={selected?.visits[0]?.visitTime ?? visit.visitTime}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

interface NodeWithArrowProps {
  visit: Visit
  index: number
  previousVisit: Visit | null
  sessionStart: number
}

function NodeWithArrow({ visit, index, previousVisit, sessionStart }: NodeWithArrowProps) {
  const domain = getDomain(visit.url)
  const isBounce = visit.timeOnPage > 0 && visit.timeOnPage < 10_000
  const isTyped = visit.transition === 'typed'
  const isBookmark = visit.transition === 'auto_bookmark'
  const isRegular = visit.typedCount > 5
  const offset = visit.visitTime - sessionStart
  const gap = previousVisit ? visit.visitTime - previousVisit.visitTime : 0

  return (
    <div className="flex items-center">
      {index > 0 && previousVisit && (
        <div className="mx-1 flex flex-col items-center">
          <span className="text-[10px] text-muted-foreground">+{formatDuration(gap)}</span>
          <span className="text-muted-foreground">→</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => void chrome.tabs.create({ url: visit.url })}
        style={{
          borderColor: colorFromKey(domain),
          opacity: isBounce ? 0.35 : 1,
          boxShadow: isRegular ? `0 0 0 2px ${colorFromKey(domain)}` : undefined,
        }}
        className="flex max-w-[90px] flex-col items-center rounded-md border-2 bg-card px-1.5 py-1 hover:bg-accent/50"
        title={`${visit.title}\n${visit.url}\nTransition: ${visit.transition}\n${isBounce ? 'Bounced' : `${formatDuration(visit.timeOnPage)} on page`}${visit.typedCount > 0 ? `\nTyped ${visit.typedCount}x` : ''}`}
      >
        <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
          {isTyped && <span title="Typed URL">⌨</span>}
          {isBookmark && <span title="Opened from bookmark">🔖</span>}
        </div>
        <Favicon domain={domain} />
        <span className="mt-0.5 line-clamp-2 text-center text-[10px] leading-tight text-foreground">
          {truncate(visit.title, 20)}
        </span>
        <span className="text-[9px] text-muted-foreground">{formatTime(offset)}</span>
      </button>
    </div>
  )
}

async function loadSessions(): Promise<Session[]> {
  const historyItems = await chrome.history.search({
    text: '',
    maxResults: 5000,
    startTime: Date.now() - HISTORY_LOOKBACK_DAYS * DAY_MS,
  })

  const normalizedItems = historyItems.filter((item): item is chrome.history.HistoryItem & { url: string } => Boolean(item.url))
  const typedCountMap = new Map(normalizedItems.map((item) => [item.url, item.typedCount ?? 0]))

  const nested: Visit[][] = []
  for (let i = 0; i < normalizedItems.length; i += VISIT_BATCH_SIZE) {
    const batch = normalizedItems.slice(i, i + VISIT_BATCH_SIZE)
    const batchVisits = await Promise.all(
      batch.map(async (item) => {
        const visits = await chrome.history.getVisits({ url: item.url })
        return visits
          .filter((visit) => visit.visitTime != null)
          .map((visit) => ({
            url: item.url,
            title: item.title ?? item.url,
            visitTime: visit.visitTime as number,
            visitId: String(visit.visitId ?? visit.id ?? ''),
            referringVisitId: String(visit.referringVisitId ?? '0'),
            transition: (visit.transition ?? 'link') as Visit['transition'],
            typedCount: typedCountMap.get(item.url) ?? 0,
            timeOnPage: 0,
          }))
      }),
    )
    nested.push(...batchVisits)
  }

  const flat = nested.flat().sort((a, b) => a.visitTime - b.visitTime)

  for (let i = 0; i < flat.length - 1; i += 1) {
    const gap = flat[i + 1].visitTime - flat[i].visitTime
    flat[i].timeOnPage = gap < SESSION_BREAK_MS ? gap : 0
  }

  const raw: Visit[][] = []
  let current: Visit[] = []
  for (const visit of flat) {
    if (current.length > 0 && visit.visitTime - current[current.length - 1].visitTime > SESSION_BREAK_MS) {
      if (current.length >= 3) raw.push(current)
      current = []
    }
    current.push(visit)
  }
  if (current.length >= 3) raw.push(current)
  raw.reverse()

  return raw.map((visits, index) => ({
    id: String(index),
    visits,
    type: classifySession(visits),
    startTime: visits[0].visitTime,
    durationMs: visits[visits.length - 1].visitTime - visits[0].visitTime,
  }))
}

function classifySession(visits: Visit[]): SessionType {
  const typedEntries = visits.filter((visit) => visit.transition === 'typed').length
  const uniqueDomains = new Set(visits.map((visit) => getDomain(visit.url))).size
  const linkChainLength = longestLinkChain(visits)
  const allRoutine = visits.every((visit) => visit.typedCount > 5)

  if (allRoutine) return 'routine'
  if (typedEntries === 1 && linkChainLength >= 3 && uniqueDomains <= 4) return 'research'
  if (typedEntries >= 3) return 'exploration'
  return 'browsing'
}

function longestLinkChain(visits: Visit[]): number {
  let max = 0
  let current = 0
  for (const visit of visits) {
    if (visit.transition === 'link') {
      current += 1
      if (current > max) max = current
    } else {
      current = 0
    }
  }
  return max
}

type DetailBlock =
  | { kind: 'single'; visit: Visit; index: number }
  | { kind: 'group'; visits: Visit[]; startIndex: number }

function buildDetailBlocks(visits: Visit[]): DetailBlock[] {
  const blocks: DetailBlock[] = []
  let i = 0
  while (i < visits.length) {
    if (visits[i].transition !== 'link') {
      blocks.push({ kind: 'single', visit: visits[i], index: i })
      i += 1
      continue
    }

    let j = i
    while (j < visits.length && visits[j].transition === 'link') j += 1
    const runLength = j - i
    if (runLength >= 3) {
      blocks.push({ kind: 'group', visits: visits.slice(i, j), startIndex: i })
    } else {
      for (let k = i; k < j; k += 1) {
        blocks.push({ kind: 'single', visit: visits[k], index: k })
      }
    }
    i = j
  }
  return blocks
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function withAlpha(color: string, alpha: number): string {
  const match = color.match(/^hsl\((\d+)\s+([\d.]+)%\s+([\d.]+)%\)$/)
  if (!match) return color
  const [, h, s, l] = match
  const clamped = Math.max(0, Math.min(1, alpha))
  return `hsl(${h} ${s}% ${l}% / ${clamped})`
}

function getMonthKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number(yearRaw)
  const monthIndex = Number(monthRaw) - 1
  const date = new Date(year, monthIndex, 1)
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const yesterday = new Date(now.getTime() - DAY_MS)
  const isYesterday = date.toDateString() === yesterday.toDateString()
  const hh = date.getHours().toString().padStart(2, '0')
  const mm = date.getMinutes().toString().padStart(2, '0')

  if (isToday) return `Today ${hh}:${mm}`
  if (isYesterday) return `Yesterday ${hh}:${mm}`

  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hh}:${mm}`
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}min`
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

