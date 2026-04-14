import { chatComplete, extractJson } from './llm'
import type { KnownPlatform, LlmSettings } from './types'

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
const VALID_PLATFORMS = new Set<KnownPlatform>([
  'social', 'video', 'code', 'registry', 'qa', 'blog', 'docs', 'shopping', 'news', 'ai',
  'tool', 'sandbox', 'cloud', 'music', 'finance', 'ci', 'games', 'education', 'email', 'reference',
])

const DOMAIN_SYSTEM_PROMPT = `You are a web domain classifier with broad knowledge of websites worldwide.
Classify every domain you can identify — including well-known companies, brands, media, shops, tools, and services in any country.
Only skip domains that are clearly private/internal: IP addresses, localhost, random subdomains of unknown services, corporate intranets.
When in doubt whether you know a domain, include it rather than skipping it.
Always respond with valid JSON only.`

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
  const exact = cache.get(normalized)
  if (exact?.known) return exact

  const parent = getParentDomain(normalized)
  if (parent) {
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
    console.warn('[domain-enricher] failed to clear domain cache', err)
  }
}

function buildDomainPrompt(domains: string[]): string {
  return `Classify these domains. For each domain you can identify, output a JSON object with:
- "domain": exact domain string from the input (required, copy exactly with full TLD/subdomain; do not shorten or rewrite)
- "category": short label (1-4 words, Title Case) describing the site's main purpose (required)
- "description": 3-7 words describing what the site is (required)
- "platform": one of [social, video, code, registry, qa, blog, docs, shopping, news, ai, tool, sandbox, cloud, music, finance, ci, games, education, email, reference] — pick the best match; omit only if none fits

Skip only: IP addresses, localhost, clearly private/internal hostnames.
Include everything else you know — companies, brands, shops, media, tools from any country.
If you are not sure about exact domain spelling, skip that domain.

Examples:
[
  {"domain":"github.com","category":"Development","description":"code hosting and version control","platform":"code"},
  {"domain":"figma.com","category":"Design","description":"collaborative interface design tool","platform":"tool"},
  {"domain":"intel.com","category":"Hardware","description":"semiconductor and processor manufacturer"},
  {"domain":"jsfiddle.net","category":"Development","description":"browser-based JavaScript playground","platform":"sandbox"},
  {"domain":"rozetka.com.ua","category":"Marketplace","description":"largest online shop in Ukraine","platform":"shopping"},
  {"domain":"arxiv.org","category":"Research","description":"preprint repository for science papers","platform":"reference"}
]

Domains:
${domains.join('\n')}`
}

function normalizeDescription(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) return ''
  const words = compact.split(' ')
  return words.slice(0, 7).join(' ').slice(0, 120)
}

function normalizePlatform(value: unknown): KnownPlatform | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return VALID_PLATFORMS.has(normalized as KnownPlatform) ? normalized as KnownPlatform : undefined
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
      const platformValue = (row as { platform?: unknown }).platform
      if (typeof domainValue !== 'string') continue
      if (typeof descriptionValue !== 'string') continue

      const domain = normalizeDomain(domainValue)
      if (!sentDomains.has(domain) || seen.has(domain)) continue

      const category = typeof categoryValue === 'string'
        ? categoryValue.trim().slice(0, 40) || undefined
        : undefined
      const platform = normalizePlatform(platformValue)
      const description = normalizeDescription(descriptionValue)
      if (!description) continue

      result.push({
        domain,
        known: true,
        category,
        description,
        platform,
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
    const platformMatch = chunk.match(/["']?platform["']?\s*:\s*["']([^"'}]+)["']/i)
    if (!descriptionMatch) continue

    const description = normalizeDescription(descriptionMatch[1] ?? '')
    if (!description) continue
    const category = typeof categoryMatch?.[1] === 'string'
      ? categoryMatch[1].trim().slice(0, 40) || undefined
      : undefined
    const platform = normalizePlatform(platformMatch?.[1])

    results.push({
      domain,
      known: true,
      category,
      description,
      platform,
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
    DOMAIN_SYSTEM_PROMPT,
    buildDomainPrompt(domains),
    settings,
    estimateDomainMaxTokens(domains.length),
    {},
  )
  const parsed = parseDomainResponse(raw, new Set(domains), fetchedAt)
  const truncated = looksTruncatedResponse(raw)
  const unmatchedStructured = parsed.length === 0 && looksStructuredButUnmatched(raw)
  if (parsed.length === 0 && raw.trim()) {
    console.warn('[domain-enricher] empty parse result for non-empty response', {
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
          onProgress?.(batch.length)
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
        platform: row.known ? normalizePlatform(row.platform) : undefined,
        fetchedAt: Number.isFinite(row.fetchedAt) ? row.fetchedAt : 0,
      })
    }
    return map
  } catch (err) {
    console.warn('[domain-enricher] failed to load domain cache', err)
    return new Map()
  }
}

export async function estimateDomainEnrichmentWork(domains: string[]): Promise<number> {
  const uniqueDomains = [...new Set(domains.map(normalizeDomain).filter(Boolean))]
  if (uniqueDomains.length === 0) return 0

  const cache = await loadCachedDomains()
  const now = Date.now()
  const toQuery = new Set<string>()

  for (const domain of uniqueDomains) {
    const cached = cache.get(domain)
    if (!cached || (!cached.known && !isUnknownStillFresh(cached, now))) {
      toQuery.add(domain)
    }
  }

  const toQueryParents = new Set<string>()
  for (const domain of uniqueDomains) {
    const cached = cache.get(domain)
    if (cached?.known) continue

    const parent = getParentDomain(domain)
    if (!parent) continue
    if (toQuery.has(parent)) continue

    const parentCached = cache.get(parent)
    if (!parentCached || (!parentCached.known && !isUnknownStillFresh(parentCached, now))) {
      toQueryParents.add(parent)
    }
  }

  return toQuery.size + toQueryParents.size
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

    if (toQuery.length > 0 && canUseDomainEnrichmentLlm(settings)) {
      await queryDomainsIntoResult(toQuery, settings, result, onProgress)
    }

    const parentDomains: string[] = []
    for (const domain of uniqueDomains) {
      const info = result.get(domain)
      if (info?.known) continue
      const parent = getParentDomain(domain)
      if (parent && !result.has(parent)) parentDomains.push(parent)
    }

    if (parentDomains.length > 0 && canUseDomainEnrichmentLlm(settings)) {
      const uniqueParents = [...new Set(parentDomains)]
      const parentCache = await loadCachedDomains()
      const parentNow = Date.now()
      const toQueryParents: string[] = []

      for (const parent of uniqueParents) {
        const cached = parentCache.get(parent)
        if (cached && (cached.known || isUnknownStillFresh(cached, parentNow))) {
          result.set(parent, cached)
        } else {
          toQueryParents.push(parent)
        }
      }

      if (toQueryParents.length > 0) {
        await queryDomainsIntoResult(toQueryParents, settings, result, onProgress)
      }
    }

    return result
  } catch (err) {
    console.warn('[domain-enricher] enrich failed, using fallback', err)
    return new Map()
  }
}
