import { extractJson } from './llm'
import type { DomainInfo } from './domain-enricher'
import { KNOWN_PLATFORMS, PAGE_INTENTS, type PageIntent } from './types'

const VALID_INTENTS: readonly PageIntent[] = PAGE_INTENTS

const VALID_PLATFORMS = new Set<string>(KNOWN_PLATFORMS)
const KNOWN_PLATFORMS_TEXT = KNOWN_PLATFORMS.join(', ')

type KnownPlatform = DomainInfo['platform']

const CLASSIFY_ITEM_SYSTEM_TEXT = `You are a tab categorizer. For each browser tab title, domain, and URL path you receive, reply with ONE short category label (2-4 words, Title Case) that best describes the content. Avoid using "Other" unless the page is truly ambiguous. Reply with the category label only — no explanation, no punctuation.`
const CLASSIFY_ITEM_SYSTEM_JSON = `You are a tab categorizer. For each browser tab title, domain, and URL path, output a JSON object with a single "category" key. Value must be a short category label (2-4 words, Title Case) that best describes the content.
Avoid using "Other" unless the page is truly ambiguous.

Example output: {"category": "Development"}`

const CLASSIFY_CLUSTER_SYSTEM = `You classify clusters of browser pages.
Given 2-3 representative pages from one cluster, return strict JSON:
{"category":"<broad category>","name":"<specific short cluster name>"}

Rules:
- category should be a broad, human-friendly label (2-4 words, Title Case) that best describes the cluster
- name must be short (2-5 words), specific, and not generic
- prefer concrete names like "Rust async runtime" over generic "Development"
- avoid using "Other" unless the samples are truly ambiguous
- output JSON only`

const NORMALIZE_CATEGORIES_SYSTEM = 'You output strict JSON only.'
const NORMALIZE_CATEGORIES_USER_PREFIX = `You are a category deduplicator. I will give you a list of category labels from browser tabs. Your job is to aggressively merge semantically similar or overlapping labels into a single canonical name. Be generous with merges — if two labels describe roughly the same topic, merge them.

Rules:
- Merge synonyms, near-duplicates, and subsets (e.g. "Tech" → "Technology", "Software Development" → "Development")
- Prefer short, widely understood names
- Keep distinct only if they describe genuinely different topics
- Reply ONLY with a JSON object mapping each input label to its canonical name. All input labels must appear as keys.

Labels:`
const NORMALIZE_CATEGORIES_USER_SUFFIX = 'Reply with JSON only, no explanation.'

const GROUP_RARE_CATEGORIES_SYSTEM = 'You output strict JSON only.'
const GROUP_RARE_CATEGORIES_USER_PREFIX = `You are consolidating browser tab categories. Map each RARE category to its best target.

All categories (rare = 1-2 tabs, others are stable):`
const GROUP_RARE_CATEGORIES_USER_MIDDLE = `Rare categories to reassign:`
const GROUP_RARE_CATEGORIES_USER_SUFFIX = `Rules:
- Map each rare category to a frequent category if semantically fitting
- If two rare categories describe the same topic, map both to one shared label
- Prefer existing category names over inventing new ones
- Avoid vague labels like "Other", "Miscellaneous", "General"
- Reply ONLY with a JSON object: rare category → target category name

Example: {"Steam Games": "Gaming", "Software Deployment": "Software Development"}`

const TAG_ITEM_SYSTEM_TEXT = `You are a web page tagger. For each browser tab title, domain, and URL path, reply with exactly 3-5 lowercase tags separated by commas. Tags must be concise (1-2 words), specific, and useful for filtering a personal collection. Avoid generic tags like "website" or "internet". Reply with tags only — no explanation, no extra punctuation.`
const TAG_ITEM_SYSTEM_JSON = `You are a web page tagger. Output a JSON object with a "tags" key containing an array of 3-5 lowercase tags. Tags must be concise (1-2 words), specific, and useful for filtering a personal collection. Avoid generic tags like "website" or "internet".

Example output: {"tags": ["rust", "async", "performance"]}`

