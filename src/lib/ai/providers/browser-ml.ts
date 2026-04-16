import { LlmProvider, type ChatMessage, type ChatOptions, type ProviderStatus, type CheckStatusOptions } from './base'
import type { LlmSettings } from '../../core/types'
import { webllmChat, isWebllmModelCached } from './webllm-provider'
import { webgpuEmbed, isTransformersEmbeddingModelCached } from './webgpu-provider'

export class BrowserMlProvider extends LlmProvider {
  readonly id = 'browser-ml'

  getChatModel(settings: LlmSettings) {
    return settings.providers.browserMl.chatModel
  }

  getEmbeddingModel(settings: LlmSettings) {
    return settings.providers.browserMl.embeddingModel
  }

  getTemperature(settings: LlmSettings): number {
    return settings.providers.browserMl.temperature
  }

  async chat(messages: ChatMessage[], settings: LlmSettings, options?: ChatOptions): Promise<string> {
    const model = this.getChatModel(settings)
    if (!model) throw new Error('No chat model selected for Browser ML')

    const systemPrompt = messages.find(m => m.role === 'system')?.content || ''
    const userMessage = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n')

    return webllmChat(systemPrompt, userMessage, model, options?.maxTokens, {
      responseFormat: (options as any).responseFormat,
      jsonSchema: (options as any).jsonSchema,
      temperature: options?.temperature ?? settings.providers.browserMl.temperature
    })
  }

  async embed(text: string, settings: LlmSettings, _signal?: AbortSignal): Promise<number[]> {
    const model = this.getEmbeddingModel(settings)
    return webgpuEmbed(text, model)
  }

  async checkStatus(settings: LlmSettings, _options?: CheckStatusOptions): Promise<ProviderStatus> {
    const chatModel = this.getChatModel(settings)
    const embedModel = this.getEmbeddingModel(settings)

    const chatCached = chatModel ? await isWebllmModelCached(chatModel) : true
    const embedCached = embedModel ? await isTransformersEmbeddingModelCached(embedModel) : true

    if (chatCached && embedCached) return { available: true, status: 'ready' }
    return { available: true, status: 'loading', message: 'Models downloading or not cached' }
  }

  async getEmbeddingDim(settings: LlmSettings): Promise<number> {
    const model = this.getEmbeddingModel(settings)
    if (model === 'Xenova/all-MiniLM-L6-v2') return 384
    return super.getEmbeddingDim(settings)
  }
}
