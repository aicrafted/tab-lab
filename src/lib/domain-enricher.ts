import { chatComplete, extractJson } from './llm'
import type { LlmSettings } from './types'

const DB_NAME = 'tabmind-domains'
const DB_VERSION = 1
const STORE_NAME = 'domain-knowledge'
const BATCH_SIZE = 25
const BATCH_CONCURRENCY = 4
const UNKNOWN_TTL_MS = 7 * 24 * 60 * 60 * 1000

const DOMAIN_SYSTEM_PROMPT = `You are a web domain classifier. You have knowledge of major websites and online services.
For each domain you recognize, return structured data. Skip domains you don't know (personal servers, internal tools, IP addresses, localhost, random subdomains).
Always respond with valid JSON only.`

export interface DomainInfo {
  domain: string
  known: boolean
  category?: string
  description?: string
  fetchedAt: number
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase()
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
    console.warn('[domain-enricher] failed to clear domain cache', err)
  }
}

function buildDomainPrompt(domains: string[]): string {
  return `Classify these domains. For each domain you recognize, provide:
- "domain": exact domain string from the input
- "category": a short category label (1-4 words, Title Case) that best describes the site
- "description": 3-7 words describing what the site is

Return a JSON array. Include ONLY domains you recognize. Skip unknown ones entirely.

Example:
[{"domain":"github.com","category":"Development","description":"code hosting and version control"}]

Domains:
${domains.join('\n')}`
}

function normalizeDescription(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) return ''
  const words = compact.split(' ')
  return words.slice(0, 7).join(' ').slice(0, 120)
}

function chunkDomains(domains: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < domains.length; i += size) {
    chunks.push(domains.slice(i, i + size))
  }
  return chunks
}

function parseDomainResponse(raw: string, sentDomains: Set<string>, fetchedAt: number): DomainInfo[] {
  try {
    const jsonText = extractJson(raw)
    const parsed = parseJsonLenient(jsonText)
    const rows = Array.isArray(parsed)
      ? parsed
      : (
          parsed
          && typeof parsed === 'object'
          && (
            (parsed as { domains?: unknown[] }).domains
            ?? (parsed as { results?: unknown[] }).results
            ?? (parsed as { items?: unknown[] }).items
            ?? (parsed as { data?: unknown[] }).data
          )
        )
    if (!Array.isArray(rows)) return []
    const result: DomainInfo[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const domainValue = (row as { domain?: unknown }).domain
      const categoryValue = (row as { category?: unknown }).category
      const descriptionValue = (row as { description?: unknown }).description
      if (typeof domainValue !== 'string') continue
      if (typeof descriptionValue !== 'string') continue

      const domain = normalizeDomain(domainValue)
      if (!sentDomains.has(domain) || seen.has(domain)) continue

      const category = typeof categoryValue === 'string'
        ? categoryValue.trim().slice(0, 40) || undefined
        : undefined
      const description = normalizeDescription(descriptionValue)
      if (!description) continue

      result.push({
        domain,
        known: true,
        category,
        description,
        fetchedAt,
      })
      seen.add(domain)
    }
    return result
  } catch (err) {
    console.warn('[domain-enricher] strict parse failed, trying heuristic parser', err, {
      rawResponse: raw,
    })
    const heuristic = parseDomainResponseHeuristic(raw, sentDomains, fetchedAt)
    if (heuristic.length > 0) return heuristic
    console.warn('[domain-enricher] failed to parse domain response', err, {
      rawResponse: raw,
    })
    return []
  }
}

function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
  }

  const repaired = text
    .replace(/\uFEFF/g, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)'([^'\\]+)'\s*:/g, '$1"$2":')
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value: string) => {
      const safe = value.replace(/"/g, '\\"')
      return `: "${safe}"`
    })
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\- ]*)\s*:/g, (_m, prefix: string, key: string) => {
      const safeKey = key.trim().replace(/"/g, '\\"')
      return `${prefix}"${safeKey}":`
    })

  return JSON.parse(repaired)
}

