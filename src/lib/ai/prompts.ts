import { parseLlmJson } from './parsers'
import type { DomainInfo } from './domain-enricher'
import { KNOWN_PLATFORMS, PAGE_INTENTS, type PageIntent, type KnownPlatform } from '../core/types'
export type { PageIntent, KnownPlatform }

const VALID_INTENTS: readonly PageIntent[] = PAGE_INTENTS

const VALID_PLATFORMS = new Set<string>(KNOWN_PLATFORMS)
const KNOWN_PLATFORMS_TEXT = KNOWN_PLATFORMS.join(', ')

// type KnownPlatform = DomainInfo['platform']

const CLASSIFY_ITEM_SYSTEM_TEXT = `You are a tab categorizer. Goal: provide a SPECIFIC TOPIC category for each page.
Rules:
1. Category must be a descriptive topic (1-3 words, Title Case).
2. PREFER SPECIFICITY: Use "Programming Languages" instead of "Technology", or "UI Design" instead of "Design".
3. DO NOT use brand names, site names, or domains.
4. DO NOT copy the tab title or domain into the category.
5. DO NOT use too wide categories like "Search", "Web", "Miscellaneous", "General", "Technology", "Internet".
Reply with the category label ONLY — no punctuation, no repeats.`

const CLASSIFY_ITEM_SYSTEM_JSON = `You are a tab categorizer. Goal: assign a SPECIFIC TOPIC category to each browser page.
Output strict JSON: {"category": "TOPIC"}

Rules:
1. Category must be a descriptive topic (1-3 words, Title Case).
2. PREFER SPECIFICITY: Focus on precise topics. "React" is better than "Technology". "E-commerce" is better than "Shopping".
3. DO NOT include brand names, site names, or domains (e.g., use "Social Media" instead of "Twitter").
4. DO NOT copy the tab title or domain directly into the category.
5. DO NOT use too wide categories like "Search", "Web", "Miscellaneous", "General", "Technology", "Internet".
6. If a specific tool, identify its nature (e.g., "Graphic Design Tool" instead of "Visuals").

Example: {"category": "Software Engineering"}`

const CLASSIFY_CLUSTER_SYSTEM = `You classify clusters of browser pages.
Given 2-3 representative pages from one cluster, return strict JSON:
{"category":"<broad category>","name":"<specific short cluster name>"}

Rules:
- category should be a broad, human-friendly label (2-4 words, Title Case) that best describes the cluster
- name must be short (2-5 words), specific, and not generic
- prefer concrete names like "Rust async runtime" over generic "Development"
- avoid using "Other" unless the samples are truly ambiguous
- output JSON only`

const DISCOVER_UMBRELLAS_SYSTEM = `You are a taxonomy expert. 
Your goal is to look at a list of browser tab labels and suggest a set of high-level "Umbrella" categories to consolidate them.

Rules:
- Output MUST be a single JSON object with an "umbrellas" key: {"umbrellas": ["Name 1", "Name 2", ...]}
- STRONGLY CONSOLIDATE: If you receive 100 labels, output 10-20 umbrellas.
- Max 50 umbrellas total, ideally 15-30.
- Umbrella categories should be Title Case, short (1-3 words), and meaningful.
- Avoid specific names like "GitHub", use "Development" or "Code Hosting".
- Output ONLY the JSON object.

Example condensation:
Input: ["React docs", "Vue guide", "JS tutorial", "Python scripts", "Bash tips"]
Output: {"umbrellas": ["Software Development", "Programming Languages"]}`

const NORMALIZE_CATEGORIES_USER_PREFIX = `Suggest umbrella categories for these labels:`

const NORMALIZE_CATEGORIES_USER_SUFFIX = 'Output JSON object with "umbrellas" array.'

export const MAP_LABELS_TO_UMBRELLAS_SYSTEM = `You are a taxonomy expert. Your goal is to map input labels to a provided list of Umbrella categories.
Rules:
- Output MUST be a single JSON object mapping each input label to its best Umbrella: {"Label 1": "Umbrella A", "Label 2": "Umbrella B"}
- Every input label MUST be present in the output keys.
- If a label fits multiple Umbrellas, pick the most specific one.
- If a label fits NO Umbrella, you may return the label itself (identity mapping) or "Other".
- Reply ONLY with JSON object.
`

