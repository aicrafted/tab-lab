import type { LlmSettings, ClassificationMethod } from '../../core/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  responseFormat?: 'json'
  jsonSchema?: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
  topK?: number
}

export interface ProviderStatus {
  available: boolean
  status: 'ready' | 'loading' | 'unavailable' | 'unsupported'
  message?: string
}

export interface CheckStatusOptions {
  /** 
   * If true, performs a deeper check that might trigger model loading or warm-up.
   * Useful before starting intensive tasks.
   */
  deep?: boolean
}

export abstract class LlmProvider {
  /** Unique ID for the provider (e.g. 'gemini-nano', 'lmstudio'). */
  abstract readonly id: string

  /** Whether the provider is powerful enough for deep domain knowledge extraction. */
  get supportsDomainEnrichment(): boolean {
    return true
  }

  /** Returns the chat model name for this provider from settings */
  abstract getChatModel(settings: LlmSettings): string | undefined

  /** Returns the embedding model name for this provider from settings */
  abstract getEmbeddingModel(settings: LlmSettings): string | undefined

  /** Returns the temperature for this provider from settings */
  abstract getTemperature(settings: LlmSettings): number

  abstract chat(
    messages: ChatMessage[],
    settings: LlmSettings,
    options?: ChatOptions
  ): Promise<string>

  abstract embed(
    text: string,
    settings: LlmSettings,
    signal?: AbortSignal
  ): Promise<number[]>

  abstract checkStatus(
    settings: LlmSettings, 
    options?: CheckStatusOptions
  ): Promise<ProviderStatus>

  /** Get embedding dimension for current settings. Might perform a dummy embed. */
  async getEmbeddingDim(settings: LlmSettings): Promise<number> {
    const model = this.getEmbeddingModel(settings)
    if (!model) return 0
    try {
      const vec = await this.embed('dim_check', settings)
      return vec.length
    } catch {
      return 0
    }
  }

  /** Optional: specific NLI classification if supported natively or via prompt */
  async classify(
    _text: string,
    _labels: string[],
    _settings: LlmSettings,
    _method: ClassificationMethod
  ): Promise<Record<string, number>> {
    throw new Error('NLI classification not implemented for this provider')
  }
}
