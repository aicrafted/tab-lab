import { useEffect, useRef, useState } from 'react'
import { chatComplete } from '@/lib/ai/llm'
import type { ChatProvider, LlmSettings } from '@/lib/core/types'
import { DEFAULT_SUMMARY_SYSTEM_PROMPT } from '../sidepanel-settings'

interface PageSummaryProps {
  tabId: number
  url: string
  llmSettings: LlmSettings
  summaryProvider?: 'defined' | ChatProvider
  systemPrompt?: string
}

type SummaryState = 'idle' | 'picking' | 'loading' | 'done' | 'error'

function getEffectiveLlmSettings(
  llmSettings: LlmSettings,
  summaryProvider: 'defined' | ChatProvider,
): LlmSettings {
  if (summaryProvider === 'defined') return llmSettings
  return {
    ...llmSettings,
    tasks: {
      ...llmSettings.tasks,
      chat: { provider: summaryProvider },
    },
  }
}

export function PageSummary({
  tabId,
  url,
  llmSettings,
  summaryProvider = 'defined',
  systemPrompt = DEFAULT_SUMMARY_SYSTEM_PROMPT,
}: PageSummaryProps) {
  const [state, setState] = useState<SummaryState>('idle')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const cacheRef = useRef<Map<string, string>>(new Map())

  async function summarizeText(text: string) {
    setState('loading')
    setError('')
    try {
      if (!text.trim()) throw new Error('Selected element has no readable text')
      const result = await chatComplete(
        systemPrompt,
        text,
        getEffectiveLlmSettings(llmSettings, summaryProvider),
        400,
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

  async function summarizePage() {
    setError('')
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'extractPageText',
        tabId,
      }) as { text?: string; error?: string } | undefined

      if (!response) {
        throw new Error('No response from background. Reload the extension and try again.')
      }

      if (response.error) throw new Error(response.error)
      await summarizeText(response.text ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  async function startPicker() {
    setError('')
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'startElementPicker',
        tabId,
      }) as { ok?: boolean; error?: string } | undefined
      if (!response) throw new Error('No response from background. Reload the extension and try again.')
      if (response.error) throw new Error(response.error)
      setState('picking')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  async function cancelPicker() {
    try {
      await chrome.runtime.sendMessage({
        type: 'cancelElementPicker',
        tabId,
      })
    } catch {
    }
    setState('idle')
  }

  useEffect(() => {
    if (state === 'picking') {
      void chrome.runtime.sendMessage({ type: 'cancelElementPicker', tabId }).catch(() => {})
    }
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

  useEffect(() => {
    const onMessage = (msg: { type?: string; text?: string }) => {
      if (msg.type === 'elementPickerResult' && state === 'picking') {
        void summarizeText(msg.text ?? '')
      }
      if (msg.type === 'elementPickerCancelled' && state === 'picking') {
        setState('idle')
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [state, llmSettings, summaryProvider, systemPrompt, url])

  useEffect(() => {
    return () => {
      if (state === 'picking') {
        void chrome.runtime.sendMessage({ type: 'cancelElementPicker', tabId }).catch(() => {})
      }
    }
  }, [state, tabId])

  if (state === 'idle') {
    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void summarizePage()}
            className="text-xs text-[#666] transition-colors hover:text-[#888]"
          >
            ✦ Summarize this page
          </button>
          <span className="text-[#333]">·</span>
          <button
            type="button"
            onClick={() => void startPicker()}
            className="text-xs text-[#555] transition-colors hover:text-[#777]"
          >
            select section
          </button>
        </div>
      </div>
    )
  }

  if (state === 'picking') {
    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2">
        <p className="text-xs text-[#555]">Click an element on the page... (Esc to cancel)</p>
        <button
          type="button"
          onClick={() => void cancelPicker()}
          className="mt-1 text-xs text-[#666] transition-colors hover:text-[#888]"
        >
          Cancel
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
          <div className="space-y-2">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#aaa]">{summary}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void summarizePage()}
                className="text-xs text-[#666] transition-colors hover:text-[#888]"
              >
                Summarize again
              </button>
              <span className="text-[#333]">·</span>
              <button
                type="button"
                onClick={() => void startPicker()}
                className="text-xs text-[#555] transition-colors hover:text-[#777]"
              >
                select section
              </button>
            </div>
          </div>
        )}
        {state === 'error' && (
          <div className="space-y-1.5">
            <p className="text-xs text-red-400/70">{error}</p>
            <button
              type="button"
              onClick={() => void summarizePage()}
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
