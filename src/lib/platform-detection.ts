import { DOMAIN_PREFILL, PREFILL_CANDIDATES_SORTED } from './domain-prefill'
import type { KnownPlatform, PageIntent } from './types'
import type { DomainInfo } from './domain-enricher'

export const PLATFORM_TO_INTENT: Partial<Record<KnownPlatform, PageIntent>> = {
  social: 'article',
  video: 'video',
  music: 'video',
  code: 'repository',
  sandbox: 'tool',
  tool: 'tool',
  cloud: 'tool',
  ci: 'tool',
  email: 'tool',
  education: 'article',
  reference: 'reference',
  qa: 'article',
  blog: 'article',
}

function normalizeDomain(domain: string): string {
  let normalized = domain.trim().toLowerCase()
  if (!normalized) return normalized
  if (normalized.startsWith('www.')) normalized = normalized.slice(4)
  return normalized
}

function matchesDomain(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`)
}

export function detectPlatform(
  domain: string,
  enrichmentCache?: Map<string, DomainInfo>,
): KnownPlatform | undefined {
  const normalized = normalizeDomain(domain)
  if (!normalized) return undefined

  for (const candidate of PREFILL_CANDIDATES_SORTED) {
    if (matchesDomain(normalized, candidate)) {
      return DOMAIN_PREFILL[candidate].platform
    }
  }



  if (normalized.startsWith('docs.')) return 'docs'
  const enriched = enrichmentCache?.get(normalized)
  if (enriched?.known && enriched.platform) return enriched.platform
  return undefined
}

export function detectPlatformFromUrl(
  url: string,
  enrichmentCache?: Map<string, DomainInfo>,
): KnownPlatform | undefined {
  try {
    const parsed = new URL(url)
    return detectPlatform(parsed.hostname, enrichmentCache)
  } catch {
    return undefined
  }
}

function looksLikeSpecificItem(url: string): boolean {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.toLowerCase()

    // 1. Common content identifiers in query
    if (parsed.searchParams.has('id') || parsed.searchParams.has('item')) return true

    // 2. Common path segments for specific content
    const contentSegments = ['/post/', '/posts/', '/comments/', '/status/', '/p/', '/item/', '/questions/', '/permalink/', '/course/', '/lecture/']
    if (contentSegments.some((seg) => path.includes(seg))) return true

    // 3. Path contains a numeric ID segment (e.g., /123/ or ends with /123)
    if (/\/\d+(\/|$)/.test(path)) return true

    return false
  } catch {
    return false
  }
}

export function intentFromPlatform(platform: KnownPlatform | undefined, url?: string): PageIntent | undefined {
  if (!platform) return undefined
  const base = PLATFORM_TO_INTENT[platform]

  // Heuristic: for content-heavy platforms, lists/feeds are not 'article'
  if (url && (platform === 'social' || platform === 'qa' || platform === 'blog' || platform === 'education')) {
    if (!looksLikeSpecificItem(url)) return 'other'
  }

  return base
}