export const MAP_LABELS_TO_UMBRELLAS_USER_PREFIX = `Umbrella Categories:
`
export const MAP_LABELS_TO_UMBRELLAS_USER_MIDDLE = `
Labels to map:
`
const CONSOLIDATE_LABELS_SYSTEM = `You are a strict Deduplication Engine. 
Objective: Identify clusters of redundant category labels.

RULES:
1. USE ONLY THE EXACT LABELS PROVIDED.
2. Use counts as context:
   - Merging large categories (many items) is only allowed for SYNONYMS or ACRONYMS (e.g., "AI" and "Artificial Intelligence").
   - DO NOT merge distinct large topics (e.g., "Video" and "Music") even if they are related.
   - Small categories (few items) can be merged more aggressively into larger related categories.
3. Output MUST be a JSON array of arrays: [["Label A", "Label B"]].
4. Each group must contain 2+ labels from the input list.
5. If no duplicates found, return [].
6. Reply ONLY with the JSON array.`

const CONSOLIDATE_LABELS_USER_PREFIX = `Scan these labels (with item counts) and group redundant ones:`

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

const ANALYZE_METADATA_SYSTEM_JSON = `You are a web page analyzer. Extract tags, intent, and platform from a browser tab.
Output strict JSON:
{
  "tags": ["tag1", "tag2", "tag3"],
  "intent": "article|reference|tool|service|transactional|video|repository|other",
  "platform": "social|video|code|registry|qa|blog|docs|shopping|news|ai|tool|sandbox|cloud|music|finance|ci|games|education|email|reference|null"
}

RULES:
1. TAGS: 3-5 specific lowercase tags (1-2 words each). Avoid generic tags like "website" or "internet".
   Tags CAN include product/brand names (e.g., "typescript", "react", "figma").
2. INTENT (how the user uses this page):
   - article: read-only content (blog posts, news, reddit threads, forum discussions)
   - reference: lookup content (API docs, cheatsheets, wikis, man pages)
   - tool: interactive app (editors, dashboards, SaaS, IDEs)
   - service: functional but passive (landing pages, settings, pricing, sign-up)
   - transactional: one-time action (orders, tickets, receipts, tracking)
   - video: primary content is video/audio (YouTube, Twitch, podcasts)
   - repository: code asset (GitHub repo, npm, crates.io)
   - other: anything else
   Note: prefer "tool" over "service" when the page has interactive functionality.
3. PLATFORM (what kind of service hosts this):
   - social: social networks (Reddit, Twitter, LinkedIn, Mastodon)
   - video: video hosting (YouTube, Vimeo, Twitch)
   - code: code hosting / dev IDEs (GitHub, GitLab, VS Code web)
   - registry: package managers (npm, PyPI, crates.io)
   - qa: Q&A sites (Stack Overflow, Ask HN)
   - blog: articles / personal blogs (Medium, Substack, dev.to)
   - docs: official documentation (ReadTheDocs, developer portals)
   - shopping: e-commerce (Amazon, eBay, Shopify stores)
   - news: news media (BBC, HN, TechCrunch)
   - ai: AI tools and model hubs (ChatGPT, Claude, HuggingFace)
   - tool: general SaaS apps (Figma, Notion, Linear)
   - sandbox: code playgrounds (CodePen, StackBlitz, JSFiddle)
   - cloud: cloud providers (AWS, GCP, Azure)
   - music: music streaming (Spotify, SoundCloud)
   - finance: banking / trading (Stripe, Robinhood, bank portals)
   - ci: CI/CD platforms (GitHub Actions, CircleCI, Vercel)
   - games: gaming stores / communities (Steam, itch.io)
   - education: learning platforms (Coursera, Udemy, Khan Academy)
   - email: webmail clients (Gmail, Outlook web)
   - reference: general encyclopedias / wikis (Wikipedia, MDN)
   - Use null if no platform fits.

Example: {"tags": ["rust", "async", "tokio"], "intent": "reference", "platform": "docs"}`

const CLASSIFY_CATEGORY_SYSTEM_JSON = `You are a tab categorizer. Goal: assign a SPECIFIC TOPIC category to a browser page.
Output strict JSON: {"category": "SPECIFIC TOPIC"}

Rules:
1. Category must be a descriptive topic (1-3 words, Title Case).
2. PREFER SPECIFICITY: "Frontend Development" is better than "Technology". "E-commerce" is better than "Shopping".
3. DO NOT include brand names, site names, or domains (e.g., use "Frontend Development" not "React", "Version Control" not "GitHub").
4. DO NOT copy the tab title or domain directly into the category.
5. DO NOT use wide or vague categories: "Miscellaneous", "General", "Technology", "Internet", "Other", "Web", "Software".
6. If a specific tool, identify its nature (e.g., "Graphic Design Tool" instead of "Visuals").
7. REUSE existing categories when provided — prefer an existing category that fits over inventing a new one.

Example: {"category": "Software Engineering"}`

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


