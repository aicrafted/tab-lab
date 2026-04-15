import { LlmProvider, type ChatMessage, type ChatOptions, type ProviderStatus } from './base'
import type { LlmSettings } from '../types'

async function fetchRemote(
  text: string,
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
    ...(isEmbed ? { input: text } : extraBody),
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
        temperature: options?.temperature ?? 0.1,
        ...(options as any).responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}
      },
      options?.signal
    )

    return data.choices[0]?.message?.content?.trim() ?? ''
  }

  async embed(text: string, settings: LlmSettings, signal?: AbortSignal): Promise<number[]> {
    const model = this.getEmbeddingModel(settings)
    if (!model) throw new Error(`No embedding model selected for ${this.id}`)

    const data = await fetchRemote(
      text,
      this.getBaseUrl(settings),
      this.getApiKey(settings),
      model,
      'embeddings',
      {},
      signal
    )

    return data.data[0].embedding
  }

  async checkStatus(settings: LlmSettings): Promise<ProviderStatus> {
    const url = this.getBaseUrl(settings)
    if (!url) return { available: false, status: 'unavailable', message: 'Base URL not configured' }
    return { available: true, status: 'ready' }
  }
}

export class LmStudioProvider extends OpenAiCompatibleProvider {
  readonly id = 'lmstudio'
  getChatModel(settings: LlmSettings) { return settings.providers.lmstudio.chatModel }
  getEmbeddingModel(settings: LlmSettings) { return settings.providers.lmstudio.embeddingModel }
  protected getBaseUrl(settings: LlmSettings) { return settings.providers.lmstudio.baseUrl }
  protected getApiKey(settings: LlmSettings) { return settings.providers.lmstudio.apiKey }
}

export class OpenRouterProvider extends OpenAiCompatibleProvider {
  readonly id = 'openrouter'
  getChatModel(settings: LlmSettings) { return settings.providers.openrouter.chatModel }
  getEmbeddingModel(settings: LlmSettings) { return settings.providers.openrouter.embeddingModel }
  protected getBaseUrl(_settings: LlmSettings) { return 'https://openrouter.ai/api/v1' }
  protected getApiKey(settings: LlmSettings) { return settings.providers.openrouter.apiKey }
}
