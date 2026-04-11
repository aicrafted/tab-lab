import { CreateMLCEngine } from '@mlc-ai/web-llm'
import type { MLCEngine } from '@mlc-ai/web-llm'

export interface WebllmChatOptions {
  responseFormat?: 'json'
  disableThinking?: boolean
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
  const baseRequest: any = {
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

  const createCompletion = (request: any) =>
    eng.chat.completions.create(request as any) as Promise<any>

  let reply: any
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

  return reply.choices[0]?.message.content?.trim() ?? ''
}

export async function preloadWebllmModel(modelId: string): Promise<void> {
  if (!modelId.trim()) throw new Error('WebLLM model ID is required')
  await getEngine(modelId)
}
