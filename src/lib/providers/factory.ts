import type { ChatProvider, EmbeddingProvider } from '../types'
import type { LlmProvider } from './base'
import { GeminiNanoProvider } from './gemini-nano'
import { BrowserMlProvider } from './browser-ml'
import { LmStudioProvider, OpenRouterProvider } from './openai-compatible'

const providers: Record<string, LlmProvider> = {
  'gemini-nano': new GeminiNanoProvider(),
  'browser-ml': new BrowserMlProvider(),
  'lmstudio': new LmStudioProvider(),
  'openrouter': new OpenRouterProvider(),
}

export function getChatProvider(id: ChatProvider): LlmProvider {
  const p = providers[id]
  if (!p) throw new Error(`Unknown chat provider: ${id}`)
  return p
}

export function getEmbeddingProvider(id: EmbeddingProvider): LlmProvider {
  const p = providers[id]
  if (!p) throw new Error(`Unknown embedding provider: ${id}`)
  return p
}
