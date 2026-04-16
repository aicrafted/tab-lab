import { createLogger } from '../core/logger'

const parserLog = createLogger('parsers')

/**
 * Extract the first JSON object or array from arbitrary text.
 * Handles cases where the model wraps JSON in prose or code blocks.
 */
export function extractJson(text: string): string {
  if (!text) return ''
  
  // Strip markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) return codeBlock[1].trim()

  // Find first { or [ and extract balanced JSON
  const start = text.search(/[{[]/)
  if (start === -1) return text.trim()

  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start).trim()
}

/**
 * Repairs extremely common LLM JSON mishaps (like trailing commas).
 */
export function repairJsonString(input: string): string {
  return input
    .replace(/\uFEFF/g, '') // BOM
    .replace(/,\s*([}\]])/g, '$1') // Trailing commas in objects/arrays
    .replace(/([{,]\s*)'([^'\\]+)'\s*:/g, '$1"$2":') // Single quoted keys
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value: string) => {
       const safe = value.replace(/"/g, '\\"')
       return `: "${safe}"`
    }) // Single quoted values
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\- ]*)\s*:/g, (_m, prefix: string, key: string) => {
       const safeKey = key.trim().replace(/"/g, '\\"')
       return `${prefix}"${safeKey}":`
    }) // Unquoted keys
}

/**
 * Attempts to extract and parse JSON from an LLM response string.
 */
export function parseLlmJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback

  const extracted = extractJson(raw)
  if (!extracted) return fallback

  try {
    return JSON.parse(extracted) as T
  } catch {
    try {
      const repaired = repairJsonString(extracted)
      return JSON.parse(repaired) as T
    } catch (err) {
      parserLog.warn('json parse failed after repair', { 
        err: err instanceof Error ? err.message : String(err),
        snippet: extracted.slice(0, 100) 
      })
    }
  }

  return fallback
}
