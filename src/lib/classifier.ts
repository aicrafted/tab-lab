import { chatComplete, extractJson } from './llm'
import { cosineSimilarity } from './embedder'
import { kMeans, type ClusterResult } from './cluster'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { classifierLog } from './logger'
import { getCached, setCached } from './storage'
import type { BookmarkItem, LlmSettings, TabItem } from './types'
import { DEFAULT_LLM_SETTINGS, DEFAULT_TRANSFORMERS_EMBEDDING_MODEL } from './types'
import { webgpuEmbed } from './webgpu-provider'

const SYSTEM_PROMPT = `You are a tab categorizer. For each browser tab title, domain, and URL path you receive, reply with ONE short category label (2-4 words, Title Case) that best describes the content. Avoid using "Other" unless the page is truly ambiguous. Reply with the category label only — no explanation, no punctuation.`
const SYSTEM_PROMPT_JSON = `You are a tab categorizer. For each browser tab title, domain, and URL path, output a JSON object with a single "category" key. Value must be a short category label (2-4 words, Title Case) that best describes the content.
Avoid using "Other" unless the page is truly ambiguous.

Example output: {"category": "Development"}`
const CLUSTER_SYSTEM_PROMPT = `You classify clusters of browser pages.
Given 2-3 representative pages from one cluster, return strict JSON:
{"category":"<broad category>","name":"<specific short cluster name>"}

Rules:
- category should be a broad, human-friendly label (2-4 words, Title Case) that best describes the cluster
- name must be short (2-5 words), specific, and not generic
- prefer concrete names like "Rust async runtime" over generic "Development"
- avoid using "Other" unless the samples are truly ambiguous
- output JSON only`
const classifierParseMetrics = {
  strict: 0,
  fallback: 0,
}

function trackClassifierParse(strict: boolean): void {
  if (strict) classifierParseMetrics.strict += 1
  else classifierParseMetrics.fallback += 1
  const total = classifierParseMetrics.strict + classifierParseMetrics.fallback
  if (total > 0 && total % 25 === 0) {
    classifierLog.info('parse metrics', {
      strict: classifierParseMetrics.strict,
      fallback: classifierParseMetrics.fallback,
    })
  }
}

function createProgressTracker(operation: string, total: number, context?: Record<string, unknown>) {
  const startedAt = Date.now()
  const safeTotal = Math.max(total, 1)
  let done = 0
  let lastPct = -1
  let lastLoggedDone = 0

  classifierLog.info(`${operation} start`, { total: safeTotal, ...context })

  return {
    tick(delta = 1, extra?: Record<string, unknown>) {
      const nextDone = Math.min(safeTotal, done + Math.max(0, Math.floor(delta)))
      for (let current = done + 1; current <= nextDone; current += 1) {
        const pct = Math.floor((current / safeTotal) * 100)
        const shouldLog =
          pct > lastPct
          || current === safeTotal
          || (safeTotal < 100 && current - lastLoggedDone >= 5)
        if (!shouldLog) continue
        lastPct = pct
        lastLoggedDone = current
        classifierLog.debug(`${operation} progress`, { done: current, total: safeTotal, pct, ...extra })
      }
      done = nextDone
    },
    finish(extra?: Record<string, unknown>) {
      classifierLog.info(`${operation} done`, {
        total: safeTotal,
        durationMs: Date.now() - startedAt,
        ...extra,
      })
    },
  }
}
const CATEGORY_RESPONSE_SCHEMA = {
  name: 'category_response',
  schema: {
    type: 'object',
    properties: {
      category: { type: 'string' },
    },
    required: ['category'],
    additionalProperties: false,
  },
  strict: false,
} as const
const CLUSTER_RESPONSE_SCHEMA = {
  name: 'cluster_response',
  schema: {
    type: 'object',
    properties: {
      category: { type: 'string' },
      name: { type: 'string' },
    },
    required: ['category', 'name'],
    additionalProperties: false,
  },
  strict: false,
} as const
const CATEGORY_MERGE_MAP_SCHEMA = {
  name: 'category_merge_map',
  schema: {
    type: 'object',
    additionalProperties: { type: 'string' },
  },
  strict: false,
} as const

