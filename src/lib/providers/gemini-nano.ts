import { LlmProvider, type ChatMessage, type ChatOptions, type ProviderStatus } from './base'
import type { LlmSettings } from '../types'

export class GeminiNanoProvider extends LlmProvider {
  readonly id = 'gemini-nano'

  override get supportsDomainEnrichment() {
    return false
  }

  getChatModel(_settings: LlmSettings) {
    return 'gemini-nano'
  }

  getEmbeddingModel(_settings: LlmSettings) {
    return undefined
  }

  async chat(messages: ChatMessage[], _settings: LlmSettings, options?: ChatOptions): Promise<string> {
    const win = window as any
    const LanguageModel = win.ai?.languageModel || win.ai?.assistant || win.LanguageModel
    if (!LanguageModel) throw new Error('Gemini Nano (Prompt API) not supported in this browser')

    const systemMessage = messages.find(m => m.role === 'system')?.content
    const userMessages = messages.filter(m => m.role !== 'system')
    
    // Simple join for now, Prompt API might support conversation history better in future
    const prompt = userMessages.map(m => m.content).join('\n')

    const session = await LanguageModel.create({
      systemPrompt: systemMessage,
      expectedOutputLanguage: 'en', // Required for some Chrome versions/flags
      signal: options?.signal,
      temperature: options?.temperature,
      topK: 3,
    })

    try {
      const result = await session.prompt(prompt)
      return result
    } finally {
      session.destroy()
    }
  }

  async embed(): Promise<number[]> {
    throw new Error('Gemini Nano does not support embeddings yet')
  }

  async checkStatus(): Promise<ProviderStatus> {
    const win = window as any
    const LanguageModel = win.ai?.languageModel || win.ai?.assistant || win.LanguageModel
    if (!LanguageModel) return { available: false, status: 'unsupported' }
    
    try {
      const capabilities = await LanguageModel.capabilities()
      return { 
        available: capabilities.available !== 'no', 
        status: capabilities.available === 'readily' ? 'ready' : 'loading' 
      }
    } catch {
      return { available: false, status: 'unavailable' }
    }
  }
}
