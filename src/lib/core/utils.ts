import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import * as punycode from 'punycode/'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatAge(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  const hours   = Math.floor(diff / 3_600_000)
  const days    = Math.floor(diff / 86_400_000)

  if (minutes < 2)   return 'just now'
  if (minutes < 60)  return `${minutes}m ago`
  if (hours < 24)    return `${hours}h ago`
  if (days < 30)     return `${days}d ago`
  if (days < 365)    return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Extracts a human-readable domain from a URL.
 *
 * Problems with naïve `new URL(url).hostname`:
 * - Converts unicode hosts to punycode: https://водяной.укр/ → xn--e1afmapc.xn--j1amh
 *
 * This function:
 * 1. Uses a regex to pull the raw host string (preserves unicode characters)
 * 2. Strips port, www., and user-info
 * 3. Decodes any residual xn-- punycode labels
 */
export function parseDomain(rawUrl: string): string {
  try {
    // Regex captures the host portion of any URL, including IPv6 literals [::1]
    // Skips scheme, optional user:pass@, and stops before port/path/query/hash
    const m = rawUrl.match(/^[a-z][a-z\d+\-.]*:\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^/:?#\s]+)/i)
    const rawHost = m ? m[1] : new URL(rawUrl).hostname

    // Strip port then www.
    const host = rawHost.replace(/:\d+$/, '').replace(/^www\./i, '')

    // Decode punycode labels that survived (or were already xn-- in the stored URL)
    if (!host.includes('xn--')) return host
    return punycode.toUnicode(host)
  } catch {
    return ''
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMerge<T extends object>(base: T, patch: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>
  const patchObj = patch as Record<string, unknown>

  for (const key of Object.keys(patchObj)) {
    const pVal = patchObj[key]
    if (pVal === undefined) continue

    const baseVal = result[key]
    if (isPlainObject(baseVal) && isPlainObject(pVal)) {
      result[key] = deepMerge(baseVal, pVal)
      continue
    }

    result[key] = pVal
  }

  return result as T
}
