import { aiPipelineLog } from './logger'

export interface ProgressReporter {
  progress: (delta?: number, extra?: Record<string, unknown>) => void
  done: (extra?: Record<string, unknown>) => void
  failed: (error: unknown) => void
  status: (message: string) => void
}

/**
 * A lightweight progress tracker that logs to the console/logger.
 * Useful for internal sub-steps.
 */
export function createLoggerProgress(
  operation: string,
  total: number,
  context?: Record<string, unknown>,
  onProgress?: (delta: number) => void
): ProgressReporter {
  const startedAt = Date.now()
  const safeTotal = Math.max(total, 1)
  let done = 0
  let lastPct = -1
  let lastLoggedDone = 0

  aiPipelineLog.info(`${operation} start`, { total: safeTotal, ...context })

  return {
    progress(delta = 1, extra?: Record<string, unknown>) {
      const nextDone = Math.min(safeTotal, done + Math.max(0, Math.floor(delta)))
      const actualDelta = nextDone - done
      if (actualDelta > 0) {
        onProgress?.(actualDelta)
      }
      for (let current = done + 1; current <= nextDone; current += 1) {
        const pct = Math.floor((current / safeTotal) * 100)
        const shouldLog =
          pct > lastPct ||
          current === safeTotal ||
          (safeTotal < 100 && current - lastLoggedDone >= 5)
        
        if (shouldLog) {
          lastPct = pct
          lastLoggedDone = current
          aiPipelineLog.debug(`${operation} progress`, { 
            done: current, 
            total: safeTotal, 
            pct, 
            ...extra 
          })
        }
      }
      done = nextDone
    },
    done(extra?: Record<string, unknown>) {
      aiPipelineLog.info(`${operation} done`, {
        total: safeTotal,
        durationMs: Date.now() - startedAt,
        ...extra,
      })
    },
    failed(error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      aiPipelineLog.error(`${operation} failed`, { error: msg })
    },
    status(message: string) {
       aiPipelineLog.debug(`${operation} status`, { message })
    }
  }
}
