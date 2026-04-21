import { describe, expect, it } from 'vitest'
import { isNonEnrichableDomain } from '../local-network'

describe('isNonEnrichableDomain', () => {
  it('returns true for IPv4 addresses', () => {
    expect(isNonEnrichableDomain('192.168.1.1')).toBe(true)
    expect(isNonEnrichableDomain('8.8.8.8')).toBe(true)
    expect(isNonEnrichableDomain('0.0.0.0')).toBe(true)
    expect(isNonEnrichableDomain('255.255.255.255')).toBe(true)
  })

  it('returns true for IPv6 addresses', () => {
    expect(isNonEnrichableDomain('::1')).toBe(true)
    expect(isNonEnrichableDomain('2001:db8::1')).toBe(true)
    expect(isNonEnrichableDomain('fe80::1')).toBe(true)
  })

  it('returns true for single-label hostnames', () => {
    expect(isNonEnrichableDomain('localhost-alias')).toBe(true)
    expect(isNonEnrichableDomain('printer')).toBe(true)
    expect(isNonEnrichableDomain('myserver')).toBe(true)
  })

  it('returns true for reserved tlds', () => {
    expect(isNonEnrichableDomain('box.local')).toBe(true)
    expect(isNonEnrichableDomain('server.internal')).toBe(true)
    expect(isNonEnrichableDomain('app.lan')).toBe(true)
    expect(isNonEnrichableDomain('site.test')).toBe(true)
  })

  it('returns false for public domains', () => {
    expect(isNonEnrichableDomain('github.com')).toBe(false)
    expect(isNonEnrichableDomain('docs.github.com')).toBe(false)
    expect(isNonEnrichableDomain('google.co.uk')).toBe(false)
    expect(isNonEnrichableDomain('arxiv.org')).toBe(false)
  })
})
