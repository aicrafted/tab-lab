import { CreateMLCEngine } from '@mlc-ai/web-llm'
import { hasModelInCache } from '@mlc-ai/web-llm'
import type { MLCEngine } from '@mlc-ai/web-llm'

export interface WebllmChatOptions {
  responseFormat?: 'json'
  disableThinking?: boolean
}

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

interface CompletionRequest {
  messages: ChatMessage[]
  max_tokens: number
  temperature: number
  extra_body?: {
    enable_thinking: boolean
  }
  response_format?: {
    type: 'json_object'
  }
}

interface CompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

// Some WebLLM runtimes throw BindingError in GrammarCompiler.CompileJSONSchema
// when response_format is used. Keep this off for stability.
const WEBLLM_JSON_MODE_ENABLED = false

let engine: MLCEngine | null = null
let currentModel = ''

async function getEngine(modelId: string): Promise<MLCEngine> {
  if (engine && currentModel === modelId) return engine
  engine = null
  currentModel = ''
  engine = await CreateMLCEngine(modelId)
  currentModel = modelId
  return engine
}

export async function webllmChat(
  systemPrompt: string,
  userMessage: string,
  modelId: string,
  maxTokens = 40,
  options: WebllmChatOptions = {},
): Promise<string> {
  const eng = await getEngine(modelId)
  const baseRequest: CompletionRequest = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: maxTokens,
    temperature: 0.1,
    ...(options.disableThinking
      ? { extra_body: { enable_thinking: false } }
      : {}),
  }

  const createCompletion = (request: CompletionRequest): Promise<CompletionResponse> =>
    eng.chat.completions.create(request as unknown as never) as Promise<CompletionResponse>

  let reply: CompletionResponse
  if (options.responseFormat === 'json' && WEBLLM_JSON_MODE_ENABLED) {
    try {
      reply = await createCompletion({
        ...baseRequest,
        response_format: { type: 'json_object' as const },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const schemaCompileFailure =
        message.includes('CompileJSONSchema') ||
        message.includes('Cannot pass non-string to std::string') ||
        message.includes('BindingError')

      if (!schemaCompileFailure) throw err

      console.warn('[webllm] JSON mode not supported by this runtime/model, retrying without response_format', {
        modelId,
        error: message,
      })
      reply = await createCompletion(baseRequest)
    }
  } else {
    reply = await createCompletion(baseRequest)
  }

  return reply.choices?.[0]?.message?.content?.trim() ?? ''
}

export async function preloadWebllmModel(modelId: string): Promise<void> {
  if (!modelId.trim()) throw new Error('WebLLM model ID is required')
  await getEngine(modelId)
}

export async function isWebllmModelCached(modelId: string): Promise<boolean> {
  const normalized = modelId.trim()
  if (!normalized) return false
  try {
    return await hasModelInCache(normalized)
  } catch (err) {
    console.warn('[webllm] failed to check model cache status', { modelId: normalized, err })
    return false
  }
}
