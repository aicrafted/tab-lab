import { LlmProvider, type ChatMessage, type ChatOptions, type ProviderStatus, type CheckStatusOptions } from './base'
import type { LlmSettings } from '../../core/types'

async function fetchRemote(
  input: string | string[],
  baseUrl: string,
  apiKey: string,
  model: string,
  endpoint: 'chat/completions' | 'embeddings',
  extraBody: Record<string, any> = {},
  signal?: AbortSignal
) {
  const isEmbed = endpoint === 'embeddings'
  const body = JSON.stringify({
    model,
    ...(isEmbed ? { input } : extraBody),
  })

  const res = await fetch(`${baseUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body,
    signal,
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => '')
    throw new Error(`OpenAI-Compatible API ${res.status}: ${errorText}`)
  }
  return res.json()
}

export abstract class OpenAiCompatibleProvider extends LlmProvider {
  protected abstract getBaseUrl(settings: LlmSettings): string
  protected abstract getApiKey(settings: LlmSettings): string
  abstract getTemperature(settings: LlmSettings): number

  async chat(messages: ChatMessage[], settings: LlmSettings, options?: ChatOptions): Promise<string> {
    const model = this.getChatModel(settings)
    if (!model) throw new Error(`No chat model selected for ${this.id}`)

    const systemMessage = messages.find(m => m.role === 'system')?.content
    const userMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))

    const messagesToSent = systemMessage 
      ? [{ role: 'system', content: systemMessage }, ...userMessages]
      : userMessages

    const data = await fetchRemote(
      '',
      this.getBaseUrl(settings),
      this.getApiKey(settings),
      model,
      'chat/completions',
      {
        messages: messagesToSent,
        max_tokens: options?.maxTokens,
        temperature: options?.temperature ?? this.getTemperature(settings),
        ...(options?.jsonSchema ? {
          response_format: { 
            type: 'json_schema', 
            json_schema: { 
              name: options.jsonSchema.name, 
              schema: options.jsonSchema.schema,
              strict: options.jsonSchema.strict 
            } 
          }
        } : {})
      },
      options?.signal
    )

    return data.choices[0]?.message?.content?.trim() ?? ''
  }

  async embed(text: string, settings: LlmSettings, signal?: AbortSignal): Promise<number[]> {
    const results = await this.embedBatch([text], settings, signal)
    return results[0]
  }

  async embedBatch(texts: string[], settings: LlmSettings, signal?: AbortSignal): Promise<number[][]> {
    const url = this.getBaseUrl(settings)
    const model = this.getEmbeddingModel(settings)
    if (!url || !model) return []

    const maxRetries = 10 
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(`${url}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.getApiKey(settings) ? { Authorization: `Bearer ${this.getApiKey(settings)}` } : {}),
          },
          body: JSON.stringify({ model, input: texts }),
          signal,
        })

        if (res.status === 500 && attempt < maxRetries - 1) {
          // Model likely loading, wait and retry
          const delay = 2000 + attempt * 1000
          console.warn(`[AI] Embedding model loading (500), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }

        if (!res.ok) {
          throw new Error(`Embedding failed: ${res.status} ${res.statusText}`)
        }

        const data = await res.json()
        const sorted = [...data.data].sort((a: any, b: any) => a.index - b.index)
        return sorted.map((item: any) => item.embedding)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        }
      }
    }

    throw lastError || new Error('Embedding failed after retries')
  }

  async checkStatus(settings: LlmSettings, _options?: CheckStatusOptions): Promise<ProviderStatus> {
    const url = this.getBaseUrl(settings)
    if (!url) return { available: false, status: 'unavailable', message: 'Base URL not configured' }

    try {
      // Basic connectivity check: ping /models
      const res = await fetch(`${url}/models`, {
        method: 'GET',
        headers: this.getApiKey(settings) ? { Authorization: `Bearer ${this.getApiKey(settings)}` } : {},
        signal: AbortSignal.timeout(3000),
      })

      if (!res.ok) {
        return { available: false, status: 'unavailable', message: `Server returned ${res.status}` }
      }

      const data = await res.json()
      const chatModel = this.getChatModel(settings)
      if (chatModel) {
        const exists = data.data?.some((m: any) => m.id === chatModel)
        if (!exists) {
          return { available: false, status: 'unavailable', message: `Model "${chatModel}" not found on server` }
        }
      }

      return { available: true, status: 'ready' }
    } catch (err) {
      return {
        available: false,
        status: 'unavailable',
        message: err instanceof Error ? err.message : 'Connection failed',
      }
    }
  }
}

export class LmStudioProvider extends OpenAiCompatibleProvider {
  readonly id = 'lmstudio'
  getChatModel(settings: LlmSettings) { return settings.providers.lmstudio.chatModel }
  getEmbeddingModel(settings: LlmSettings) { return settings.providers.lmstudio.embeddingModel }
  getTemperature(settings: LlmSettings) { return settings.providers.lmstudio.temperature }
  protected getBaseUrl(settings: LlmSettings) { return settings.providers.lmstudio.baseUrl }
  protected getApiKey(settings: LlmSettings) { return settings.providers.lmstudio.apiKey }

  async checkStatus(settings: LlmSettings, options?: CheckStatusOptions): Promise<ProviderStatus> {
    const baseStatus = await super.checkStatus(settings, options)
    if (!baseStatus.available || baseStatus.status === 'unavailable') return baseStatus

    // If we only need a light check (e.g. for Settings UI), stop here.
    if (!options?.deep) return baseStatus

    const model = this.getChatModel(settings)
    if (!model) return baseStatus

    try {
      // LM Studio specific: check if model is actually ready/loaded
      // We send a minimal request. If it's auto-loading, it will wait or return 500.
      const res = await fetch(`${this.getBaseUrl(settings)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.getApiKey(settings) ? { Authorization: `Bearer ${this.getApiKey(settings)}` } : {}),
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: '' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(25000), // Wait up to 25s for readiness
      })

      if (res.ok) return { available: true, status: 'ready' }
      if (res.status === 500) {
        const text = await res.text().catch(() => '')
        return { 
          available: true, 
          status: 'loading', 
          message: text.includes('loading') ? 'Model is currently loading...' : 'Model not loaded or busy' 
        }
      }
      return { available: false, status: 'unavailable', message: `Model error ${res.status}` }
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        return { available: true, status: 'loading', message: 'Readiness check timed out (model might be loading)' }
      }
      return { available: false, status: 'unavailable', message: 'LM Studio unreachable or busy' }
    }
  }
}

export class OpenRouterProvider extends OpenAiCompatibleProvider {
  readonly id = 'openrouter'
  getChatModel(settings: LlmSettings) { return settings.providers.openrouter.chatModel }
  getEmbeddingModel(settings: LlmSettings) { return settings.providers.openrouter.embeddingModel }
  getTemperature(settings: LlmSettings) { return settings.providers.openrouter.temperature }
  protected getBaseUrl(_settings: LlmSettings) { return 'https://openrouter.ai/api/v1' }
  protected getApiKey(settings: LlmSettings) { return settings.providers.openrouter.apiKey }
}
