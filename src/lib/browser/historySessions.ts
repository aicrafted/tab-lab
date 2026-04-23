import { getRecentVisits } from './visitTracker'
import { IS_CHROME } from '../core/browser-detect'

export interface Visit {
  url: string
  title: string
  visitTime: number
  visitId: string
  referringVisitId: string
  transition: 'typed' | 'link' | 'auto_bookmark' | 'form_submit' | 'reload' | 'generated' | string
  typedCount: number
  timeOnPage: number
}

export type SessionType = 'research' | 'exploration' | 'routine' | 'browsing'

export interface Session {
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

export async function loadSessions(): Promise<Session[]> {
  const startedAt = performance.now()

  const flat = IS_CHROME
    ? await loadSessionsFromChromeHistory()
    : await loadSessionsFromVisitTracker()


  flat.sort((a, b) => a.visitTime - b.visitTime)

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

  const sessions = raw.map((visits, index) => ({
    id: String(index),
    visits,
    type: classifySession(visits),
    startTime: visits[0].visitTime,
    durationMs: visits[visits.length - 1].visitTime - visits[0].visitTime,
  }))

  console.info('[SessionStory] sessions built', {
    sessions: sessions.length,
    flatVisits: flat.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  })
  return sessions
}

async function loadSessionsFromChromeHistory(): Promise<Visit[]> {
  const historyItems = await chrome.history.search({
    text: '',
    maxResults: 5000,
    startTime: Date.now() - HISTORY_LOOKBACK_DAYS * DAY_MS,
  })

  const normalizedItems = historyItems.filter(
    (item): item is chrome.history.HistoryItem & { url: string } => Boolean(item.url),
  )
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

  return nested.flat()
}

async function loadSessionsFromVisitTracker(): Promise<Visit[]> {
  const items = await getRecentVisits({
    startTime: Date.now() - HISTORY_LOOKBACK_DAYS * DAY_MS,
    maxResults: 5000,
  })

  // visitTracker stores one row per page load, not per individual visit.
  // Expand each item back to a single Visit entry at lastVisitTime.
  return items.map((item) => ({
    url: item.url,
    title: item.title,
    visitTime: item.lastVisitTime,
    visitId: '',
    referringVisitId: '0',
    transition: 'link',
    typedCount: 0,
    timeOnPage: 0,
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

function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
