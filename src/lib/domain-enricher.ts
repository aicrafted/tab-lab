import { chatComplete } from './llm'
import { domainEnricherLog } from './logger'
import { enrichDomain } from './prompts'
import { KNOWN_PLATFORMS, type KnownPlatform, type LlmSettings } from './types'
import { getPrefilledDomain } from './domain-prefill'

const DB_NAME = 'tabmind-domains'
const DB_VERSION = 1
const STORE_NAME = 'domain-knowledge'
const BATCH_SIZE = 25
const BATCH_CONCURRENCY = 4
const UNKNOWN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const COMPOUND_TLDS = new Set([
  'com.ua', 'co.uk', 'com.br', 'co.jp', 'com.au', 'co.nz',
  'org.uk', 'me.uk', 'net.uk', 'com.ar', 'com.mx', 'com.tr',
])
const domainParseMetrics = {
  strict: 0,
  heuristic: 0,
  fail: 0,
}

function trackDomainParse(kind: 'strict' | 'heuristic' | 'fail'): void {
  domainParseMetrics[kind] += 1
  const total = domainParseMetrics.strict + domainParseMetrics.heuristic + domainParseMetrics.fail
  if (total > 0 && total % 20 === 0) {
    domainEnricherLog.info('parse metrics', {
      strict: domainParseMetrics.strict,
      heuristic: domainParseMetrics.heuristic,
      fail: domainParseMetrics.fail,
    })
  }
}

const DOMAIN_BATCH_RESPONSE_SCHEMA = {
  name: 'domain_batch_response',
  schema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        category: { type: 'string' },
        description: { type: 'string' },
        platform: {
          type: 'string',
          enum: [...KNOWN_PLATFORMS],
        },
      },
      required: ['domain', 'category', 'description'],
      additionalProperties: false,
    },
  },
  strict: false,
} as const

export interface DomainInfo {
  domain: string
  known: boolean
  category?: string
  description?: string
  platform?: KnownPlatform
  fetchedAt: number
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase()
}

export function getParentDomain(domain: string): string | null {
  const normalized = normalizeDomain(domain)
  const parts = normalized.split('.')
  if (parts.length <= 2) return null

  const candidate = parts.slice(1).join('.')
  const candidateParts = candidate.split('.')
  if (candidateParts.length === 2 && COMPOUND_TLDS.has(candidate)) return null
  return candidate
}

export function getDomainInfo(
  domain: string,
  cache: Map<string, DomainInfo>,
): DomainInfo | undefined {
  const normalized = normalizeDomain(domain)

  // 1. Check Prefill (Layer 0)
  const prefilled = getPrefilledDomain(normalized)
  if (prefilled) {
    return {
      domain: normalized,
      known: true,
      category: prefilled.category,
      description: prefilled.description,
      platform: prefilled.platform,
      fetchedAt: 0,
    }
  }

  // 2. Check Match in Cache
  const exact = cache.get(normalized)
  if (exact?.known) return exact

  const parent = getParentDomain(normalized)
  if (parent) {
    // 3. Check Parent in Prefill
    const parentPrefilled = getPrefilledDomain(parent)
    if (parentPrefilled) {
      return {
        domain: parent,
        known: true,
        category: parentPrefilled.category,
        description: parentPrefilled.description,
        platform: parentPrefilled.platform,
        fetchedAt: 0,
      }
    }

    // 4. Check Parent in Cache
    const parentInfo = cache.get(parent)
    if (parentInfo?.known) return parentInfo
  }
  return exact
}

function canUseDomainEnrichmentLlm(settings: LlmSettings): boolean {
  const provider = settings.tasks.chat.provider
  if (provider === 'gemini-nano') return false
  if (provider === 'webllm') return Boolean(settings.tasks.chat.model)
  if (provider === 'lmstudio') {
    return Boolean(settings.providers.lmstudio.baseUrl && settings.tasks.chat.model)
  }
  if (provider === 'openrouter') {
    return Boolean(settings.providers.openrouter.apiKey && settings.tasks.chat.model)
  }
  return false
}

function isUnknownStillFresh(info: DomainInfo, now = Date.now()): boolean {
  return !info.known && now - info.fetchedAt < UNKNOWN_TTL_MS
}

function openDomainDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'domain' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getAllDomainRows(): Promise<DomainInfo[]> {
  const db = await openDomainDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve((req.result as DomainInfo[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

async function putDomainRows(rows: DomainInfo[]): Promise<void> {
  if (rows.length === 0) return
  const db = await openDomainDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const row of rows) store.put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearDomainKnowledgeCache(): Promise<void> {
  try {
    const db = await openDomainDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    domainEnricherLog.warn('failed to clear domain cache', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

function chunkDomains(domains: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < domains.length; i += size) {
    chunks.push(domains.slice(i, i + size))
  }
  return chunks
}

async function classifyDomainBatch(domains: string[], settings: LlmSettings): Promise<DomainInfo[]> {
  return classifyDomainBatchWithRetry(domains, settings, 0)
}

function estimateDomainMaxTokens(domainCount: number): number {
  // Each recognized domain returns ~20-40 tokens in JSON.
  // Keep a generous ceiling to avoid truncation on larger batches.
  return Math.min(5_000, Math.max(1_000, domainCount * 100))
}

function looksTruncatedResponse(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('```') && !trimmed.endsWith('```')) return true
  if (!trimmed.endsWith(']') && !trimmed.endsWith('}')) return true
  return false
}

function looksStructuredButUnmatched(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  return trimmed.includes('"domain"') || trimmed.includes("'domain'")
}

async function classifyDomainBatchWithRetry(
  domains: string[],
  settings: LlmSettings,
  depth: number,
): Promise<DomainInfo[]> {
  if (domains.length === 0) return []
  const fetchedAt = Date.now()
  const raw = await chatComplete(
    enrichDomain.system(),
    enrichDomain.user(domains),
    settings,
    estimateDomainMaxTokens(domains.length),
    settings.tasks.chat.provider !== 'gemini-nano'
      ? { responseFormat: 'json', metricKey: 'domains', jsonSchema: DOMAIN_BATCH_RESPONSE_SCHEMA }
      : {},
  )
  const parsedDetailed = enrichDomain.parseResponseDetailed(raw, new Set(domains), fetchedAt)
  if (parsedDetailed.strict) {
    trackDomainParse('strict')
  } else if (parsedDetailed.heuristic) {
    trackDomainParse('heuristic')
  } else {
    trackDomainParse('fail')
  }
  const parsed = parsedDetailed.rows
  const truncated = looksTruncatedResponse(raw)
  const unmatchedStructured = parsed.length === 0 && looksStructuredButUnmatched(raw)
  if (parsed.length === 0 && raw.trim()) {
    domainEnricherLog.warn('empty parse result for non-empty response', {
      rawPreview: raw.slice(0, 240),
      rawResponse: raw,
    })
  }
  // If response appears truncated, split and retry even when heuristic parser
  // extracted some items, otherwise we risk marking the remaining domains unknown.
  if ((truncated || unmatchedStructured) && domains.length > 1 && depth < 3) {
    const mid = Math.ceil(domains.length / 2)
    const [left, right] = await Promise.all([
      classifyDomainBatchWithRetry(domains.slice(0, mid), settings, depth + 1),
      classifyDomainBatchWithRetry(domains.slice(mid), settings, depth + 1),
    ])
    return [...left, ...right]
  }
  return parsed
}

async function queryDomainsIntoResult(
  domains: string[],
  settings: LlmSettings,
  result: Map<string, DomainInfo>,
  onProgress?: (delta: number) => void,
): Promise<void> {
  if (domains.length === 0) return

  const batches = chunkDomains(domains, BATCH_SIZE)
  const concurrency = Math.min(BATCH_CONCURRENCY, batches.length)
  let nextBatchIndex = 0

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextBatchIndex < batches.length) {
        const batchIndex = nextBatchIndex
        nextBatchIndex += 1
        const batch = batches[batchIndex]
        const batchSize = batch.length
        const upfrontProgress = batchSize > 0 ? 1 : 0
        if (upfrontProgress > 0) onProgress?.(upfrontProgress)
        try {
          const knownItems = await classifyDomainBatch(batch, settings)
          const knownByDomain = new Map(knownItems.map((item) => [item.domain, item]))
          const fetchedAt = Date.now()
          const rowsToStore: DomainInfo[] = []

          for (const domain of batch) {
            const known = knownByDomain.get(domain)
            if (known) {
              rowsToStore.push(known)
              result.set(domain, known)
              continue
            }
            const unknownInfo: DomainInfo = { domain, known: false, fetchedAt }
            rowsToStore.push(unknownInfo)
            result.set(domain, unknownInfo)
          }

          await putDomainRows(rowsToStore)
          onProgress?.(Math.max(0, batchSize - upfrontProgress))
        } catch (err) {
          domainEnricherLog.error('domain enrichment batch failed', {
            err: err instanceof Error ? err.message : String(err),
            batchIndex,
            batchSize,
          })
          onProgress?.(Math.max(0, batchSize - upfrontProgress))
        }
      }
    }),
  )
}

export async function loadCachedDomains(): Promise<Map<string, DomainInfo>> {
  try {
    const rows = await getAllDomainRows()
    const map = new Map<string, DomainInfo>()
    for (const row of rows) {
      if (!row?.domain) continue
      const domain = normalizeDomain(row.domain)
      map.set(domain, {
        domain,
        known: Boolean(row.known),
        category: row.known && row.category ? row.category : undefined,
        description: row.known && row.description ? row.description : undefined,
        platform: row.known ? enrichDomain.normalizePlatform(row.platform) : undefined,
        fetchedAt: Number.isFinite(row.fetchedAt) ? row.fetchedAt : 0,
      })
    }
    return map
  } catch (err) {
    domainEnricherLog.warn('failed to load domain cache', {
      err: err instanceof Error ? err.message : String(err),
    })
    return new Map()
  }
}

export async function estimateDomainEnrichmentWork(domains: string[]): Promise<number> {
  const uniqueDomains = [...new Set(domains.map(normalizeDomain).filter(Boolean))]
  if (uniqueDomains.length === 0) return 0

  const cache = await loadCachedDomains()
  const now = Date.now()
  const toQuery = new Set<string>()

  // 1. Identify unresolved domains
  for (const domain of uniqueDomains) {
    if (getPrefilledDomain(domain)) continue

    const cached = cache.get(domain)
    if (!cached || (!cached.known && !isUnknownStillFresh(cached, now))) {
      toQuery.add(domain)
    }
  }

  // 2. Proactively add parents of unresolved domains
  for (const domain of toQuery) {
    const parent = getParentDomain(domain)
    if (!parent || toQuery.has(parent)) continue

    if (getPrefilledDomain(parent)) continue

    const parentCached = cache.get(parent)
    if (!parentCached || (!parentCached.known && !isUnknownStillFresh(parentCached, now))) {
      toQuery.add(parent)
    }
  }

  return toQuery.size
}

export async function enrichDomains(
  domains: string[],
  settings: LlmSettings,
  onProgress?: (delta: number) => void,
): Promise<Map<string, DomainInfo>> {
  try {
    const uniqueDomains = [...new Set(domains.map(normalizeDomain).filter(Boolean))]
    if (uniqueDomains.length === 0) return new Map()

    const cache = await loadCachedDomains()
    const result = new Map<string, DomainInfo>()
    const toQuery = new Set<string>()
    const now = Date.now()

    for (const domain of uniqueDomains) {
      const prefilled = getPrefilledDomain(domain)
      if (prefilled) {
        result.set(domain, {
          domain,
          known: true,
          category: prefilled.category,
          description: prefilled.description,
          platform: prefilled.platform,
          fetchedAt: 0,
        })
        continue
      }

      const cached = cache.get(domain)
      if (cached && (cached.known || isUnknownStillFresh(cached, now))) {
        result.set(domain, cached)
      } else {
        toQuery.add(domain)
      }
    }

    // 2. Proactively gather parents for unresolved domains
    if (toQuery.size > 0) {
      for (const domain of toQuery) {
        const parent = getParentDomain(domain)
        if (!parent || toQuery.has(parent) || result.has(parent)) continue

        const prefilled = getPrefilledDomain(parent)
        if (prefilled) {
          result.set(parent, {
            domain: parent,
            known: true,
            category: prefilled.category,
            description: prefilled.description,
            platform: prefilled.platform,
            fetchedAt: 0,
          })
          continue
        }

        const cached = cache.get(parent)
        if (cached && (cached.known || isUnknownStillFresh(cached, now))) {
          result.set(parent, cached)
        } else {
          toQuery.add(parent)
        }
      }
    }

    if (toQuery.size > 0 && canUseDomainEnrichmentLlm(settings)) {
      await queryDomainsIntoResult([...toQuery], settings, result, onProgress)
    }

    return result
  } catch (err) {
    domainEnricherLog.error('enrich failed, using fallback', {
      err: err instanceof Error ? err.message : String(err),
    })
    return new Map()
  }
}
