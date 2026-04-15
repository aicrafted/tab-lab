import { DOMAIN_PREFILL, PREFILL_CANDIDATES_SORTED } from './domain-prefill'
import type { KnownPlatform, PageIntent } from './types'
import type { DomainInfo } from './domain-enricher'

export const PLATFORM_TO_INTENT: Partial<Record<KnownPlatform, PageIntent>> = {
  social: 'social',
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

export function intentFromPlatform(platform: KnownPlatform | undefined): PageIntent | undefined {
  if (!platform) return undefined
  return PLATFORM_TO_INTENT[platform]
}
