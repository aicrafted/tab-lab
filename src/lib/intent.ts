import { chatComplete } from './llm'
import { cosineSimilarity } from './embedder'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { detectPlatform, intentFromPlatform } from './platform-detection'
import { classifyIntent as classifyIntentContract } from './prompts'
import { detectStaticIntent } from './static-intent'
import { getCached, setCached } from './storage'
import type { LlmSettings, PageIntent } from './types'
import { DEFAULT_LLM_SETTINGS, DEFAULT_TRANSFORMERS_EMBEDDING_MODEL } from './types'
import { webgpuEmbed } from './webgpu-provider'

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
const intentParseMetrics = {
  strict: 0,
  fallback: 0,
}

function trackIntentParse(strict: boolean): void {
  if (strict) intentParseMetrics.strict += 1
  else intentParseMetrics.fallback += 1
  const total = intentParseMetrics.strict + intentParseMetrics.fallback
  if (total > 0 && total % 25 === 0) {
    console.info(`[intent:parse] strict=${intentParseMetrics.strict} fallback=${intentParseMetrics.fallback}`)
  }
}
const INTENT_RESPONSE_SCHEMA = {
  name: 'intent_response',
  schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: VALID_INTENTS },
    },
    required: ['intent'],
    additionalProperties: false,
  },
  strict: false,
} as const
// Rich descriptors for NLI intent classification.
// Keywords matching what page titles/domains of that intent look like.
const INTENT_DESCRIPTORS: Record<PageIntent, string> = {
  article:       'blog post tutorial guide news article essay how-to read story opinion',
  reference:     'documentation API reference docs cheatsheet specification manual MDN readthedocs',
  tool:          'dashboard editor app generator converter calculator online tool SaaS platform',
  service:       'pricing signup login register account settings product landing page',
  transactional: 'order confirmation booking receipt invoice tracking ticket payment',
  video:         'YouTube watch video stream episode channel playlist Vimeo Twitch',
  social:        'Reddit thread discussion Hacker News Twitter forum comments community',
  repository:    'GitHub GitLab repository source code npm package crates.io releases',
  document:      'PDF document spreadsheet Word Excel presentation file download',
  image:         'image photo picture PNG JPG SVG gallery wallpaper',
  audio:         'audio MP3 podcast sound music track recording',
  archive:       'archive ZIP download release DMG installer package',
  data:          'JSON XML data export database SQL dataset structured',
  code:          'source file script configuration YAML TOML CSS JavaScript TypeScript',
  other:         'miscellaneous page',
}

let intentLabelEmbeddingsPromise: Promise<Map<PageIntent, number[]>> | null = null

async function getIntentLabelEmbeddings(model: string): Promise<Map<PageIntent, number[]>> {
  if (!intentLabelEmbeddingsPromise) {
    intentLabelEmbeddingsPromise = Promise.resolve(new Map())
  }
  const existing = await intentLabelEmbeddingsPromise
  if (existing.size > 0 && model === DEFAULT_TRANSFORMERS_EMBEDDING_MODEL) return existing

  const map = new Map<PageIntent, number[]>()
  for (const intent of VALID_INTENTS) {
    map.set(intent, await webgpuEmbed(INTENT_DESCRIPTORS[intent] ?? intent, model))
  }
  if (model === DEFAULT_TRANSFORMERS_EMBEDDING_MODEL) {
    intentLabelEmbeddingsPromise = Promise.resolve(map)
  }
  return map
}

function urlPathSnippet(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    return path.slice(0, 80)
  } catch {
    return ''
  }
}

async function classifyIntentNLI(item: { url: string; title: string; domain: string }, model: string): Promise<PageIntent> {
  const path = urlPathSnippet(item.url)
  const query = await webgpuEmbed([item.title, item.domain, path].filter(Boolean).join(' '), model)
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

export type IntentUpdate = { url: string; intent: PageIntent }

export async function classifyIntent(
  items: { url: string; title: string; domain: string; staticIntent?: PageIntent }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: IntentUpdate[]) => void,
  domainMap?: Map<string, DomainInfo>,
): Promise<void> {
  const uncached: typeof items = []
  const cached: IntentUpdate[] = []

  await Promise.all(
    items.map(async (item) => {
      const staticIntent = item.staticIntent
        ?? detectStaticIntent(item.url)
        ?? intentFromPlatform(detectPlatform(item.domain, domainMap))
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

  const provider = settings.tasks.chat.provider
  const format = provider !== 'gemini-nano' ? 'json' : 'text'
  const useJsonOutput = format === 'json'
  const prompt = classifyIntentContract.system(format)
  const options = useJsonOutput
    ? {
      responseFormat: 'json' as const,
      metricKey: 'intent',
      jsonSchema: INTENT_RESPONSE_SCHEMA,
      ...(provider === 'webllm' ? { disableThinking: true } : {}),
    }
    : {}

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH)
    const results: IntentUpdate[] = []

    for (const item of batch) {
      try {
        let intent: PageIntent = 'other'
        if (useNli) {
          intent = await classifyIntentNLI(item, nliModel)
        } else {
          const path = urlPathSnippet(item.url)
          const domainDesc = domainMap ? getDomainInfo(item.domain, domainMap)?.description : undefined
          const siteLine = domainDesc ? `Site: ${domainDesc}` : undefined
          const userMsg = classifyIntentContract.user({ title: item.title, domain: item.domain, path, siteLine })
          const raw = await chatComplete(prompt, userMsg, settings, 15, options)
          if (useJsonOutput) {
            const parsed = classifyIntentContract.parseResponseDetailed(raw, format)
            trackIntentParse(parsed.strict)
            intent = parsed.intent
          } else {
            intent = classifyIntentContract.parseResponse(raw, format)
          }
        }
        const existing = await getCached(prefix, item.url)
        await setCached(prefix, item.url, {
          category: existing?.category ?? 'Other',
          parentCategory: existing?.parentCategory,
          clusterId: existing?.clusterId,
          processedAt: Date.now(),
          tags: existing?.tags,
          embedding: existing?.embedding,
          intent,
        })
        results.push({ url: item.url, intent })
      } catch (err) {
        console.warn(`[intent] skipping ${item.domain}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (results.length > 0) onProgress(results)
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
  domainMap?: Map<string, DomainInfo>,
): Promise<void> {
  await classifyIntent(items, prefix, settings, onProgress, domainMap)
}
