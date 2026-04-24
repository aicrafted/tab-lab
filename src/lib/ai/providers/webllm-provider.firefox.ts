export interface WebllmChatOptions {
  responseFormat?: 'json'
  disableThinking?: boolean
  jsonSchema?: unknown
  temperature?: number
  signal?: AbortSignal
}

export async function webllmChat(): Promise<string> {
  throw new Error('WebLLM not supported in Firefox')
}

export async function preloadWebllmModel(_modelId: string): Promise<void> {}

export async function isWebllmModelCached(_modelId: string): Promise<boolean> {
  return false
}
