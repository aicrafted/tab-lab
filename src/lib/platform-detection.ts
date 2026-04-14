import type { KnownPlatform, PageIntent } from './types'
import type { DomainInfo } from './domain-enricher'

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
  'figma.com': 'tool',
  'notion.so': 'tool',
  'linear.app': 'tool',
  'miro.com': 'tool',
  'canva.com': 'tool',
  'airtable.com': 'tool',
  'jira.com': 'tool',
  'confluence.com': 'tool',
  'codepen.io': 'sandbox',
  'codesandbox.io': 'sandbox',
  'replit.com': 'sandbox',
  'stackblitz.com': 'sandbox',
  'jsfiddle.net': 'sandbox',
  'glitch.me': 'sandbox',
  'glitch.com': 'sandbox',
  'gitpod.io': 'sandbox',
  'console.aws.amazon.com': 'cloud',
  'console.cloud.google.com': 'cloud',
  'portal.azure.com': 'cloud',
  'vercel.com': 'cloud',
  'netlify.com': 'cloud',
  'cloudflare.com': 'cloud',
  'digitalocean.com': 'cloud',
  'fly.io': 'cloud',
  'render.com': 'cloud',
  'railway.app': 'cloud',
  'sentry.io': 'ci',
  'datadog.com': 'ci',
  'grafana.com': 'ci',
  'app.circleci.com': 'ci',
  'travis-ci.com': 'ci',
  'newrelic.com': 'ci',
  'pagerduty.com': 'ci',
  'spotify.com': 'music',
  'soundcloud.com': 'music',
  'bandcamp.com': 'music',
  'music.apple.com': 'music',
  'deezer.com': 'music',
  'tidal.com': 'music',
  'binance.com': 'finance',
  'coinbase.com': 'finance',
  'finance.yahoo.com': 'finance',
  'bloomberg.com': 'finance',
  'tradingview.com': 'finance',
  'robinhood.com': 'finance',
  'store.steampowered.com': 'games',
  'epicgames.com': 'games',
  'itch.io': 'games',
  'gog.com': 'games',
  'coursera.org': 'education',
  'udemy.com': 'education',
  'khanacademy.org': 'education',
  'edx.org': 'education',
  'pluralsight.com': 'education',
  'udacity.com': 'education',
  'mail.google.com': 'email',
  'outlook.live.com': 'email',
  'proton.me': 'email',
  'protonmail.com': 'email',
  'fastmail.com': 'email',
  'wikipedia.org': 'reference',
  'wikimedia.org': 'reference',
  'arxiv.org': 'reference',
  'scholar.google.com': 'reference',
  'semanticscholar.org': 'reference',
  'wolframalpha.com': 'reference',
  'developer.mozilla.org': 'reference',
}

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

  for (const [candidate, platform] of Object.entries(DOMAIN_MAP)) {
    if (matchesDomain(normalized, candidate)) return platform
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
