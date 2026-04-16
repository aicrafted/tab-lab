function normalizeHost(hostname: string): string {
  const host = hostname.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1)
  return host
}

function parseIPv4(host: string): number | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    value = (value << 8) | octet
  }
  return value >>> 0
}

function parseIPv6(host: string): bigint | null {
  const input = host.split('%')[0].toLowerCase()
  if (!input) return null

  let work = input
  if (work.includes('.')) {
    const lastColon = work.lastIndexOf(':')
    if (lastColon === -1) return null
    const ipv4 = parseIPv4(work.slice(lastColon + 1))
    if (ipv4 == null) return null
    const high = ((ipv4 >>> 16) & 0xffff).toString(16)
    const low = (ipv4 & 0xffff).toString(16)
    work = `${work.slice(0, lastColon)}:${high}:${low}`
  }

  const chunks = work.split('::')
  if (chunks.length > 2) return null

  const parseHextets = (part: string): number[] | null => {
    if (!part) return []
    const hextets = part.split(':')
    const out: number[] = []
    for (const hextet of hextets) {
      if (!/^[0-9a-f]{1,4}$/.test(hextet)) return null
      out.push(Number.parseInt(hextet, 16))
    }
    return out
  }

  const left = parseHextets(chunks[0] ?? '')
  const right = parseHextets(chunks[1] ?? '')
  if (!left || !right) return null

  const missing = chunks.length === 2 ? 8 - (left.length + right.length) : 0
  if (missing < 0) return null
  if (chunks.length === 1 && left.length !== 8) return null

  const hextets = chunks.length === 2
    ? [...left, ...Array.from({ length: missing }, () => 0), ...right]
    : left
  if (hextets.length !== 8) return null

  let value = 0n
  for (const hextet of hextets) {
    value = (value << 16n) | BigInt(hextet)
  }
  return value
}

function hostIpVersion(host: string): 4 | 6 | 0 {
  if (parseIPv4(host) != null) return 4
  if (parseIPv6(host) != null) return 6
  return 0
}

function inCidr(host: string, cidr: string): boolean {
  const [baseRaw, prefixRaw] = cidr.split('/')
  const base = normalizeHost(baseRaw ?? '')
  const prefix = Number(prefixRaw)
  if (!Number.isInteger(prefix)) return false

  const hostV = hostIpVersion(host)
  const baseV = hostIpVersion(base)
  if (hostV === 0 || baseV === 0 || hostV !== baseV) return false

  if (hostV === 4) {
    if (prefix < 0 || prefix > 32) return false
    const hostNum = parseIPv4(host)
    const baseNum = parseIPv4(base)
    if (hostNum == null || baseNum == null) return false
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return (hostNum & mask) === (baseNum & mask)
  }

  if (prefix < 0 || prefix > 128) return false
  const hostNum = parseIPv6(host)
  const baseNum = parseIPv6(base)
  if (hostNum == null || baseNum == null) return false
  const fullMask = (1n << 128n) - 1n
  const mask = prefix === 0 ? 0n : (fullMask << (128n - BigInt(prefix))) & fullMask
  return (hostNum & mask) === (baseNum & mask)
}

function matchesGlob(host: string, pattern: string): boolean {
  if (!pattern.startsWith('*.')) return false
  const suffix = pattern.slice(2)
  if (!suffix || suffix.includes('*')) return false
  if (!host.endsWith(`.${suffix}`)) return false
  const hostLabels = host.split('.')
  const suffixLabels = suffix.split('.')
  return hostLabels.length === suffixLabels.length + 1
}

function matchesPattern(host: string, patternRaw: string): boolean {
  const pattern = normalizeHost(patternRaw)
  if (!pattern) return false
  if (pattern.includes('/')) return inCidr(host, pattern)
  if (pattern.startsWith('*.')) return matchesGlob(host, pattern)
  return host === pattern
}

export function isLocalHost(hostname: string, patterns: string[]): boolean {
  const normalized = normalizeHost(hostname)
  if (!normalized) return false
  for (const pattern of patterns) {
    if (matchesPattern(normalized, pattern)) return true
  }
  return false
}

export function isLocalUrl(url: string, patterns: string[]): boolean {
  try {
    const { hostname } = new URL(url)
    return isLocalHost(hostname, patterns)
  } catch {
    return false
  }
}
