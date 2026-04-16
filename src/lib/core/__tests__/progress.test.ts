import { describe, it, expect, vi } from 'vitest'
import { createLoggerProgress } from '../progress'
import { aiPipelineLog } from '../logger'

vi.mock('../logger', () => ({
  classifierLog: {
    info: vi.fn(),
  },
  aiPipelineLog: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }
}))

describe('progress', () => {
  it('should report progress correctly', () => {
    const onProgress = vi.fn()
    const tracker = createLoggerProgress('test-task', 100, { some: 'ctx' }, onProgress)

    tracker.progress(20, { detail: 'step 1' })
    expect(onProgress).toHaveBeenCalledWith(20)
    expect(aiPipelineLog.info).toHaveBeenCalledWith(expect.stringContaining('test-task start'), expect.any(Object))

    tracker.progress(30)
    expect(onProgress).toHaveBeenCalledWith(30)
  })

  it('should finish task', () => {
    const tracker = createLoggerProgress('test-task', 100)
    tracker.done({ final: 'stats' })
    expect(aiPipelineLog.info).toHaveBeenCalledWith(expect.stringContaining('test-task done'), expect.objectContaining({
      final: 'stats'
    }))
  })
})
