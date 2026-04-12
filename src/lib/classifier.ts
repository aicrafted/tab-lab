import { chatComplete } from './llm'
import { cosineSimilarity } from './embedder'
import { getCached, setCached } from './storage'
import type { BookmarkItem, LlmSettings, TabItem } from './types'
import { DEFAULT_LLM_SETTINGS, DEFAULT_TRANSFORMERS_EMBEDDING_MODEL } from './types'
import { webgpuEmbed } from './webgpu-provider'

const SYSTEM_PROMPT = `You are a tab categorizer. For each browser tab title and domain you receive, reply with ONE short category label (2-4 words, Title Case). Choose from common topics like: Development, Design, AI & ML, Science, News, Finance, Shopping, Social Media, Entertainment, Productivity, Documentation, Video, Research, Education, Health. If unsure, use "Other". Reply with the category label only — no explanation, no punctuation.`
const SYSTEM_PROMPT_JSON = `You are a tab categorizer. For each browser tab title and domain, output a JSON object with a single "category" key. Value must be a short category label (2-4 words, Title Case). Choose from: Development, Design, AI & ML, Science, News, Finance, Shopping, Social Media, Entertainment, Productivity, Documentation, Video, Research, Education, Health. Use "Other" if unsure.

Example output: {"category": "Development"}`

function parseCategoryJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { category?: unknown }
    if (typeof parsed.category === 'string') {
      return parsed.category.slice(0, 40)
    }
  } catch (err) {
    console.warn('[classifier] category JSON parse failed, falling back to plain text', err)
  }
  return raw.trim().slice(0, 40) || 'Other'
}

export type LlmStatus = 'checking' | 'ready' | 'after-download' | 'unavailable' | 'classifying' | 'normalizing'
export const SPLIT_THRESHOLD = 15
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

let categoryLabelEmbeddingsPromise: Promise<Map<string, number[]>> | null = null

async function getCategoryLabelEmbeddings(model: string): Promise<Map<string, number[]>> {
  if (!categoryLabelEmbeddingsPromise) {
    categoryLabelEmbeddingsPromise = Promise.resolve(new Map())
  }
  const existing = await categoryLabelEmbeddingsPromise
  if (existing.size > 0 && model === DEFAULT_TRANSFORMERS_EMBEDDING_MODEL) return existing

  const map = new Map<string, number[]>()
  for (const label of CATEGORY_CANDIDATES) {
    const descriptor = `${label}. Browser page category.`
    map.set(label, await webgpuEmbed(descriptor, model))
  }
  if (model === DEFAULT_TRANSFORMERS_EMBEDDING_MODEL) {
    categoryLabelEmbeddingsPromise = Promise.resolve(map)
  }
  return map
}

