import type { LlmSettings } from '@/lib/core/types'
import { checkChatCapability, checkEmbeddingCapability } from './providers'
import type { AiSetupState, LlmAvailability, ProviderCapabilityState, ResolveAiSetupOptions } from './types'

function blockingReason(chat: ProviderCapabilityState, embedding: ProviderCapabilityState): string | undefined {
  if (chat.status !== 'ready') {
    return chat.message ?? `Chat provider "${chat.provider}" is ${chat.status}`
  }
  if (embedding.status !== 'ready') {
    return embedding.message ?? `Embedding provider "${embedding.provider}" is ${embedding.status}`
  }
  return undefined
}

export function deriveAiSetupState(
  chat: ProviderCapabilityState,
  embedding: ProviderCapabilityState,
): AiSetupState {
  const canRunPipeline = chat.status === 'ready' && embedding.status === 'ready'
  return {
    chat,
    embedding,
    canRunPipeline,
    shouldOpenSettings: !canRunPipeline,
    blockingReason: blockingReason(chat, embedding),
  }
}

export function createCheckingAiSetupState(
  settings?: LlmSettings,
): AiSetupState {
  return {
    chat: {
      provider: settings?.tasks.chat.provider ?? 'unknown',
      model: '',
      configured: false,
      status: 'checking',
      message: 'Checking chat model...',
    },
    embedding: {
      provider: settings?.tasks.embedding.provider ?? 'unknown',
      model: '',
      configured: false,
      status: 'checking',
      message: 'Checking embedding model...',
    },
    canRunPipeline: false,
    shouldOpenSettings: true,
    blockingReason: 'Checking AI startup state',
  }
}

export async function resolveAiSetupState(
  settings: LlmSettings | undefined,
  options?: ResolveAiSetupOptions,
): Promise<AiSetupState> {
  if (!settings) {
    return {
      chat: {
        provider: 'unknown',
        model: '',
        configured: false,
        status: 'unavailable',
        message: 'LLM settings not loaded',
      },
      embedding: {
        provider: 'unknown',
        model: '',
        configured: false,
        status: 'unavailable',
        message: 'LLM settings not loaded',
      },
      canRunPipeline: false,
      shouldOpenSettings: true,
      blockingReason: 'LLM settings not loaded',
    }
  }

  const [chat, embedding] = await Promise.all([
    checkChatCapability(settings, options),
    checkEmbeddingCapability(settings, options),
  ])
  return deriveAiSetupState(chat, embedding)
}

export async function checkLlmAvailability(settings?: LlmSettings): Promise<LlmAvailability> {
  if (!settings) return 'unavailable'
  const startup = await resolveAiSetupState(settings)
  if (startup.chat.status === 'ready') return 'ready'
  if (startup.chat.status === 'loading') return 'after-download'
  if (startup.chat.status === 'checking') return 'checking'
  return 'unavailable'
}
