import type { KnownPlatform } from '../core/types'
import { getDomainsOverrides, getDomainsRemote } from '../core/storage'
import {
  DOMAINS_OVERRIDES_KEY,
  DOMAINS_REMOTE_KEY,
} from '../core/storage-keys'

export interface PrefilledDomain {
  category: string
  description: string
  platform: KnownPlatform
  source?: 'bundled' | 'remote' | 'custom'
}

/**
 * Merged domains catalog.
 * Resolution priority: Custom Overrides > Remote Sync > Bundled Fallback.
 */
export let DOMAIN_PREFILL: Record<string, PrefilledDomain> = {}

/**
 * Sorted candidate list (longest first) for subdomain matching.
 */
export let PREFILL_CANDIDATES_SORTED: string[] = []

// Tiered storage
let BUNDLED_KB: Record<string, PrefilledDomain> = {}
let REMOTE_KB: Record<string, PrefilledDomain> = {}
let USER_OVERRIDES: Record<string, PrefilledDomain> = {}

/**
 * Rebuilds the combined DOMAIN_PREFILL from tiers.
 */
function rebuildPrefill() {
  const merged: Record<string, PrefilledDomain> = {}
  
  // 1. Bundled
  for (const [d, v] of Object.entries(BUNDLED_KB)) {
    merged[d] = { ...v, source: 'bundled' }
  }
  
  // 2. Remote (overwrites bundled)
  for (const [d, v] of Object.entries(REMOTE_KB)) {
    merged[d] = { ...v, source: 'remote' }
  }
  
  // 3. User (overwrites remote/bundled)
  for (const [d, v] of Object.entries(USER_OVERRIDES)) {
    merged[d] = { ...v, source: 'custom' }
  }
  
  DOMAIN_PREFILL = merged
  PREFILL_CANDIDATES_SORTED = Object.keys(merged).sort((a, b) => b.length - a.length)
}

/**
 * Initializes domain prefill data from all sources.
 */
export async function initDomainData(): Promise<void> {
  try {
    // Load Bundled
    const url = chrome.runtime.getURL('data/domains.json')
    const response = await fetch(url)
    if (response.ok) {
      BUNDLED_KB = await response.json()
    }

    // Load dynamic tiers
    REMOTE_KB = await getDomainsRemote()
    USER_OVERRIDES = await getDomainsOverrides()

    rebuildPrefill()
  } catch (err) {
    console.error('Failed to initialize domain data:', err)
  }
}

/**
 * Listen for storage changes to keep prefill in sync across contexts.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  
  let changed = false
  if (changes[DOMAINS_REMOTE_KEY]) {
    REMOTE_KB = (changes[DOMAINS_REMOTE_KEY].newValue || {}) as Record<string, PrefilledDomain>
    changed = true
  }
  if (changes[DOMAINS_OVERRIDES_KEY]) {
    USER_OVERRIDES = (changes[DOMAINS_OVERRIDES_KEY].newValue || {}) as Record<string, PrefilledDomain>
    changed = true
  }

  if (changed) rebuildPrefill()
})

/**
 * Fetches domains catalog from a remote URL and updates the cache.
 */
export async function syncRemoteDomains(url: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`)
  
  const data = await response.json()
  // Basic validation: ensure it's a record of PrefilledDomain
  if (typeof data !== 'object' || data === null) throw new Error('Invalid JSON format')
  
  const { setDomainsRemote, setLlmSettings, getLlmSettings } = await import('../core/storage')
  await setDomainsRemote(data)
  
  // Update last sync time
  const settings = await getLlmSettings()
  await setLlmSettings({
    ...settings,
    domains: {
      ...settings.domains,
      lastSyncAt: Date.now(),
    },
  })
}

/**
 * Saves or updates a custom override for a domain.
 */
export async function saveDomainOverride(domain: string, patch: Partial<PrefilledDomain>): Promise<void> {
  const { getDomainsOverrides, setDomainsOverrides } = await import('../core/storage')
  const overrides = await getDomainsOverrides()
  
  const existing = overrides[domain] || { category: '', description: '', platform: 'tool' as any }
  overrides[domain] = {
    ...existing,
    ...patch,
  }
  
  await setDomainsOverrides(overrides)
}

/**
 * Removes a custom override, falling back to lower tiers.
 */
export async function deleteDomainOverride(domain: string): Promise<void> {
  const { getDomainsOverrides, setDomainsOverrides } = await import('../core/storage')
  const overrides = await getDomainsOverrides()
  delete overrides[domain]
  await setDomainsOverrides(overrides)
}

/**
 * Checks if a domain is present in the prefilled domains catalog.
 */
export function getPrefilledDomain(domain: string): PrefilledDomain | undefined {
  return DOMAIN_PREFILL[domain]
}
