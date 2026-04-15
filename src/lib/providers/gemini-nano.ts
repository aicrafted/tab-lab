import { LlmProvider, type ChatMessage, type ChatOptions, type ProviderStatus } from './base'
import type { LlmSettings, ClassificationMethod } from '../types'

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

  getClassificationMethod(_settings: LlmSettings): ClassificationMethod {
    return 'llm'
  }
  
  getTemperature(settings: LlmSettings): number {
    return settings.providers.geminiNano.temperature
  }

  /** 
   * Finds the Prompt API factory in various places (browser specs changed multiple times).
   */
  private getPromptApi() {
    const win = window as any
    return win.ai?.languageModel || win.ai?.assistant || win.ai || win.LanguageModel
  }

  async chat(messages: ChatMessage[], _settings: LlmSettings, options?: ChatOptions): Promise<string> {
    const LanguageModel = this.getPromptApi()
    if (!LanguageModel || (!LanguageModel.create && !LanguageModel.languageModel?.create)) {
      throw new Error('Gemini Nano (Prompt API) not supported or not enabled in this browser')
    }

    const systemMessage = messages.find(m => m.role === 'system')?.content
    const userMessages = messages.filter(m => m.role !== 'system')
    const prompt = userMessages.map(m => m.content).join('\n')

    // Handle both window.ai.languageModel.create and window.ai.create (older)
    const factory = LanguageModel.create ? LanguageModel : LanguageModel.languageModel
    const createOptions: any = {
      expectedLanguage: 'en',
      expectedOutputLanguage: 'en',
      monitor(m: any) {
        m.addEventListener('downloadprogress', (e: any) => {
          console.debug(`[gemini-nano] download progress: ${e.loaded}/${e.total}`)
        })
      },
    }

    if (systemMessage) createOptions.systemPrompt = systemMessage
    if (options?.signal) createOptions.signal = options.signal

    // Spec says: must specify both topK and temperature, or neither
    // To ensure consistency, we now ALWAYS pass both, using values from settings by default.
    createOptions.temperature = options?.temperature ?? _settings.providers.geminiNano.temperature
    createOptions.topK = options?.topK ?? 3

    console.debug('[gemini-nano] creating session with options:', {
      ...createOptions,
      systemPrompt: createOptions.systemPrompt ? `(length: ${createOptions.systemPrompt.length})` : 'none',
      signal: createOptions.signal ? 'present' : 'none',
      monitor: createOptions.monitor ? 'present' : 'none'
    })

    const session = await factory.create(createOptions)

    try {
      const result = await session.prompt(prompt, {
        responseConstraint: options?.jsonSchema?.schema,
      })
      return result
    } finally {
      session.destroy()
    }
  }

  async embed(_text: string, _settings: LlmSettings, _signal?: AbortSignal): Promise<number[]> {
    throw new Error('Gemini Nano does not support embeddings yet')
  }

  async checkStatus(_settings: LlmSettings): Promise<ProviderStatus> {
    const api = this.getPromptApi()
    if (!api) return { available: false, status: 'unsupported', message: 'API not found' }
    
    try {
      const options = { expectedLanguage: 'en', expectedOutputLanguage: 'en' }
      // Try capabilities/availability on the api or its sub-property
      const checkFn = api.capabilities || api.availability || api.languageModel?.capabilities || api.languageModel?.availability
      
      if (!checkFn) {
        return { available: false, status: 'unsupported', message: 'Capabilities check method not found' }
      }

      const caps = await checkFn.call(api.create ? api : api.languageModel || api, options)
      
      const availableStatus = typeof caps === 'string' ? caps : caps?.available
      const isReady = availableStatus === 'readily' || availableStatus === 'available'
      const isPending = availableStatus === 'after-download' || availableStatus === 'downloading'
      
      return { 
        available: availableStatus !== 'no', 
        status: isReady ? 'ready' : (isPending ? 'loading' : 'unavailable'),
        message: `API: ${availableStatus || 'unknown'}`
      }
    } catch (err) {
      console.error('[gemini-nano] checkStatus failed', err)
      return { 
        available: false, 
        status: 'unavailable', 
        message: err instanceof Error ? err.message : String(err) 
      }
    }
  }
}