function normalizeCategoryLabel(raw: string, fallback = 'Other'): string {
  let text = raw

  // Handle URL encoding if present
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text)
    } catch { 
      // Fallback: replace common ones manually if decode fails
      text = text.replace(/%20/g, ' ').replace(/%5f/gi, '_')
    }
  }

  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\|[^|>]*\|>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[{}[\]`"]/g, ' ')
    .replace(/([a-z]{2,})([A-Z])/g, '$1 $2') // Break CamelCase (WebApp -> Web App, protects IoT, eBay)
    .replace(/([A-Z]{2,})([A-Z][a-z]{2,})/g, '$1 $2') // Handle acronyms (AIModel -> AI Model, protects APIs)
    .replace(/_/g, ' ')
    .replace(/^\.+|\.+$/g, '') // Strip leading/trailing dots
    .replace(/\s+/g, ' ')
    .trim()

  // Remove common LLM prefixes/hallucinations if the model repeats them
  text = text
    .replace(/^(category|label|output|result|choice|name|type|title|domain|url|site)\s*[:=]\s*/i, '')
    .split(/\b(domain|url|site|path|title|category)\s*:/i)[0] // Strip "Title: ... Domain: ..." suffixes
    .trim()
  
  if (!text) return fallback
  
  // Split by common delimiters and take the first part
  // This handles "Category/Subcategory" or "Item 1 & Item 2"
  const firstPhrase = text.split(/[&/\\|;]/)[0]?.trim() || text
  let candidate = firstPhrase.slice(0, 40).replace(/^\.+|\.+$/g, '').trim()
  if (!candidate) return fallback

  // Enforce Title Case for each word
  candidate = candidate
    .split(/\s+/)
    .map(word => {
      if (word.length === 0) return ''
      // If it's a pure acronym (AI, LLM) or has internal caps (APIs, IoT, WebApp), keep it as is
      if (word.length > 1 && (word === word.toUpperCase() || /[A-Z]/.test(word.slice(1)))) {
        return word
      }
      // Otherwise (all lowercase or just first letter caps), enforce Title Case
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
    .trim()

  if (isInvalidCategoryLabel(candidate)) return fallback
  return candidate
}

function isInvalidCategoryLabel(label: string): boolean {
  const text = label.trim()
  if (!text || text.length < 2) return true
  if (/\.{3,}/.test(text)) return true // Reject ellipses
  if (text.startsWith('.')) return true
  if (/<\|[^|>]*\|>/.test(text)) return true
  // Blacklist generic technical terms that are often hallucinations or bad defaults
  if (/^(analysis|final|assistant|user|system|channel|null|undefined|category|unknown|other|result|choice)$/i.test(text)) return true
  if (/^-?\d+(\.\d+)?$/.test(text)) return true
  return false
}

function parseCategoryJson(raw: string): { category: string; strict: boolean } {
  const parsed = parseLlmJson<any>(raw, null)
  if (parsed && typeof parsed === 'object') {
    const cat = parsed.category || parsed.label || parsed.type || parsed.class
    if (cat && typeof cat === 'string' && cat.trim()) {
      return { category: normalizeCategoryLabel(cat), strict: true }
    }
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
  const parsed = parseLlmJson<{ tags?: string[] }>(raw, {})
  if (Array.isArray(parsed.tags)) {
    const tags = parsed.tags
      .map(normalizeTagToken)
      .filter((tag) => tag.length > 1 && tag.length < 30)
      .slice(0, 5)
    return { tags, strict: true }
  }
  return { tags: parseTagsText(raw), strict: false }
}

function parseIntentText(raw: string): PageIntent {
  const normalized = raw.trim().toLowerCase()
  return VALID_INTENTS.find((intent) => normalized.includes(intent)) ?? 'other'
}

function parseIntentJson(raw: string): { intent: PageIntent; strict: boolean } {
  const parsed = parseLlmJson<{ intent?: PageIntent }>(raw, {})
  if (parsed.intent) {
    const value = VALID_INTENTS.find((intent) => intent === parsed.intent) ?? 'other'
    return { intent: value, strict: true }
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
    candidates?: string[]
  }): string {
    const { title, domain, path, siteLine, parentCategory, candidates } = params
    const lines = [`Title: ${title}`, `Domain: ${domain}`]
    if (siteLine) lines.push(siteLine.trimStart())
    if (path) lines.push(`Path: ${path}`)
    if (parentCategory) {
      lines.push(`Parent: ${parentCategory}`)
      lines.push('Assign a more specific sub-category.')
    }
    if (candidates && candidates.length > 0) {
      lines.push(`Existing categories: ${candidates.join(', ')}`)
      lines.push('Use an existing category ONLY if it is a PRECISE match. If existing categories are too broad (like "Technology", "Web", or "Internet"), create a NEW specific TOPIC.')
    }
    lines.push('\nImportant: Respond with a general TOPIC (e.g., "Shopping"), not a brand name (e.g., "Amazon" or "eBay").')
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
    const parsed = parseLlmJson<{ category?: string; name?: string }>(raw, {})
    const category = parsed.category?.trim() ? normalizeCategoryLabel(parsed.category) : 'Other'
    const name = parsed.name?.trim() ? parsed.name.trim().slice(0, 60) : category
    return { category, name }
  },
}

export const normalizeCategories = {
  system(): string {
    return DISCOVER_UMBRELLAS_SYSTEM
  },

  user(labels: string[]): string {
    return `${NORMALIZE_CATEGORIES_USER_PREFIX}
${labels.map((label) => `- ${label}`).join('\n')}

${NORMALIZE_CATEGORIES_USER_SUFFIX}`
  },

  parseUmbrellas(raw: string): string[] {
    const parsed = parseLlmJson<any>(raw, [])
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.umbrellas)) {
      return parsed.umbrellas
    }
    return []
  },
}

export const consolidateCategories = {
  system(): string {
    return CONSOLIDATE_LABELS_SYSTEM
  },

  user(labelsWithCounts: { label: string; count: number }[]): string {
    const list = labelsWithCounts.map((l) => `- ${l.label} (${l.count} items)`).join('\n')
    return `${CONSOLIDATE_LABELS_USER_PREFIX}\n${list}\n\nReturn ONLY JSON array using the EXACT strings above.`
  },

  parseResponse(raw: string): string[][] {
    return parseLlmJson<string[][]>(raw, [])
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
    return parseLlmJson<Record<string, string>>(raw, {})
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
${domains.join(' \n')}`
  },

  parseResponse(raw: string, sentDomains: Set<string>, fetchedAt: number): DomainInfo[] {
    return enrichDomain.parseResponseDetailed(raw, sentDomains, fetchedAt).rows
  },

  parseResponseDetailed(raw: string, sentDomains: Set<string>, fetchedAt: number): { rows: DomainInfo[]; strict: boolean; heuristic: boolean } {
    try {
      const parsed = parseLlmJson<any>(raw, null)
      if (!parsed) throw new Error('parsing failed')
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

export const analyzeMetadata = {
  system(): string { return ANALYZE_METADATA_SYSTEM_JSON },
  user(params: { title: string; domain: string; path?: string; siteLine?: string }): string {
    return tagItem.user(params)
  },
  parseResponse(raw: string): { tags: string[]; intent: PageIntent; platform: KnownPlatform | null } {
    const tags = parseTagsJson(raw)
    const intent = parseIntentJson(raw)
    const platform = normalizePlatform(parseLlmJson<any>(raw, {}).platform)
    return { 
      tags: tags.tags, 
      intent: intent.intent, 
      platform: platform || null 
    }
  }
}

export const classifyCategory = {
  system(): string {
    return CLASSIFY_CATEGORY_SYSTEM_JSON
  },

  user(params: { 
    title: string; 
    domain: string; 
    path?: string; 
    siteLine?: string; 
    candidates?: string[];
    tags?: string[];
  }): string {
    const lines = [`Title: ${params.title}`, `Domain: ${params.domain}`]
    if (params.siteLine) lines.push(params.siteLine.trimStart())
    if (params.path) lines.push(`Path: ${params.path}`)
    if (params.tags && params.tags.length > 0) {
      lines.push(`Tags: ${params.tags.join(', ')}`)
    }
    if (params.candidates && params.candidates.length > 0) {
      lines.push(`Existing categories: ${params.candidates.join(', ')}`)
      lines.push('Prefer an existing category when it fits. Create a new category only if none of the existing ones are close enough.')
    }
    lines.push('\nImportant: Category must be a general TOPIC (e.g., "Systems Programming"), not a brand name (e.g., "Rust" or "Tokio").')
    return lines.join('\n')
  },

  parseResponse(raw: string): { category: string } {
    const json = parseCategoryJson(raw)
    return { category: json.category }
  }
}
