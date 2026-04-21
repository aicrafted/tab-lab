import { describe, expect, it } from 'vitest'
import { createCheckingAiSetupState, deriveAiSetupState } from '../state'
import type { ProviderCapabilityState } from '../types'

function capability(overrides: Partial<ProviderCapabilityState>): ProviderCapabilityState {
  return {
    provider: 'browser-ml',
    model: 'model-x',
    configured: true,
    status: 'ready',
    ...overrides,
  }
}

describe('ai/setup/state', () => {
  it('marks pipeline runnable only when chat and embedding are ready', () => {
    const ready = deriveAiSetupState(
      capability({ status: 'ready' }),
      capability({ status: 'ready' }),
    )
    expect(ready.canRunPipeline).toBe(true)
    expect(ready.shouldOpenSettings).toBe(false)

    const notReady = deriveAiSetupState(
      capability({ status: 'loading', message: 'chat loading' }),
      capability({ status: 'ready' }),
    )
    expect(notReady.canRunPipeline).toBe(false)
    expect(notReady.shouldOpenSettings).toBe(true)
    expect(notReady.blockingReason).toBe('chat loading')
  })

  it('prefers embedding blocking reason when chat is ready', () => {
    const state = deriveAiSetupState(
      capability({ status: 'ready' }),
      capability({ status: 'unavailable', message: 'embedding missing' }),
    )
    expect(state.blockingReason).toBe('embedding missing')
  })

  it('creates deterministic checking state', () => {
    const state = createCheckingAiSetupState()
    expect(state.chat.status).toBe('checking')
    expect(state.embedding.status).toBe('checking')
    expect(state.canRunPipeline).toBe(false)
    expect(state.shouldOpenSettings).toBe(true)
  })
})
