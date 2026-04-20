import { useEffect, useRef, useState } from 'react'
import { chatComplete } from '@/lib/ai/llm'
import type { LlmSettings } from '@/lib/core/types'

interface PageSummaryProps {
  tabId: number
  url: string
  llmSettings: LlmSettings
}

type SummaryState = 'idle' | 'loading' | 'done' | 'error'

export function PageSummary({ tabId, url, llmSettings }: PageSummaryProps) {
  const [state, setState] = useState<SummaryState>('idle')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const cacheRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const cached = cacheRef.current.get(url)
    if (cached) {
      setSummary(cached)
      setError('')
      setState('done')
      return
    }
    setSummary('')
    setError('')
    setState('idle')
  }, [url])

  async function summarize() {
    setState('loading')
    setError('')
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'extractPageText',
        tabId,
      }) as { text?: string; error?: string } | undefined

      if (!response) {
        throw new Error('No response from background. Reload the extension and try again.')
      }

      const { text, error: extractError } = response

      if (extractError) throw new Error(extractError)
      if (!text?.trim()) throw new Error('Page has no readable text')
console.log(text);
      const result = await chatComplete(
        'You are a concise summarizer. Reply with 3-5 bullet points covering the key information on this page. No preamble.',
        text,
        llmSettings,
        1024,
        { metricKey: 'sidepanel-summary' },
      )

      cacheRef.current.set(url, result)
      setSummary(result)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  if (state === 'idle') {
    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2">
        <button
          type="button"
          onClick={() => void summarize()}
          className="w-full text-left text-xs text-[#666] transition-colors hover:text-[#888]"
        >
          ✦ Summarize this page
        </button>
      </div>
    )
  }

  return (
    <details open className="group rounded-lg border border-[#2a2a2a] bg-[#1a1a1a]">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-[#888]">
        Summary
      </summary>
      <div className="px-3 pb-3">
        {state === 'loading' && (
          <p className="animate-pulse text-xs text-[#555]">Summarizing...</p>
        )}
        {state === 'done' && (
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#aaa]">{summary}</p>
        )}
        {state === 'error' && (
          <div className="space-y-1.5">
            <p className="text-xs text-red-400/70">{error}</p>
            <button
              type="button"
              onClick={() => void summarize()}
              className="text-xs text-[#666] transition-colors hover:text-[#888]"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </details>
  )
}
