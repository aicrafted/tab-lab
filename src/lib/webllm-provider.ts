import { CreateMLCEngine } from '@mlc-ai/web-llm'
import { hasModelInCache } from '@mlc-ai/web-llm'
import { prebuiltAppConfig } from '@mlc-ai/web-llm'
import type { MLCEngine } from '@mlc-ai/web-llm'
import { patchRequestAdapterForWindows } from './webgpu-compat'

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
    // WebLLM requires schema as a JSON Schema string; undefined causes a WASM BindingError
    // in GrammarCompiler.CompileJSONSchema. Use '{}' for unconstrained JSON objects.
    schema: string
  }
}

interface CompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

const WEBLLM_JSON_MODE_ENABLED = true

let engine: MLCEngine | null = null
let currentModel = ''
const SUPPORTED_WEBLLM_MODELS = new Set(prebuiltAppConfig.model_list.map((model) => model.model_id))

function ensureSupportedWebllmModel(modelId: string): void {
  if (!SUPPORTED_WEBLLM_MODELS.has(modelId)) {
    throw new Error(`Unsupported WebLLM model id: ${modelId}. Choose a model from the built-in list.`)
  }
}

async function getEngine(modelId: string): Promise<MLCEngine> {
  patchRequestAdapterForWindows()
  ensureSupportedWebllmModel(modelId)
  if (engine && currentModel === modelId) return engine
  engine = null
  currentModel = ''
  try {
    engine = await CreateMLCEngine(modelId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const short = message.split('\n')[0] || 'Unknown WebLLM initialization error'
    throw new Error(`Failed to initialize WebLLM model "${modelId}": ${short}`)
  }
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
        response_format: { type: 'json_object' as const, schema: '{}' },
      })
    } catch (err) {
      // Use String(err) so the error type prefix (e.g. "BindingError: ...") is included —
      // err.message alone strips it when BindingError extends Error.
      const full = String(err)
      const isWasmGrammarError =
        full.includes('BindingError') ||
        full.includes('CompileJSONSchema') ||
        full.includes('VectorInt')

      if (!isWasmGrammarError) throw err

      console.warn('[webllm] grammar-constrained JSON not supported by this runtime, retrying without response_format', {
        modelId,
        error: full,
      })
      reply = await createCompletion(baseRequest)
    }
  } else {
    reply = await createCompletion(baseRequest)
  }

  const raw = reply.choices?.[0]?.message?.content ?? ''
  return stripThinkBlocks(raw).trim()
}

function stripThinkBlocks(text: string): string {
  // Remove <think>...</think> blocks (including multiline) produced by reasoning models like Qwen
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '')
}

export async function preloadWebllmModel(modelId: string): Promise<void> {
  const normalized = modelId.trim()
  if (!normalized) throw new Error('WebLLM model ID is required')
  await getEngine(normalized)
}

export async function isWebllmModelCached(modelId: string): Promise<boolean> {
  const normalized = modelId.trim()
  if (!normalized) return false
  if (!SUPPORTED_WEBLLM_MODELS.has(normalized)) return false
  try {
    return await hasModelInCache(normalized)
  } catch (err) {
    console.warn('[webllm] failed to check model cache status', { modelId: normalized, err })
    return false
  }
}