function parseDomainResponseHeuristic(raw: string, sentDomains: Set<string>, fetchedAt: number): DomainInfo[] {
  const results: DomainInfo[] = []
  const seen = new Set<string>()
  const objectLikeChunks = raw.match(/\{[\s\S]*?\}/g) ?? []

  for (const chunk of objectLikeChunks) {
    const domainMatch = chunk.match(/["']?domain["']?\s*:\s*["']([^"'\s,}]+)["']/i)
      ?? chunk.match(/\bdomain\s*=\s*([^\s,}]+)/i)
    if (!domainMatch) continue

    const domain = normalizeDomain(domainMatch[1] ?? '')
    if (!domain || !sentDomains.has(domain) || seen.has(domain)) continue

    const categoryMatch = chunk.match(/["']?category["']?\s*:\s*["']([^"'}]+)["']/i)
    const descriptionMatch = chunk.match(/["']?description["']?\s*:\s*["']([^"'}]+)["']/i)
    if (!descriptionMatch) continue

    const description = normalizeDescription(descriptionMatch[1] ?? '')
    if (!description) continue
    const category = typeof categoryMatch?.[1] === 'string'
      ? categoryMatch[1].trim().slice(0, 40) || undefined
      : undefined

    results.push({
      domain,
      known: true,
      category,
      description,
      fetchedAt,
    })
    seen.add(domain)
  }

  return results
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

async function classifyDomainBatchWithRetry(
  domains: string[],
  settings: LlmSettings,
  depth: number,
): Promise<DomainInfo[]> {
  if (domains.length === 0) return []
  const fetchedAt = Date.now()
  const raw = await chatComplete(
    DOMAIN_SYSTEM_PROMPT,
    buildDomainPrompt(domains),
    settings,
    estimateDomainMaxTokens(domains.length),
    {},
  )
  const parsed = parseDomainResponse(raw, new Set(domains), fetchedAt)
  const truncated = looksTruncatedResponse(raw)
  if (parsed.length === 0 && raw.trim()) {
    console.warn('[domain-enricher] empty parse result for non-empty response', {
      rawPreview: raw.slice(0, 240),
      rawResponse: raw,
    })
  }
  // If response appears truncated, split and retry even when heuristic parser
  // extracted some items, otherwise we risk marking the remaining domains unknown.
  if (truncated && domains.length > 1 && depth < 3) {
    const mid = Math.ceil(domains.length / 2)
    const [left, right] = await Promise.all([
      classifyDomainBatchWithRetry(domains.slice(0, mid), settings, depth + 1),
      classifyDomainBatchWithRetry(domains.slice(mid), settings, depth + 1),
    ])
    return [...left, ...right]
  }
  return parsed
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
        fetchedAt: Number.isFinite(row.fetchedAt) ? row.fetchedAt : 0,
      })
    }
    return map
  } catch (err) {
    console.warn('[domain-enricher] failed to load domain cache', err)
    return new Map()
  }
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
    const toQuery: string[] = []
    const now = Date.now()

    for (const domain of uniqueDomains) {
      const cached = cache.get(domain)
      if (!cached) {
        toQuery.push(domain)
        continue
      }

      if (cached.known || isUnknownStillFresh(cached, now)) {
        result.set(domain, cached)
      } else {
        toQuery.push(domain)
      }
    }

    if (toQuery.length === 0 || !canUseDomainEnrichmentLlm(settings)) {
      return result
    }

    const batches = chunkDomains(toQuery, BATCH_SIZE)
    const concurrency = Math.min(BATCH_CONCURRENCY, batches.length)
    let nextBatchIndex = 0

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (nextBatchIndex < batches.length) {
          const batchIndex = nextBatchIndex
          nextBatchIndex += 1
          const batch = batches[batchIndex]
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
            onProgress?.(batch.length)
          } catch (err) {
            console.warn('[domain-enricher] domain enrichment batch failed', err)
            // Even on batch failure we advance progress for this batch slot.
            onProgress?.(batch.length)
          }
        }
      }),
    )

    return result
  } catch (err) {
    console.warn('[domain-enricher] enrich failed, using fallback', err)
    return new Map()
  }
}
