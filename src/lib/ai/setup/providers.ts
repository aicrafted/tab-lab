import { getChatProvider, getEmbeddingProvider } from '@/lib/ai/providers/factory'
import { isTransformersEmbeddingModelCached } from '@/lib/ai/providers/webgpu-provider'
import { aiPipelineLog } from '@/lib/core/logger'
import type { LlmSettings } from '@/lib/core/types'
import type { ProviderCapabilityState, ResolveAiSetupOptions } from './types'

function mapProviderStatus(status: 'ready' | 'loading' | 'unavailable' | 'unsupported'): ProviderCapabilityState['status'] {
  if (status === 'ready') return 'ready'
  if (status === 'loading') return 'loading'
  if (status === 'unsupported') return 'unsupported'
  return 'unavailable'
}

export async function checkChatCapability(
  settings: LlmSettings,
  options?: ResolveAiSetupOptions,
): Promise<ProviderCapabilityState> {
  const providerId = settings.tasks.chat.provider
  try {
    const provider = getChatProvider(providerId)
    const model = provider.getChatModel(settings) ?? ''
    const configured = Boolean(model)

    if (!configured) {
      return {
        provider: providerId,
        model,
        configured: false,
        status: 'unavailable',
        message: 'Chat model is not selected',
      }
    }

    const status = await provider.checkStatus(settings, { deep: options?.deep })
    return {
      provider: providerId,
      model,
      configured,
      status: mapProviderStatus(status.status),
      message: status.message,
    }
  } catch (err) {
    aiPipelineLog.warn('failed to check chat capability', { provider: providerId, err })
    return {
      provider: providerId,
      model: '',
      configured: false,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function checkEmbeddingCapability(
  settings: LlmSettings,
  options?: ResolveAiSetupOptions,
): Promise<ProviderCapabilityState> {
  const providerId = settings.tasks.embedding.provider
  try {
    const provider = getEmbeddingProvider(providerId)
    const model = provider.getEmbeddingModel(settings) ?? ''
    const configured = Boolean(model)

    if (!configured) {
      return {
        provider: providerId,
        model,
        configured: false,
        status: 'unavailable',
        message: 'Embedding model is not selected',
      }
    }

    if (providerId === 'browser-ml') {
      const cached = await isTransformersEmbeddingModelCached(model)
      return {
        provider: providerId,
        model,
        configured: true,
        status: cached ? 'ready' : 'loading',
        message: cached ? undefined : 'Embedding model downloading or not cached',
      }
    }

    if (providerId === 'lmstudio') {
      const { baseUrl, apiKey } = settings.providers.lmstudio
      const res = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: options?.signal ?? AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        return {
          provider: providerId,
          model,
          configured: true,
          status: 'unavailable',
          message: `Server returned ${res.status}`,
        }
      }
      const data = await res.json() as { data?: Array<{ id?: string }> }
      const exists = Boolean(data.data?.some((m) => m.id === model))
      return {
        provider: providerId,
        model,
        configured: true,
        status: exists ? 'ready' : 'unavailable',
        message: exists ? undefined : `Model "${model}" not found on server`,
      }
    }

    if (providerId === 'openrouter') {
      const { apiKey } = settings.providers.openrouter
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: options?.signal ?? AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        return {
          provider: providerId,
          model,
          configured: true,
          status: 'unavailable',
          message: `Server returned ${res.status}`,
        }
      }
      const data = await res.json() as { data?: Array<{ id?: string }> }
      const exists = Boolean(data.data?.some((m) => m.id === model))
      return {
        provider: providerId,
        model,
        configured: true,
        status: exists ? 'ready' : 'unavailable',
        message: exists ? undefined : `Model "${model}" not found on server`,
      }
    }

    const status = await provider.checkStatus(settings, { deep: options?.deep })
    return {
      provider: providerId,
      model,
      configured,
      status: mapProviderStatus(status.status),
      message: status.message,
    }
  } catch (err) {
    aiPipelineLog.warn('failed to check embedding capability', { provider: providerId, err })
    return {
      provider: providerId,
      model: '',
      configured: false,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
