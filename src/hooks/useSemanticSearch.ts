import { useCallback, useRef, useState } from 'react'
import { cosineSimilarity, fetchEmbedding, loadEmbeddingsForCurrentModel } from '@/lib/ai/embedder'
import type { LlmSettings } from '@/lib/core/types'

export interface SemanticResult {
  url: string
  score: number
}

export type SearchState = 'idle' | 'embedding' | 'done' | 'no-cache' | 'error'

export function useSemanticSearch(settings: LlmSettings) {
  const [results, setResults] = useState<SemanticResult[]>([])
  const [state, setState] = useState<SearchState>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const search = useCallback(async (query: string) => {
    const clean = query.trim()
    if (!clean) {
      setResults([])
      setState('idle')
      setError(null)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState('embedding')
    setError(null)

    try {
      const cache = await loadEmbeddingsForCurrentModel(settings)
      if (cache.size === 0) {
        setResults([])
        setState('no-cache')
        return
      }

      const queryVec = await fetchEmbedding(clean, settings, controller.signal)
      if (controller.signal.aborted) return

      const scored: SemanticResult[] = []
      for (const [url, vec] of cache) {
        scored.push({ url, score: cosineSimilarity(queryVec, vec) })
      }

      scored.sort((a, b) => b.score - a.score)
      setResults(scored.slice(0, 20))
      setState('done')
    } catch (err) {
      if (controller.signal.aborted) return
      setResults([])
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }, [settings])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setResults([])
    setState('idle')
    setError(null)
  }, [])

  return { results, state, error, search, clear }
}

