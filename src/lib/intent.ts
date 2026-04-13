import { chatComplete, extractJson } from './llm'
import { cosineSimilarity } from './embedder'
import { detectStaticIntent } from './static-intent'
import { getCached, setCached } from './storage'
import type { LlmSettings, PageIntent } from './types'
import { DEFAULT_LLM_SETTINGS, DEFAULT_TRANSFORMERS_EMBEDDING_MODEL } from './types'
import { webgpuEmbed } from './webgpu-provider'

const INTENT_PROMPT = `You classify web pages by their intent — how the user is meant to use them.

Choose ONE label from:
- article       : blog post, tutorial, news article, essay — meant to be read linearly, has a clear ending
- reference     : documentation, API reference, man page, cheatsheet, specification — consulted repeatedly
- tool          : web app, dashboard, SaaS product, online editor, IDE — used interactively
- service       : product landing page, signup/login page, account settings, pricing — functional but not a tool
- transactional : order confirmation, booking, ticket, tracking page, invoice, support ticket — time-sensitive, discard after done
- video         : YouTube, Vimeo, Twitch, podcast page — primary content is video/audio
- social        : Reddit thread, Hacker News, Twitter/X post, forum thread, comment section
- repository    : GitHub/GitLab repo, npm/crates.io/PyPI package page
- other         : anything that doesn't fit clearly

Reply with the single label only. No explanation.`
const INTENT_PROMPT_JSON = `You classify web pages by their intent. Output a JSON object with a single "intent" key.

Valid values: "article", "reference", "tool", "service", "transactional", "video", "social", "repository", "other"

- article: blog post, tutorial, news - read linearly
- reference: docs, API, cheatsheet - consulted repeatedly
- tool: web app, SaaS, dashboard - used interactively
- service: product page, signup, settings - functional
- transactional: order, booking, tracking - time-sensitive
- video: YouTube, Vimeo, Twitch - primary content is video
- social: Reddit, HN, Twitter, forum - conversational
- repository: GitHub, npm, crates.io - code asset
- other: anything else

Example output: {"intent": "reference"}`

const VALID_INTENTS: PageIntent[] = [
  'article',
  'reference',
  'tool',
  'service',
  'transactional',
  'video',
  'social',
  'repository',
  'other',
]
let intentLabelEmbeddingsPromise: Promise<Map<PageIntent, number[]>> | null = null

async function getIntentLabelEmbeddings(model: string): Promise<Map<PageIntent, number[]>> {
  if (!intentLabelEmbeddingsPromise) {
    intentLabelEmbeddingsPromise = Promise.resolve(new Map())
  }
  const existing = await intentLabelEmbeddingsPromise
  if (existing.size > 0 && model === DEFAULT_TRANSFORMERS_EMBEDDING_MODEL) return existing

  const map = new Map<PageIntent, number[]>()
  for (const intent of VALID_INTENTS) {
    map.set(intent, await webgpuEmbed(`Intent label: ${intent}. Browser page usage mode.`, model))
  }
  if (model === DEFAULT_TRANSFORMERS_EMBEDDING_MODEL) {
    intentLabelEmbeddingsPromise = Promise.resolve(map)
  }
  return map
}

async function classifyIntentNLI(item: { title: string; domain: string }, model: string): Promise<PageIntent> {
  const query = await webgpuEmbed(`${item.title}\n${item.domain}`, model)
  const labels = await getIntentLabelEmbeddings(model)
  let bestIntent: PageIntent = 'other'
  let bestScore = -Infinity

  for (const [intent, embedding] of labels.entries()) {
    const score = cosineSimilarity(query, embedding)
    if (score > bestScore) {
      bestScore = score
      bestIntent = intent
    }
  }

  return bestIntent
}

function parseIntent(raw: string): PageIntent {
  const normalized = raw.trim().toLowerCase()
  return VALID_INTENTS.find((intent) => normalized.includes(intent)) ?? 'other'
}

function parseIntentJson(raw: string): PageIntent {
  try {
    const parsed = JSON.parse(extractJson(raw)) as { intent?: unknown }
    if (typeof parsed.intent === 'string') {
      return VALID_INTENTS.find((intent) => intent === parsed.intent) ?? 'other'
    }
  } catch {
  }
  return parseIntent(raw)
}

export type IntentUpdate = { url: string; intent: PageIntent }

export async function classifyIntent(
  items: { url: string; title: string; domain: string; staticIntent?: PageIntent }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: IntentUpdate[]) => void,
): Promise<void> {
  const uncached: typeof items = []
  const cached: IntentUpdate[] = []

  await Promise.all(
    items.map(async (item) => {
      const staticIntent = item.staticIntent ?? detectStaticIntent(item.url)
      if (staticIntent) return
      const entry = await getCached(prefix, item.url)
      if (entry?.intent) cached.push({ url: item.url, intent: entry.intent })
      else uncached.push(item)
    }),
  )

  if (cached.length > 0) onProgress(cached)
  if (uncached.length === 0) return

  const useNli = settings.tasks.classification.method === 'nli'
    && settings.tasks.embedding.provider === 'transformers'
  const nliModel = settings.tasks.embedding.model || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL
  if (settings.tasks.classification.method === 'nli' && !useNli) {
    console.warn('[intent] NLI method requires embedding provider "transformers"; falling back to LLM intent classification')
  }

  const isWebLLM = settings.tasks.chat.provider === 'webllm'
  const prompt = isWebLLM ? INTENT_PROMPT_JSON : INTENT_PROMPT
  const options = isWebLLM ? { responseFormat: 'json' as const, disableThinking: true } : {}

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (item) => {
        let intent: PageIntent = 'other'
        if (useNli) {
          intent = await classifyIntentNLI(item, nliModel)
        } else {
          const raw = await chatComplete(
            prompt,
            `Title: ${item.title}\nDomain: ${item.domain}`,
            settings,
            15,
            options,
          )
          intent = isWebLLM ? parseIntentJson(raw) : parseIntent(raw)
        }
        const existing = await getCached(prefix, item.url)
        await setCached(prefix, item.url, {
          category: existing?.category ?? 'Other',
          processedAt: Date.now(),
          tags: existing?.tags,
          embedding: existing?.embedding,
          intent,
        })
        return { url: item.url, intent }
      }),
    )
    onProgress(results)
  }
}

export async function classifyIntentGeminiNano(
  items: { url: string; title: string; domain: string; staticIntent?: PageIntent }[],
  prefix: 'tab' | 'bm',
  onProgress: (updates: IntentUpdate[]) => void,
): Promise<void> {
  await classifyIntent(
    items,
    prefix,
    {
      ...DEFAULT_LLM_SETTINGS,
      tasks: {
        ...DEFAULT_LLM_SETTINGS.tasks,
        chat: { provider: 'gemini-nano', model: '' },
        embedding: { provider: 'transformers', model: '' },
        classification: { method: 'llm' },
      },
    },
    onProgress,
  )
}

export async function classifyIntentLmStudio(
  items: { url: string; title: string; domain: string; staticIntent?: PageIntent }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: IntentUpdate[]) => void,
): Promise<void> {
  await classifyIntent(items, prefix, settings, onProgress)
}