function extractJsonObject(text: string): string {
  // Always look for { ... }, never [ ... ] — our responses are always objects
  const start = text.indexOf('{')
  if (start === -1) return ''
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
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
  if (/^-?\d+(\.\d+)?$/.test(candidate)) return fallback  // raw number from model, not a category
  return candidate
}

function isInvalidCategoryLabel(label: string): boolean {
  const text = label.trim()
  if (!text) return true
  if (/<\|[^|>]*\|>/.test(text)) return true
  if (/^(analysis|final|assistant|user|system|channel)$/i.test(text)) return true
  if (/^-?\d+(\.\d+)?$/.test(text)) return true  // model returned a raw number instead of a label
  return false
}

function parseCategoryFromRaw(raw: string): string {
  const fromJson = parseCategoryJson(raw)
  if (fromJson !== 'Other') {
    trackClassifierParse(true)
    return fromJson
  }
  trackClassifierParse(false)
  return normalizeCategoryLabel(raw)
}

function parseCategoryJson(raw: string): string {
  try {
    const jsonStr = extractJsonObject(raw) || extractJson(raw)
    const parsed = JSON.parse(jsonStr) as { category?: unknown }
    if (typeof parsed.category === 'string' && parsed.category.trim()) {
      return normalizeCategoryLabel(parsed.category)
    }
    if (parsed.category !== undefined && typeof parsed.category !== 'string') {
      classifierLog.warn('parseCategoryJson category is not string', {
        categoryType: typeof parsed.category,
        categoryValue: parsed.category,
      })
    }
  } catch (err) {
    classifierLog.warn('parseCategoryJson failed', {
      err: err instanceof Error ? err.message : String(err),
      raw: raw.slice(0, 100),
    })
  }
  return 'Other'
}

function parseClusterJson(raw: string): { category: string; name: string } {
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
  } catch (err) {
    classifierLog.warn('parseClusterJson failed', {
      err: err instanceof Error ? err.message : String(err),
      raw: raw.slice(0, 120),
    })
    return { category: 'Other', name: 'Other' }
  }
}

export type LlmStatus = 'checking' | 'ready' | 'after-download' | 'unavailable' | 'classifying' | 'normalizing' | 'error'
export const SPLIT_THRESHOLD = 15
const RARE_THRESHOLD = 3
const CATEGORY_CANDIDATES = [
  'Development',
  'Design',
  'AI & ML',
  'Science',
  'News',
  'Finance',
  'Shopping',
  'Social Media',
  'Entertainment',
  'Productivity',
  'Documentation',
  'Video',
  'Research',
  'Education',
  'Health',
  'Other',
] as const

// Rich descriptors for NLI: keywords that actually appear on pages of this type,
// not a generic label suffix. all-MiniLM-L6-v2 works by semantic proximity,
// so descriptors should sound like the content of pages in that category.
const CATEGORY_DESCRIPTORS: Record<string, string> = {
  'Development':    'code programming software engineering GitHub Stack Overflow npm package library framework debugging API backend frontend',
  'Design':         'UI UX design Figma prototype wireframe typography color layout visual interface creative',
  'AI & ML':        'machine learning neural network LLM artificial intelligence deep learning model training dataset transformer',
  'Science':        'research paper study scientific biology chemistry physics mathematics experiment journal Nature arXiv',
  'News':           'breaking news article latest update report journalist headline politics world current events',
  'Finance':        'stock market investment trading portfolio cryptocurrency banking budget personal finance economy',
  'Shopping':       'buy product price review store checkout cart deal discount Amazon eBay ecommerce',
  'Social Media':   'feed post profile follow like comment tweet Reddit Twitter Instagram social network',
  'Entertainment':  'game movie music entertainment fun streaming podcast Spotify Netflix gaming',
  'Productivity':   'task todo calendar note email meeting schedule workflow Notion Obsidian Jira project management',
  'Documentation':  'documentation manual guide API reference specification changelog README readthedocs',
  'Video':          'YouTube video watch streaming episode series channel Vimeo Twitch stream',
  'Research':       'academic paper abstract methodology findings survey analysis literature review citation',
  'Education':      'course lesson tutorial learning education Coursera Khan Academy university online class',
  'Health':         'health medical symptom treatment fitness diet wellness nutrition exercise doctor',
  'Other':          'miscellaneous general page',
}

