import domainData from './domains.json'
import type { KnownPlatform } from './types'

export interface PrefilledDomain {
  category: string
  description: string
  platform: KnownPlatform
}

/**
 * Static knowledge base for popular domains (Layer 0).
 * Provides instant enrichment metadata without LLM or DB lookups.
 */
export const DOMAIN_PREFILL: Record<string, PrefilledDomain> = domainData as Record<string, PrefilledDomain>

/**
 * Sorted candidate list (longest first) to ensure specific subdomain matches
 * take precedence over generic parent domain matches.
 */
export const PREFILL_CANDIDATES_SORTED = Object.keys(DOMAIN_PREFILL).sort((a, b) => b.length - a.length)

/**
 * Checks if a domain is present in the prefilled knowledge base.
 * @param domain Normalized domain name
 */
export function getPrefilledDomain(domain: string): PrefilledDomain | undefined {
  return DOMAIN_PREFILL[domain]
}