async function classifyItemNLI(item: ClassifiedItem, model: string): Promise<string> {
  const text = `${item.title}\n${item.domain}`
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
    console.warn('[classifier] failed to check Gemini Nano availability', err)
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

export async function classifyItems(
  items: ClassifiedItem[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
): Promise<void> {
  const uncached: ClassifiedItem[] = []
  const cached: { url: string; category: string }[] = []

  await Promise.all(
    items.map(async (item) => {
      const entry = await getCached(prefix, item.url)
      if (entry?.category) cached.push({ url: item.url, category: entry.category })
      else uncached.push(item)
    }),
  )

  if (cached.length > 0) onProgress(cached)
  if (uncached.length === 0) return

  const useNli = settings.tasks.classification.method === 'nli'
    && settings.tasks.embedding.provider === 'transformers'
  const nliModel = settings.tasks.embedding.model || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL
  if (settings.tasks.classification.method === 'nli' && !useNli) {
    console.warn('[classifier] NLI method requires embedding provider "transformers"; falling back to LLM classification')
  }

  const isWebLLM = settings.tasks.chat.provider === 'webllm'
  const systemPrompt = isWebLLM ? SYSTEM_PROMPT_JSON : SYSTEM_PROMPT
  const options = isWebLLM ? { responseFormat: 'json' as const, disableThinking: true } : {}

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (item) => {
        let category = 'Other'
        if (useNli) {
          category = await classifyItemNLI(item, nliModel)
        } else {
          const raw = await chatComplete(
            systemPrompt,
            `Title: ${item.title}\nDomain: ${item.domain}`,
            settings,
            40,
            options,
          )
          category = isWebLLM ? parseCategoryJson(raw) : (raw.trim().slice(0, 40) || 'Other')
        }
        await setCached(prefix, item.url, { category, processedAt: Date.now() })
        return { url: item.url, category }
      }),
    )
    onProgress(results)
  }
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
      if (entry?.category) map.set(item.url, entry.category)
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

  const prompt = `You are a category deduplicator. I will give you a list of category labels from browser tabs. Your job is to aggressively merge semantically similar or overlapping labels into a single canonical name. Be generous with merges — if two labels describe roughly the same topic, merge them.

Rules:
- Merge synonyms, near-duplicates, and subsets (e.g. "Tech" → "Technology", "Software Development" → "Development")
- Prefer short, widely understood names
- Keep distinct only if they describe genuinely different topics
- Reply ONLY with a JSON object mapping each input label to its canonical name. All input labels must appear as keys.

Labels:
${labels.map((label) => `- ${label}`).join('\n')}

Reply with JSON only, no explanation.`

  const raw = await chatComplete(
    'You output strict JSON only.',
    prompt,
    settings,
    300,
    settings.tasks.chat.provider === 'webllm'
      ? { responseFormat: 'json', disableThinking: true }
      : {},
  )

  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    for (const label of labels) {
      if (!(label in parsed)) parsed[label] = label
    }
    return parsed
  } catch (err) {
    console.warn('[classifier] normalizeCategoryLabels JSON parse failed, keeping original labels', err)
    return Object.fromEntries(labels.map((label) => [label, label]))
  }
}

/** Re-classifies items in categories that have too many members. */
export async function splitLargeClusters(
  items: { url: string; title: string; domain: string; category: string }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: { url: string; category: string }[]) => void,
): Promise<void> {
  const groups = new Map<string, { url: string; title: string; domain: string }[]>()
  for (const item of items) {
    if (!item.category) continue
    const bucket = groups.get(item.category) ?? []
    bucket.push(item)
    groups.set(item.category, bucket)
  }

  for (const [parentCategory, members] of groups) {
    if (members.length <= SPLIT_THRESHOLD) continue
    const isWebLLM = settings.tasks.chat.provider === 'webllm'
    const systemPrompt = isWebLLM ? SYSTEM_PROMPT_JSON : SYSTEM_PROMPT
    const options = isWebLLM ? { responseFormat: 'json' as const, disableThinking: true } : {}
    const BATCH = 5
    for (let i = 0; i < members.length; i += BATCH) {
      const batch = members.slice(i, i + BATCH)
      const updates = await Promise.all(
        batch.map(async (item) => {
          const userMsg = isWebLLM
            ? `Title: ${item.title}\nDomain: ${item.domain}\nParent: ${parentCategory}\nAssign a more specific sub-category.`
            : `Title: ${item.title}\nDomain: ${item.domain}\nCurrent category: ${parentCategory}\nAssign a more specific sub-category (2-4 words, Title Case). Reply with the label only.`
          const raw = await chatComplete(
            systemPrompt,
            userMsg,
            settings,
            40,
            options,
          )
          const category = isWebLLM
            ? (parseCategoryJson(raw) || parentCategory)
            : (raw.trim().slice(0, 40) || parentCategory)
          await setCached(prefix, item.url, { category, processedAt: Date.now() })
          return { url: item.url, category }
        }),
      )
      onProgress(updates)
    }
  }
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
): Promise<void> {
  await classifyItems(items, prefix, settings, onProgress)
}