let categoryLabelEmbeddingsPromise: Promise<Map<string, number[]>> | null = null

async function getCategoryLabelEmbeddings(model: string): Promise<Map<string, number[]>> {
  if (!categoryLabelEmbeddingsPromise) {
    categoryLabelEmbeddingsPromise = Promise.resolve(new Map())
  }
  const existing = await categoryLabelEmbeddingsPromise
  if (existing.size > 0 && model === DEFAULT_TRANSFORMERS_EMBEDDING_MODEL) return existing

  const map = new Map<string, number[]>()
  for (const label of CATEGORY_CANDIDATES) {
    const descriptor = CATEGORY_DESCRIPTORS[label] ?? label
    map.set(label, await webgpuEmbed(descriptor, model))
  }
  if (model === DEFAULT_TRANSFORMERS_EMBEDDING_MODEL) {
    categoryLabelEmbeddingsPromise = Promise.resolve(map)
  }
  return map
}

function urlPathSnippet(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    return path.slice(0, 80)
  } catch (err) {
    classifierLog.debug('failed to parse url path snippet', {
      url,
      err: err instanceof Error ? err.message : String(err),
    })
    return ''
  }
}

function domainSiteLine(domain: string, domainMap: Map<string, DomainInfo> | undefined): string {
  if (!domainMap) return ''
  const info = getDomainInfo(domain, domainMap)
  if (!info?.known) return ''
  if (info.description && info.category) return `\nSite: ${info.description} (${info.category})`
  if (info.description) return `\nSite: ${info.description}`
  if (info.category) return `\nSite: ${info.category}`
  return ''
}

async function classifyItemNLI(
  item: ClassifiedItem,
  model: string,
  domainMap?: Map<string, DomainInfo>,
): Promise<string> {
  const path = urlPathSnippet(item.url)
  const domainDesc = domainMap ? getDomainInfo(item.domain, domainMap)?.description : undefined
  const text = [domainDesc, item.title, item.domain, path].filter(Boolean).join(' ')
  const queryEmbedding = await webgpuEmbed(text, model)
  const labelEmbeddings = await getCategoryLabelEmbeddings(model)
  let bestLabel = 'Other'
  let bestScore = -Infinity

  for (const [label, embedding] of labelEmbeddings.entries()) {
    const score = cosineSimilarity(queryEmbedding, embedding)
    if (score > bestScore) {
      bestScore = score
      bestLabel = label
    }
  }

  return bestLabel
}

export async function checkLlmAvailability(settings?: LlmSettings): Promise<LlmStatus> {
  const provider = settings?.tasks.chat.provider ?? 'gemini-nano'
  if (provider === 'webllm') {
    return settings?.tasks.chat.model ? 'ready' : 'unavailable'
  }
  if (provider === 'lmstudio') {
    return settings?.providers.lmstudio.baseUrl && settings?.tasks.chat.model ? 'ready' : 'unavailable'
  }
  if (provider === 'openrouter') {
    return settings?.providers.openrouter.apiKey && settings?.tasks.chat.model ? 'ready' : 'unavailable'
  }
  try {
    if (!window.ai?.languageModel) return 'unavailable'
    const caps = await window.ai.languageModel.capabilities()
    if (caps.available === 'no') return 'unavailable'
    if (caps.available === 'after-download') return 'after-download'
    return 'ready'
  } catch (err) {
    classifierLog.warn('failed to check Gemini Nano availability', {
      err: err instanceof Error ? err.message : String(err),
    })
    return 'unavailable'
  }
}

