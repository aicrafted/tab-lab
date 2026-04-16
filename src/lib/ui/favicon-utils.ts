export function scoreFaviconCandidate(iconUrl: string, domain: string): number {
  try {
    const parsed = new URL(iconUrl)
    const host = parsed.hostname.toLowerCase()
    const target = domain.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const query = parsed.search.toLowerCase()

    let score = 0

    if (host === target) score += 40
    else if (host.endsWith(`.${target}`)) score += 25

    if (path === '/favicon.ico') score += 140
    else if (path === '/favicon.png') score += 120
    else if (path === '/favicon.svg') score += 110
    else if (path.includes('favicon')) score += 90
    else if (path.includes('apple-touch-icon')) score += 80

    if (path.endsWith('.ico')) score += 45
    else if (path.endsWith('.png')) score += 30
    else if (path.endsWith('.webp')) score += 20
    else if (path.endsWith('.svg')) score += 10

    const noisyKeywords = ['copilot', 'avatar', 'profile', 'badge', 'emoji', 'user', 'team', 'topic']
    if (noisyKeywords.some((kw) => path.includes(kw) || query.includes(kw))) {
      score -= 120
    }

    score -= Math.min(path.length, 140) / 4
    score -= Math.min(parsed.search.length, 80) / 6
    return score
  } catch {
    return Number.NEGATIVE_INFINITY
  }
}