const CLASSIFY_INTENT_SYSTEM_TEXT = `You classify web pages by their intent — how the user is meant to use them.

Choose ONE label from:
- article       : blog post, tutorial, news article, essay, Reddit thread, forum discussion — meant to be read linearly
- reference     : documentation, API reference, man page, cheatsheet, specification — consulted repeatedly
- tool          : web app, dashboard, SaaS product, online editor, IDE — used interactively
- service       : product landing page, signup/login page, account settings, pricing — functional but not a tool
- transactional : order confirmation, booking, ticket, tracking page, invoice, support ticket — time-sensitive, discard after done
- video         : YouTube, Vimeo, Twitch, podcast page — primary content is video/audio
- repository    : GitHub/GitLab repo, npm/crates.io/PyPI package page
- other         : anything that doesn't fit clearly

Reply with the single label only. No explanation.`
const CLASSIFY_INTENT_SYSTEM_JSON = `You classify web pages by their intent. Output a JSON object with a single "intent" key.

Valid values: "article", "reference", "tool", "service", "transactional", "video", "repository", "other"

- article: blog post, tutorial, news, Reddit/forum discussion - read linearly
- reference: docs, API, cheatsheet - consulted repeatedly
- tool: web app, SaaS, dashboard - used interactively
- service: product page, signup, settings - functional
- transactional: order, booking, tracking - time-sensitive
- video: YouTube, Vimeo, Twitch - primary content is video
- repository: GitHub, npm, crates.io - code asset
- other: anything else

Example output: {"intent": "reference"}`

const ENRICH_DOMAIN_SYSTEM = `You are a web domain classifier with broad knowledge of websites worldwide.
Classify every domain you can identify — including well-known companies, brands, media, shops, tools, and services in any country.
Only skip domains that are clearly private/internal: IP addresses, localhost, random subdomains of unknown services, corporate intranets.
When in doubt whether you know a domain, include it rather than skipping it.
Always respond with valid JSON only.`
const ENRICH_DOMAIN_USER_PREFIX = `Classify these domains. For each domain you can identify, output a JSON object with:
- "domain": exact domain string from the input (required, copy exactly with full TLD/subdomain; do not shorten or rewrite)
- "category": short label (1-4 words, Title Case) describing the site's main purpose (required)
- "description": 3-7 words describing what the site is (required)
- "platform": one of [${KNOWN_PLATFORMS_TEXT}] — pick the best match; omit only if none fits

Skip only: IP addresses, localhost, clearly private/internal hostnames.
Include everything else you know — companies, brands, shops, media, tools from any country.
If you are not sure about exact domain spelling, skip that domain.

Examples:
[
  {"domain":"github.com","category":"Development","description":"code hosting and version control","platform":"code"},
  {"domain":"figma.com","category":"Design","description":"collaborative interface design tool","platform":"tool"},
  {"domain":"intel.com","category":"Hardware","description":"semiconductor and processor manufacturer"},
  {"domain":"jsfiddle.net","category":"Development","description":"browser-based JavaScript playground","platform":"sandbox"},
  {"domain":"rozetka.com.ua","category":"Marketplace","description":"largest online shop in Ukraine","platform":"shopping"},
  {"domain":"arxiv.org","category":"Research","description":"preprint repository for science papers","platform":"reference"}
]

Domains:`

function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) return ''
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return ''
}