export async function fetchLmStudioModels(settings: LlmSettings): Promise<string[]> {
  const { baseUrl, apiKey } = settings.providers.lmstudio
  if (!baseUrl) return []
  const res = await fetch(`${baseUrl}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return []
  const json = (await res.json()) as { data: { id: string }[] }
  return json.data.map((model) => model.id).sort()
}

type ClassifiedItem = { url: string; title: string; domain: string }
type ClusterInputItem = ClassifiedItem & { embedding: number[] }

export async function classifyItems(
  items: ClassifiedItem[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
  domainMap?: Map<string, DomainInfo>,
): Promise<void> {
  const uncached: ClassifiedItem[] = []
  const cached: { url: string; category: string }[] = []

  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      const cachedCategory = entry?.category?.trim()
      if (cachedCategory && !isInvalidCategoryLabel(cachedCategory)) {
        cached.push({ url: item.url, category: cachedCategory })
      } else {
        uncached.push(item)
      }
    }),
  )

  if (cached.length > 0) onProgress(cached)
  if (uncached.length === 0) return

  const useNli = settings.tasks.classification.method === 'nli'
    && settings.tasks.embedding.provider === 'transformers'
  const nliModel = settings.tasks.embedding.model || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL
  if (settings.tasks.classification.method === 'nli' && !useNli) {
    classifierLog.warn('NLI requires transformers embedding provider; falling back to LLM classification')
  }

  const provider = settings.tasks.chat.provider
  const tracker = createProgressTracker('classifyItems', uncached.length, { provider })
  const useJsonOutput = provider !== 'gemini-nano'
  const systemPrompt = useJsonOutput ? SYSTEM_PROMPT_JSON : SYSTEM_PROMPT
  const options = useJsonOutput
    ? {
      responseFormat: 'json' as const,
      metricKey: 'classifier-items',
      jsonSchema: CATEGORY_RESPONSE_SCHEMA,
      ...(provider === 'webllm' ? { disableThinking: true } : {}),
    }
    : {}

  const BATCH = 5
  let failed = 0
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH)
    const results: { url: string; category: string }[] = []

    for (const item of batch) {
      try {
        let category = 'Other'
        if (useNli) {
          category = await classifyItemNLI(item, nliModel, domainMap)
        } else {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap)
          const userMsg = `Title: ${item.title}\nDomain: ${item.domain}${siteLine}${path ? `\nPath: ${path}` : ''}`
          const raw = await chatComplete(systemPrompt, userMsg, settings, 40, options)
          category = useJsonOutput ? parseCategoryFromRaw(raw) : normalizeCategoryLabel(raw)
        }
        const existing = await getCached(prefix, item.url)
        await setCached(prefix, item.url, {
          ...existing,
          category,
          parentCategory: existing?.parentCategory ?? category,
          processedAt: Date.now(),
        })
        results.push({ url: item.url, category })
      } catch (err) {
        failed += 1
        classifierLog.error('classifyItems item failed', {
          url: item.url,
          domain: item.domain,
          err: err instanceof Error ? err.message : String(err),
        })
      } finally {
        tracker.tick(1)
      }
    }
    if (results.length > 0) onProgress(results)
  }
  tracker.finish({ failed })
}

/** Load cached categories for a set of items. Returns url → category map. */
export async function loadCachedCategories(
  items: { url: string }[],
  prefix: 'tab' | 'bm',
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      const cachedCategory = entry?.category?.trim()
      if (cachedCategory && !isInvalidCategoryLabel(cachedCategory)) {
        map.set(item.url, cachedCategory)
      }
    }),
  )
  return map
}

/** Load cached category hierarchy for a set of items. Returns url → { category, parentCategory }. */
export async function loadCachedCategoryData(
  items: { url: string }[],
  prefix: 'tab' | 'bm',
): Promise<Map<string, { category: string; parentCategory?: string }>> {
  const map = new Map<string, { category: string; parentCategory?: string }>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      const cachedCategory = entry?.category?.trim()
      if (!cachedCategory || isInvalidCategoryLabel(cachedCategory)) return
      const parentCategory = entry?.parentCategory?.trim()
      map.set(item.url, {
        category: cachedCategory,
        ...(parentCategory ? { parentCategory } : {}),
      })
    }),
  )
  return map
}

/** Load cached tags for a set of items. Returns url → tags map. */
export async function loadCachedTags(
  items: { url: string }[],
  prefix: 'tab' | 'bm',
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      if (entry?.tags?.length) map.set(item.url, entry.tags)
    }),
  )
  return map
}

/** Load cached intents for a set of items. Returns url → intent map. */
export async function loadCachedIntents(
  items: { url: string }[],
  prefix: 'tab' | 'bm',
): Promise<Map<string, import('./types').PageIntent>> {
  const map = new Map<string, import('./types').PageIntent>()
  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      if (entry?.intent) map.set(item.url, entry.intent)
    }),
  )
  return map
}

/** Returns a mapping of raw category → canonical category name. */
export async function normalizeCategoryLabels(
  labels: string[],
  settings: LlmSettings,
): Promise<Record<string, string>> {
  if (labels.length <= 1) return Object.fromEntries(labels.map((label) => [label, label]))
  const tracker = createProgressTracker('normalizeCategoryLabels', labels.length)

  const prompt = `You are a category deduplicator. I will give you a list of category labels from browser tabs. Your job is to aggressively merge semantically similar or overlapping labels into a single canonical name. Be generous with merges — if two labels describe roughly the same topic, merge them.

Rules:
- Merge synonyms, near-duplicates, and subsets (e.g. "Tech" → "Technology", "Software Development" → "Development")
- Prefer short, widely understood names
- Keep distinct only if they describe genuinely different topics
- Reply ONLY with a JSON object mapping each input label to its canonical name. All input labels must appear as keys.

Labels:
${labels.map((label) => `- ${label}`).join('\n')}

Reply with JSON only, no explanation.`

  const maxTokens = Math.min(4000, labels.length * 50 + 300)
  const raw = await chatComplete(
    'You output strict JSON only.',
    prompt,
    settings,
    maxTokens,
    settings.tasks.chat.provider !== 'gemini-nano'
      ? {
        responseFormat: 'json',
        metricKey: 'classifier-normalize',
        jsonSchema: CATEGORY_MERGE_MAP_SCHEMA,
        ...(settings.tasks.chat.provider === 'webllm' ? { disableThinking: true } : {}),
      }
      : {},
  )

  try {
    const parsed = JSON.parse(extractJson(raw)) as Record<string, string>
    for (const label of labels) {
      if (!(label in parsed)) parsed[label] = label
    }
    tracker.tick(labels.length)
    tracker.finish()
    return parsed
  } catch (err) {
    tracker.tick(labels.length)
    classifierLog.warn('normalizeCategoryLabels JSON parse failed, keeping originals', {
      err: err instanceof Error ? err.message : String(err),
    })
    tracker.finish({ fallback: true })
    return Object.fromEntries(labels.map((label) => [label, label]))
  }
}

export async function groupRareCategories(
  items: { url: string; category: string }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  maxPasses = 3,
): Promise<{ url: string; category: string }[]> {
  let current = items
    .map((item) => ({ url: item.url, category: item.category.trim() }))
    .filter((item) => item.category.length > 0)
  if (current.length === 0) return []
  const tracker = createProgressTracker('groupRareCategories', current.length * Math.max(1, maxPasses), { maxPasses })

  const allUpdates = new Map<string, string>() // url → final category

  for (let pass = 0; pass < maxPasses; pass++) {
    const counts = new Map<string, number>()
    for (const item of current) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
    }

    const frequent = [...counts.entries()]
      .filter(([, count]) => count >= RARE_THRESHOLD)
      .map(([category]) => category)
    const rare = [...counts.entries()]
      .filter(([, count]) => count < RARE_THRESHOLD)
      .map(([category]) => category)

    if (rare.length === 0) {
      classifierLog.info('groupRareCategories no rare categories; stopping', { pass })
      break
    }

    classifierLog.info('groupRareCategories pass', { pass: pass + 1, rare: rare.length, frequent: frequent.length })

    const allCategories = [
      ...frequent.map((c) => `${c} (${counts.get(c)} tabs)`),
      ...rare.map((c) => `${c} (${counts.get(c)} tab${(counts.get(c) ?? 1) > 1 ? 's' : ''})`),
    ]
    const prompt = `You are consolidating browser tab categories. Map each RARE category to its best target.

All categories (rare = 1-2 tabs, others are stable):
${allCategories.map((c) => `- ${c}`).join('\n')}

Rare categories to reassign:
${rare.map((c) => `- ${c}`).join('\n')}

Rules:
- Map each rare category to a frequent category if semantically fitting
- If two rare categories describe the same topic, map both to one shared label
- Prefer existing category names over inventing new ones
- Avoid vague labels like "Other", "Miscellaneous", "General"
- Reply ONLY with a JSON object: rare category → target category name

Example: {"Steam Games": "Gaming", "Software Deployment": "Software Development"}`

    const provider = settings.tasks.chat.provider
    const useJsonOutput = provider !== 'gemini-nano'
    const maxTokens = Math.min(4000, rare.length * 50 + 300)
    const raw = await chatComplete(
      'You output strict JSON only.',
      prompt,
      settings,
      maxTokens,
      useJsonOutput
        ? {
          responseFormat: 'json',
          metricKey: 'classifier-group-rare',
          jsonSchema: CATEGORY_MERGE_MAP_SCHEMA,
          ...(provider === 'webllm' ? { disableThinking: true } : {}),
        }
        : {},
    )

    let mergeMap: Record<string, string> = {}
    try {
      mergeMap = JSON.parse(extractJson(raw)) as Record<string, string>
    } catch (err) {
      classifierLog.warn('groupRareCategories parse failed; stopping', {
        pass: pass + 1,
        err: err instanceof Error ? err.message : String(err),
        raw: raw.slice(0, 120),
      })
      break
    }

    let changed = false
    current = current.map((item) => {
      tracker.tick(1)
      const targetRaw = mergeMap[item.category]
      const target = typeof targetRaw === 'string' ? targetRaw.trim().slice(0, 40) : ''
      if (!target || target === item.category) return item
      changed = true
      allUpdates.set(item.url, target)
      return { url: item.url, category: target }
    })

    if (!changed) {
      classifierLog.info('groupRareCategories no changes; stopping', { pass: pass + 1 })
      break
    }
  }

  if (allUpdates.size === 0) {
    tracker.finish({ updates: 0 })
    return []
  }

  const updates = [...allUpdates.entries()].map(([url, category]) => ({ url, category }))

  await Promise.all(updates.map(async (update) => {
    const existing = await getCached(prefix, update.url)
    if (!existing) return
    await setCached(prefix, update.url, {
      ...existing,
      category: update.category,
      processedAt: Date.now(),
    })
  }))

  tracker.finish({ updates: updates.length })
  return updates
}

/** Re-classifies items in categories that have too many members. */
export async function splitLargeClusters(
  items: { url: string; title: string; domain: string; category: string }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  embeddings?: Map<string, number[]>,
): Promise<void> {
  const groups = new Map<string, { url: string; title: string; domain: string }[]>()
  for (const item of items) {
    if (!item.category) continue
    const bucket = groups.get(item.category) ?? []
    bucket.push(item)
    groups.set(item.category, bucket)
  }
  const totalWork = [...groups.values()]
    .filter((members) => members.length > SPLIT_THRESHOLD)
    .reduce((sum, members) => sum + members.length, 0)
  const tracker = createProgressTracker('splitLargeClusters', Math.max(totalWork, 1), {
    groups: groups.size,
    totalItems: items.length,
  })

  for (const [parentCategory, members] of groups) {
    if (members.length <= SPLIT_THRESHOLD) continue

    const membersWithEmbeddings = embeddings
      ? members
          .map((member) => ({ ...member, embedding: embeddings.get(member.url) }))
          .filter((member): member is { url: string; title: string; domain: string; embedding: number[] } => Boolean(member.embedding))
      : []

    if (membersWithEmbeddings.length >= 3) {
      const subK = Math.max(2, Math.min(8, Math.ceil(members.length / 5)))
      const subClusters = kMeans(
        membersWithEmbeddings.map((member) => ({ url: member.url, embedding: member.embedding })),
        subK,
      )
      await classifyByClusters(
        membersWithEmbeddings,
        subClusters,
        prefix,
        settings,
        (updates) => {
          onProgress(updates.map((update) => ({ url: update.url, category: update.category })))
        },
        domainMap,
      )
      tracker.tick(members.length, { parentCategory, strategy: 'kmeans' })
      continue
    }

    const provider = settings.tasks.chat.provider
    const useJsonOutput = provider !== 'gemini-nano'
    const systemPrompt = useJsonOutput ? SYSTEM_PROMPT_JSON : SYSTEM_PROMPT
    const options = useJsonOutput
      ? {
        responseFormat: 'json' as const,
        metricKey: 'classifier-split',
        jsonSchema: CATEGORY_RESPONSE_SCHEMA,
        ...(provider === 'webllm' ? { disableThinking: true } : {}),
      }
      : {}
    const BATCH = 5
    for (let i = 0; i < members.length; i += BATCH) {
      const batch = members.slice(i, i + BATCH)
      const updates: { url: string; category: string; parentCategory?: string }[] = []

      for (const item of batch) {
        try {
          const path = urlPathSnippet(item.url)
          const siteLine = domainSiteLine(item.domain, domainMap)
          const pathPart = path ? `\nPath: ${path}` : ''
          const userMsg = useJsonOutput
            ? `Title: ${item.title}\nDomain: ${item.domain}${siteLine}${pathPart}\nParent: ${parentCategory}\nAssign a more specific sub-category.`
            : `Title: ${item.title}\nDomain: ${item.domain}${siteLine}${pathPart}\nCurrent category: ${parentCategory}\nAssign a more specific sub-category (2-4 words, Title Case). Reply with the label only.`
          const raw = await chatComplete(
            systemPrompt,
            userMsg,
            settings,
            40,
            options,
          )
          const category = useJsonOutput
            ? (parseCategoryFromRaw(raw) || parentCategory)
            : normalizeCategoryLabel(raw, parentCategory)
          const existing = await getCached(prefix, item.url)
          await setCached(prefix, item.url, {
            ...existing,
            category,
            parentCategory,
            processedAt: Date.now(),
          })
          updates.push({ url: item.url, category, parentCategory })
        } catch (err) {
          classifierLog.error('splitLargeClusters item failed', {
            url: item.url,
            domain: item.domain,
            parentCategory,
            err: err instanceof Error ? err.message : String(err),
          })
        } finally {
          tracker.tick(1, { parentCategory, strategy: 'batch-llm' })
        }
      }
      if (updates.length > 0) onProgress(updates)
    }
  }
  tracker.finish()
}

export async function classifyTabs(
  tabs: TabItem[],
  onProgress: (updates: { url: string; category: string }[]) => void,
  settings?: LlmSettings,
): Promise<void> {
  const activeSettings = settings ?? {
    ...DEFAULT_LLM_SETTINGS,
    tasks: {
      ...DEFAULT_LLM_SETTINGS.tasks,
      chat: { provider: 'gemini-nano', model: '' },
      embedding: { provider: 'transformers', model: '' },
      classification: { method: 'llm' },
    },
  }
  await classifyItems(
    tabs.map((tab) => ({ url: tab.url, title: tab.title, domain: tab.domain })),
    'tab',
    activeSettings,
    onProgress,
  )
}

export async function classifyBookmarks(
  bookmarks: BookmarkItem[],
  onProgress: (updates: { url: string; category: string }[]) => void,
  settings?: LlmSettings,
): Promise<void> {
  const activeSettings = settings ?? {
    ...DEFAULT_LLM_SETTINGS,
    tasks: {
      ...DEFAULT_LLM_SETTINGS.tasks,
      chat: { provider: 'gemini-nano', model: '' },
      embedding: { provider: 'transformers', model: '' },
      classification: { method: 'llm' },
    },
  }
  await classifyItems(
    bookmarks.map((bookmark) => ({ url: bookmark.url, title: bookmark.title, domain: bookmark.domain })),
    'bm',
    activeSettings,
    onProgress,
  )
}

export async function classifyWithLmStudio(
  items: ClassifiedItem[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
  domainMap?: Map<string, DomainInfo>,
): Promise<void> {
  await classifyItems(items, prefix, settings, onProgress, domainMap)
}

function inferClusterNameFromRepresentative(title: string, category: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim()
  if (!normalized) return category
  return normalized.split(' ').slice(0, 5).join(' ').slice(0, 60)
}

async function classifyClusterNli(
  centroid: number[],
  model: string,
): Promise<string> {
  const labelEmbeddings = await getCategoryLabelEmbeddings(model)
  let bestLabel = 'Other'
  let bestScore = -Infinity
  for (const [label, embedding] of labelEmbeddings.entries()) {
    const score = cosineSimilarity(centroid, embedding)
    if (score > bestScore) {
      bestScore = score
      bestLabel = label
    }
  }
  return bestLabel
}

export async function classifyByClusters(
  items: ClusterInputItem[],
  clusters: ClusterResult[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string; parentCategory?: string; clusterId: number }[]) => void,
  domainMap?: Map<string, DomainInfo>,
): Promise<Map<number, string>> {
  const totalMembers = clusters.reduce((sum, cluster) => sum + cluster.members.length, 0)
  const tracker = createProgressTracker('classifyByClusters', totalMembers, { clusters: clusters.length })
  const byUrl = new Map(items.map((item) => [item.url, item]))
  const names = new Map<number, string>()
  const useNli = settings.tasks.classification.method === 'nli'
    && settings.tasks.embedding.provider === 'transformers'
  const nliModel = settings.tasks.embedding.model || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL

  for (const cluster of clusters) {
    const representativeItems = cluster.representatives
      .map((url) => byUrl.get(url))
      .filter((item): item is ClusterInputItem => Boolean(item))

    if (representativeItems.length === 0 || cluster.members.length === 0) {
      tracker.tick(cluster.members.length, { clusterId: cluster.clusterId, skipped: true })
      continue
    }

    let category = 'Other'
    let name = 'Other'

    if (useNli) {
      category = await classifyClusterNli(cluster.centroid, nliModel)
      name = inferClusterNameFromRepresentative(representativeItems[0].title, category)
    } else {
      const samples = representativeItems.map((item) => {
        const path = urlPathSnippet(item.url)
        const siteLine = domainSiteLine(item.domain, domainMap)
        return `Title: ${item.title}\nDomain: ${item.domain}${siteLine}${path ? `\nPath: ${path}` : ''}`
      }).join('\n---\n')
      const provider = settings.tasks.chat.provider
      const useJsonOutput = provider !== 'gemini-nano'
      const raw = await chatComplete(
        CLUSTER_SYSTEM_PROMPT,
        samples,
        settings,
        200,
        useJsonOutput
          ? {
            responseFormat: 'json',
            metricKey: 'classifier-clusters',
            jsonSchema: CLUSTER_RESPONSE_SCHEMA,
            ...(provider === 'webllm' ? { disableThinking: true } : {}),
          }
          : {},
      )
      const parsed = parseClusterJson(raw)
      category = parsed.category || 'Other'
      if (category === 'Other') {
        category = normalizeCategoryLabel(raw, 'Other')
      }
      name = parsed.name || category
    }

    names.set(cluster.clusterId, name)

    const updates: { url: string; category: string; parentCategory?: string; clusterId: number }[] = []
    for (const url of cluster.members) {
      const existing = await getCached(prefix, url)
      await setCached(prefix, url, {
        category,
        parentCategory: category,
        clusterId: cluster.clusterId,
        processedAt: Date.now(),
        tags: existing?.tags,
        embedding: existing?.embedding,
        intent: existing?.intent,
      })
      updates.push({ url, category, parentCategory: category, clusterId: cluster.clusterId })
    }
    if (updates.length > 0) onProgress(updates)
    tracker.tick(cluster.members.length, { clusterId: cluster.clusterId })
  }

  tracker.finish({ namedClusters: names.size })
  return names
}
