export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const STORAGE_KEY = 'tabmind:logLevel'
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function readConfiguredLevel(): LogLevel {
  if (typeof window === 'undefined') return 'info'
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
      return value
    }
  } catch {
    // Ignore localStorage access errors and keep default level.
  }
  return 'info'
}

function shouldLog(level: LogLevel): boolean {
  if (level === 'error') return true
  const configured = readConfiguredLevel()
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[configured]
}

function log(level: LogLevel, ns: string, msg: string, ctx?: object): void {
  if (!shouldLog(level)) return
  const prefix = `[${ns}] ${msg}`
  if (level === 'debug') {
    if (ctx) console.debug(prefix, ctx)
    else console.debug(prefix)
    return
  }
  if (level === 'info') {
    if (ctx) console.info(prefix, ctx)
    else console.info(prefix)
    return
  }
  if (level === 'warn') {
    if (ctx) console.warn(prefix, ctx)
    else console.warn(prefix)
    return
  }
  if (ctx) console.error(prefix, ctx)
  else console.error(prefix)
}

export function createLogger(ns: string) {
  return {
    debug: (msg: string, ctx?: object) => log('debug', ns, msg, ctx),
    info: (msg: string, ctx?: object) => log('info', ns, msg, ctx),
    warn: (msg: string, ctx?: object) => log('warn', ns, msg, ctx),
    error: (msg: string, ctx?: object) => log('error', ns, msg, ctx),
  }
}

export const classifierLog = createLogger('classifier')
export const llmLog = createLogger('llm')
export const webllmLog = createLogger('webllm')
export const embedderLog = createLogger('embedder')
export const clusterLog = createLogger('cluster')
export const domainEnricherLog = createLogger('domain-enricher')
export const aiPipelineLog = createLogger('ai-pipeline')
