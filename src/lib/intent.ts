import { chatComplete } from './llm'
import { getEmbeddingProvider } from './providers/factory'
import { cosineSimilarity } from './embedder'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { detectPlatform, intentFromPlatform } from './platform-detection'
import { classifyIntent as classifyIntentContract } from './prompts'
import { detectStaticIntent } from './static-intent'
import { getCached, setCached } from './storage'
import { DEFAULT_LLM_SETTINGS, INTENT_DESCRIPTORS, PAGE_INTENTS, type LlmSettings, type PageIntent } from './types'

const VALID_INTENTS: readonly PageIntent[] = PAGE_INTENTS
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

let intentLabelEmbeddingsPromise: Promise<Map<PageIntent, number[]>> | null = null

async function getIntentLabelEmbeddings(
  settings: LlmSettings,
  signal?: AbortSignal,
): Promise<Map<PageIntent, number[]>> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  const model = provider.getEmbeddingModel(settings) || 'default'

  if (!intentLabelEmbeddingsPromise) {
    intentLabelEmbeddingsPromise = Promise.resolve(new Map())
  }
  const existing = await intentLabelEmbeddingsPromise
  if (existing.size > 0 && model === 'default') return existing

  const map = new Map<PageIntent, number[]>()
  for (const intent of VALID_INTENTS) {
    if (signal?.aborted) throw new Error('Aborted')
    map.set(intent, await provider.embed(INTENT_DESCRIPTORS[intent] ?? intent, settings, signal))
  }
  if (model === 'default') {
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

async function classifyIntentNLI(
  item: { url: string; title: string; domain: string },
  settings: LlmSettings,
  signal?: AbortSignal,
): Promise<PageIntent> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  const path = urlPathSnippet(item.url)
  const query = await provider.embed([item.title, item.domain, path].filter(Boolean).join(' '), settings, signal)
  const labels = await getIntentLabelEmbeddings(settings, signal)
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
  signal?: AbortSignal,
): Promise<void> {
  const uncached: typeof items = []
  const cached: IntentUpdate[] = []

  await Promise.all(
    items.map(async (item) => {
      const staticIntent = item.staticIntent
        ?? detectStaticIntent(item.url)
        ?? intentFromPlatform(detectPlatform(item.domain, domainMap), item.url)
      if (staticIntent) return
      const entry = await getCached(prefix, item.url)
      if (entry?.intent) cached.push({ url: item.url, intent: entry.intent })
      else uncached.push(item)
    }),
  )

  if (cached.length > 0) onProgress(cached)
  if (uncached.length === 0) return

  const embedProviderId = settings.tasks.embedding.provider
  const embedProvider = getEmbeddingProvider(embedProviderId)
  const useNli = embedProvider.getClassificationMethod(settings) === 'nli'

  const provider = settings.tasks.chat.provider
  const format = 'json' as const
  const useJsonOutput = true
  const prompt = classifyIntentContract.system(format)
  const options = {
    responseFormat: 'json' as const,
    metricKey: 'intent',
    jsonSchema: INTENT_RESPONSE_SCHEMA,
    ...(provider === 'browser-ml' ? { disableThinking: true } : {}),
  }

  const BATCH = 5
  for (let i = 0; i < uncached.length; i += BATCH) {
    if (signal?.aborted) throw new Error('Aborted')
    const batch = uncached.slice(i, i + BATCH)
    const results: IntentUpdate[] = []

    for (const item of batch) {
      try {
        let intent: PageIntent = 'other'
        if (useNli) {
          intent = await classifyIntentNLI(item, settings, signal)
        } else {
          const path = urlPathSnippet(item.url)
          const domainDesc = domainMap ? getDomainInfo(item.domain, domainMap)?.description : undefined
          const siteLine = domainDesc ? `Site: ${domainDesc}` : undefined
          const userMsg = classifyIntentContract.user({ title: item.title, domain: item.domain, path, siteLine })
          const raw = await chatComplete(prompt, userMsg, settings, 15, { ...options, signal })
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
  signal?: AbortSignal,
): Promise<void> {
  await classifyIntent(
    items,
    prefix,
    {
      ...DEFAULT_LLM_SETTINGS,
      tasks: {
        ...DEFAULT_LLM_SETTINGS.tasks,
        chat: { provider: 'gemini-nano' },
        embedding: { provider: 'browser-ml' },
      },
    },
    onProgress,
    undefined,
    signal,
  )
}

export async function classifyIntentLmStudio(
  items: { url: string; title: string; domain: string; staticIntent?: PageIntent }[],
  prefix: 'tab' | 'bm',
  settings: LlmSettings,
  onProgress: (updates: IntentUpdate[]) => void,
  domainMap?: Map<string, DomainInfo>,
  signal?: AbortSignal,
): Promise<void> {
  await classifyIntent(items, prefix, settings, onProgress, domainMap, signal)
}
