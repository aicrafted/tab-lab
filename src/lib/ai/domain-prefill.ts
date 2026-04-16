import type { KnownPlatform } from '../core/types'

export interface PrefilledDomain {
  category: string
  description: string
  platform: KnownPlatform
}

/**
 * Static knowledge base for popular domains (Layer 0).
 * Provides instant enrichment metadata without LLM or DB lookups.
 * Populated asynchronously during initDomainData().
 */
export let DOMAIN_PREFILL: Record<string, PrefilledDomain> = {}

/**
 * Sorted candidate list (longest first) to ensure specific subdomain matches
 * take precedence over generic parent domain matches.
 */
export let PREFILL_CANDIDATES_SORTED: string[] = []

/**
 * Initializes the domain knowledge base from the bundled JSON file.
 * In the future, this can be extended to check for updates in chrome.storage.
 */
export async function initDomainData(): Promise<void> {
  if (Object.keys(DOMAIN_PREFILL).length > 0) return

  try {
    const url = chrome.runtime.getURL('data/domains.json')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch domains: ${response.statusText}`)
    
    DOMAIN_PREFILL = await response.json()
    PREFILL_CANDIDATES_SORTED = Object.keys(DOMAIN_PREFILL).sort((a, b) => b.length - a.length)
  } catch (err) {
    console.error('Failed to initialize domain data:', err)
    // Fallback or empty state
    DOMAIN_PREFILL = {}
    PREFILL_CANDIDATES_SORTED = []
  }
}

/**
 * Checks if a domain is present in the prefilled knowledge base.
 * @param domain Normalized domain name
 */
export function getPrefilledDomain(domain: string): PrefilledDomain | undefined {
  return DOMAIN_PREFILL[domain]
}
