import type { LlmSettings } from '@/lib/core/types'

export type CapabilityStatus = 'checking' | 'ready' | 'loading' | 'unavailable' | 'unsupported' | 'error'

export interface ProviderCapabilityState {
  provider: string
  model: string
  configured: boolean
  status: CapabilityStatus
  message?: string
}

export interface AiSetupState {
  chat: ProviderCapabilityState
  embedding: ProviderCapabilityState
  canRunPipeline: boolean
  shouldOpenSettings: boolean
  blockingReason?: string
}

export interface ResolveAiSetupOptions {
  deep?: boolean
  signal?: AbortSignal
}

export type LlmAvailability = 'checking' | 'ready' | 'after-download' | 'unavailable'
export type LlmStatus = LlmAvailability

export interface SetupCapabilityCheckerContext {
  settings: LlmSettings
  options?: ResolveAiSetupOptions
}
