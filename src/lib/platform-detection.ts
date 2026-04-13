import type { KnownPlatform, PageIntent } from './types'

const DOMAIN_MAP: Record<string, KnownPlatform> = {
  'reddit.com': 'social',
  'twitter.com': 'social',
  'x.com': 'social',
  'news.ycombinator.com': 'social',
  'mastodon.social': 'social',
  'bsky.app': 'social',
  'discord.com': 'social',
  'slack.com': 'social',
  'youtube.com': 'video',
  'youtu.be': 'video',
  'vimeo.com': 'video',
  'twitch.tv': 'video',
  'dailymotion.com': 'video',
  'rumble.com': 'video',
  'github.com': 'code',
  'gitlab.com': 'code',
  'bitbucket.org': 'code',
  'codeberg.org': 'code',
  'npmjs.com': 'registry',
  'crates.io': 'registry',
  'pypi.org': 'registry',
  'packagist.org': 'registry',
  'rubygems.org': 'registry',
  'hub.docker.com': 'registry',
  'stackoverflow.com': 'qa',
  'stackexchange.com': 'qa',
  'medium.com': 'blog',
  'substack.com': 'blog',
  'dev.to': 'blog',
  'hashnode.com': 'blog',
  'ghost.io': 'blog',
  'readthedocs.io': 'docs',
  'gitbook.io': 'docs',
  'amazon.com': 'shopping',
  'ebay.com': 'shopping',
  'etsy.com': 'shopping',
  'aliexpress.com': 'shopping',
  'lobste.rs': 'news',
  'techcrunch.com': 'news',
  'wired.com': 'news',
  'arstechnica.com': 'news',
  'openai.com': 'ai',
  'anthropic.com': 'ai',
  'huggingface.co': 'ai',
  'replicate.com': 'ai',
  'perplexity.ai': 'ai',
}

export const PLATFORM_TO_INTENT: Partial<Record<KnownPlatform, PageIntent>> = {
  social: 'social',
  video: 'video',
  code: 'repository',
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

export function detectPlatform(domain: string): KnownPlatform | undefined {
  const normalized = normalizeDomain(domain)
  if (!normalized) return undefined

  for (const [candidate, platform] of Object.entries(DOMAIN_MAP)) {
    if (matchesDomain(normalized, candidate)) return platform
  }

  if (normalized.startsWith('docs.')) return 'docs'
  return undefined
}

export function detectPlatformFromUrl(url: string): KnownPlatform | undefined {
  try {
    const parsed = new URL(url)
    return detectPlatform(parsed.hostname)
  } catch {
    return undefined
  }
}

export function intentFromPlatform(platform: KnownPlatform | undefined): PageIntent | undefined {
  if (!platform) return undefined
  return PLATFORM_TO_INTENT[platform]
}