function normalizeCategoryLabel(raw: string, fallback = 'Other'): string {
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\|[^|>]*\|>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[{}[\]`"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return fallback
  const firstPhrase = text.split(/[;|]/)[0]?.trim() || text
  const candidate = firstPhrase.slice(0, 40).trim()
  if (!candidate) return fallback
  if (/^(analysis|final|assistant|user|system|channel)$/i.test(candidate)) return fallback
  if (/^-?\d+(\.\d+)?$/.test(candidate)) return fallback
  return candidate
}

function isInvalidCategoryLabel(label: string): boolean {
  const text = label.trim()
  if (!text) return true
  if (/<\|[^|>]*\|>/.test(text)) return true
  if (/^(analysis|final|assistant|user|system|channel)$/i.test(text)) return true
  if (/^-?\d+(\.\d+)?$/.test(text)) return true
  return false
}

function parseCategoryJson(raw: string): { category: string; strict: boolean } {
  try {
    const jsonStr = extractJsonObject(raw) || extractJson(raw)
    const parsed = JSON.parse(jsonStr) as { category?: unknown }
    if (typeof parsed.category === 'string' && parsed.category.trim()) {
      return { category: normalizeCategoryLabel(parsed.category), strict: true }
    }
  } catch {
    // Intentionally fallback to text parsing.
  }
  return { category: 'Other', strict: false }
}

function normalizeTagToken(token: string): string {
  return token.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '')
}

function parseTagsText(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map(normalizeTagToken)
    .filter((token) => token.length > 1 && token.length < 30)
    .slice(0, 5)
}

function parseTagsJson(raw: string): { tags: string[]; strict: boolean } {
  try {
    const parsed = JSON.parse(extractJson(raw)) as { tags?: unknown }
    if (Array.isArray(parsed.tags)) {
      const tags = (parsed.tags as unknown[])
        .filter((tag): tag is string => typeof tag === 'string')
        .map(normalizeTagToken)
        .filter((tag) => tag.length > 1 && tag.length < 30)
        .slice(0, 5)
      return { tags, strict: true }
    }
  } catch {
    // Intentionally fallback to text parsing.
  }
  return { tags: parseTagsText(raw), strict: false }
}

function parseIntentText(raw: string): PageIntent {
  const normalized = raw.trim().toLowerCase()
  return VALID_INTENTS.find((intent) => normalized.includes(intent)) ?? 'other'
}

function parseIntentJson(raw: string): { intent: PageIntent; strict: boolean } {
  try {
    const parsed = JSON.parse(extractJson(raw)) as { intent?: unknown }
    if (typeof parsed.intent === 'string') {
      const value = VALID_INTENTS.find((intent) => intent === parsed.intent) ?? 'other'
      return { intent: value, strict: true }
    }
  } catch {
    // Intentionally fallback to text parsing.
  }
  return { intent: parseIntentText(raw), strict: false }
}

function normalizeDescription(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (!compact) return ''
  const words = compact.split(' ')
  return words.slice(0, 7).join(' ').slice(0, 120)
}

function normalizePlatform(value: unknown): KnownPlatform | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return VALID_PLATFORMS.has(normalized) ? normalized as KnownPlatform : undefined
}

function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Try repair pass below.
  }

  const repaired = text
    .replace(/\uFEFF/g, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)'([^'\\]+)'\s*:/g, '$1"$2":')
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value: string) => {
      const safe = value.replace(/"/g, '\\"')
      return `: "${safe}"`
    })
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\- ]*)\s*:/g, (_m, prefix: string, key: string) => {
      const safeKey = key.trim().replace(/"/g, '\\"')
      return `${prefix}"${safeKey}":`
    })

  return JSON.parse(repaired)
}

function parseDomainResponseHeuristic(raw: string, sentDomains: Set<string>, fetchedAt: number): DomainInfo[] {
  const results: DomainInfo[] = []
  const seen = new Set<string>()
  const objectLikeChunks = raw.match(/\{[\s\S]*?\}/g) ?? []

  for (const chunk of objectLikeChunks) {
    const domainMatch = chunk.match(/["']?domain["']?\s*:\s*["']([^"'\s,}]+)["']/i)
      ?? chunk.match(/\bdomain\s*=\s*([^\s,}]+)/i)
    if (!domainMatch) continue

    const domain = domainMatch[1]?.trim().toLowerCase()
    if (!domain || !sentDomains.has(domain) || seen.has(domain)) continue

    const categoryMatch = chunk.match(/["']?category["']?\s*:\s*["']([^"'}]+)["']/i)
    const descriptionMatch = chunk.match(/["']?description["']?\s*:\s*["']([^"'}]+)["']/i)
    const platformMatch = chunk.match(/["']?platform["']?\s*:\s*["']([^"'}]+)["']/i)
    if (!descriptionMatch) continue

    const description = normalizeDescription(descriptionMatch[1] ?? '')
    if (!description) continue
    const category = typeof categoryMatch?.[1] === 'string'
      ? categoryMatch[1].trim().slice(0, 40) || undefined
      : undefined
    const platform = normalizePlatform(platformMatch?.[1])

    results.push({
      domain,
      known: true,
      category,
      description,
      platform,
      fetchedAt,
    })
    seen.add(domain)
  }

  return results
}

export const classifyItem = {
  system(format: 'text' | 'json'): string {
    return format === 'json' ? CLASSIFY_ITEM_SYSTEM_JSON : CLASSIFY_ITEM_SYSTEM_TEXT
  },

  user(params: {
    title: string
    domain: string
    path?: string
    siteLine?: string
    parentCategory?: string
  }): string {
    const { title, domain, path, siteLine, parentCategory } = params
    const lines = [`Title: ${title}`, `Domain: ${domain}`]
    if (siteLine) lines.push(siteLine.trimStart())
    if (path) lines.push(`Path: ${path}`)
    if (parentCategory) {
      lines.push(`Parent: ${parentCategory}`)
      lines.push('Assign a more specific sub-category.')
    }
    return lines.join('\n')
  },

  parseResponse(raw: string, fallback = 'Other'): string {
    const json = parseCategoryJson(raw)
    if (json.strict && json.category !== 'Other') return json.category
    return normalizeCategoryLabel(raw, fallback)
  },

  parseResponseDetailed(raw: string, fallback = 'Other'): { category: string; strict: boolean } {
    const json = parseCategoryJson(raw)
    if (json.strict && json.category !== 'Other') return json
    return { category: normalizeCategoryLabel(raw, fallback), strict: false }
  },

  isInvalidResponse(label: string): boolean {
    return isInvalidCategoryLabel(label)
  },
}

export const classifyCluster = {
  system(): string {
    return CLASSIFY_CLUSTER_SYSTEM
  },

  user(samples: string[]): string {
    return samples.join('\n---\n')
  },

  parseResponse(raw: string): { category: string; name: string } {
    try {
      const jsonStr = extractJsonObject(raw) || extractJson(raw)
      if (!jsonStr) throw new Error('no JSON object found')
      const parsed = JSON.parse(jsonStr) as { category?: unknown; name?: unknown }
      const category = typeof parsed.category === 'string' && parsed.category.trim()
        ? normalizeCategoryLabel(parsed.category)
        : 'Other'
      const name = typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim().slice(0, 60)
        : category
      return { category, name }
    } catch {
      return { category: 'Other', name: 'Other' }
    }
  },
}

export const normalizeCategories = {
  system(): string {
    return NORMALIZE_CATEGORIES_SYSTEM
  },

  user(labels: string[]): string {
    return `${NORMALIZE_CATEGORIES_USER_PREFIX}
${labels.map((label) => `- ${label}`).join('\n')}

${NORMALIZE_CATEGORIES_USER_SUFFIX}`
  },

  parseResponse(raw: string, inputLabels: string[]): Record<string, string> {
    try {
      const parsed = JSON.parse(extractJson(raw)) as Record<string, string>
      for (const label of inputLabels) {
        if (!(label in parsed)) parsed[label] = label
      }
      return parsed
    } catch {
      return Object.fromEntries(inputLabels.map((label) => [label, label]))
    }
  },
}

export const groupRareCategories = {
  system(): string {
    return GROUP_RARE_CATEGORIES_SYSTEM
  },

  user(params: {
    frequent: { label: string; count: number }[]
    rare: { label: string; count: number }[]
  }): string {
    const allCategories = [
      ...params.frequent.map((c) => `${c.label} (${c.count} tabs)`),
      ...params.rare.map((c) => `${c.label} (${c.count} tab${c.count > 1 ? 's' : ''})`),
    ]
    const rare = params.rare.map((c) => c.label)
    return `${GROUP_RARE_CATEGORIES_USER_PREFIX}
${allCategories.map((c) => `- ${c}`).join('\n')}

${GROUP_RARE_CATEGORIES_USER_MIDDLE}
${rare.map((c) => `- ${c}`).join('\n')}

${GROUP_RARE_CATEGORIES_USER_SUFFIX}`
  },

  parseResponse(raw: string): Record<string, string> {
    return JSON.parse(extractJson(raw)) as Record<string, string>
  },
}

export const tagItem = {
  system(format: 'text' | 'json'): string {
    return format === 'json' ? TAG_ITEM_SYSTEM_JSON : TAG_ITEM_SYSTEM_TEXT
  },

  user(params: { title: string; domain: string; path?: string; siteLine?: string }): string {
    const lines = [`Title: ${params.title}`, `Domain: ${params.domain}`]
    if (params.siteLine) lines.push(params.siteLine.trimStart())
    if (params.path) lines.push(`Path: ${params.path}`)
    return lines.join('\n')
  },

  parseResponse(raw: string, format: 'text' | 'json'): string[] {
    if (format === 'json') return parseTagsJson(raw).tags
    return parseTagsText(raw)
  },

  parseResponseDetailed(raw: string, format: 'text' | 'json'): { tags: string[]; strict: boolean } {
    if (format === 'json') return parseTagsJson(raw)
    return { tags: parseTagsText(raw), strict: false }
  },
}

export const classifyIntent = {
  system(format: 'text' | 'json'): string {
    return format === 'json' ? CLASSIFY_INTENT_SYSTEM_JSON : CLASSIFY_INTENT_SYSTEM_TEXT
  },

  user(params: { title: string; domain: string; path?: string; siteLine?: string }): string {
    const lines = [`Title: ${params.title}`, `Domain: ${params.domain}`]
    if (params.siteLine) lines.push(params.siteLine.trimStart())
    if (params.path) lines.push(`Path: ${params.path}`)
    return lines.join('\n')
  },

  parseResponse(raw: string, format: 'text' | 'json'): PageIntent {
    if (format === 'json') return parseIntentJson(raw).intent
    return parseIntentText(raw)
  },

  parseResponseDetailed(raw: string, format: 'text' | 'json'): { intent: PageIntent; strict: boolean } {
    if (format === 'json') return parseIntentJson(raw)
    return { intent: parseIntentText(raw), strict: false }
  },
}

export const enrichDomain = {
  system(): string {
    return ENRICH_DOMAIN_SYSTEM
  },

  user(domains: string[]): string {
    return `${ENRICH_DOMAIN_USER_PREFIX}
${domains.join('\n')}`
  },

  parseResponse(raw: string, sentDomains: Set<string>, fetchedAt: number): DomainInfo[] {
    return enrichDomain.parseResponseDetailed(raw, sentDomains, fetchedAt).rows
  },

  parseResponseDetailed(raw: string, sentDomains: Set<string>, fetchedAt: number): { rows: DomainInfo[]; strict: boolean; heuristic: boolean } {
    try {
      const jsonText = extractJson(raw)
      const parsed = parseJsonLenient(jsonText)
      const rows = Array.isArray(parsed)
        ? parsed
        : (
            parsed
            && typeof parsed === 'object'
            && (
              (parsed as { domains?: unknown[] }).domains
              ?? (parsed as { results?: unknown[] }).results
              ?? (parsed as { items?: unknown[] }).items
              ?? (parsed as { data?: unknown[] }).data
            )
          )
      if (!Array.isArray(rows)) return { rows: [], strict: false, heuristic: false }
      const result: DomainInfo[] = []
      const seen = new Set<string>()

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const domainValue = (row as { domain?: unknown }).domain
        const categoryValue = (row as { category?: unknown }).category
        const descriptionValue = (row as { description?: unknown }).description
        const platformValue = (row as { platform?: unknown }).platform
        if (typeof domainValue !== 'string') continue
        if (typeof descriptionValue !== 'string') continue

        const domain = domainValue.trim().toLowerCase()
        if (!sentDomains.has(domain) || seen.has(domain)) continue

        const category = typeof categoryValue === 'string'
          ? categoryValue.trim().slice(0, 40) || undefined
          : undefined
        const platform = normalizePlatform(platformValue)
        const description = normalizeDescription(descriptionValue)
        if (!description) continue

        result.push({
          domain,
          known: true,
          category,
          description,
          platform,
          fetchedAt,
        })
        seen.add(domain)
      }
      return { rows: result, strict: true, heuristic: false }
    } catch {
      const heuristic = parseDomainResponseHeuristic(raw, sentDomains, fetchedAt)
      if (heuristic.length > 0) {
        return { rows: heuristic, strict: false, heuristic: true }
      }
      return { rows: [], strict: false, heuristic: false }
    }
  },

  normalizePlatform(value: unknown): KnownPlatform | undefined {
    return normalizePlatform(value)
  },
}
