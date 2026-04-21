import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, Copy, RotateCcw, ScanSearch } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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

function providerLabel(provider: ChatProvider): string {
  if (provider === 'browser-ml') return 'Browser ML'
  if (provider === 'gemini-nano') return 'Gemini Nano'
  if (provider === 'lmstudio') return 'LM Studio / Ollama'
  if (provider === 'openrouter') return 'OpenRouter'
  return provider
}

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
  const [copied, setCopied] = useState(false)
  const cacheRef = useRef<Map<string, string>>(new Map())
  const effectiveProvider = summaryProvider === 'defined' ? llmSettings.tasks.chat.provider : summaryProvider
  const effectiveProviderLabel = providerLabel(effectiveProvider)

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

  async function copySummary() {
    if (!summary.trim()) return
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
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
        <div className="flex items-center justify-between gap-2">
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
          <span className="shrink-0 text-[10px] font-normal uppercase tracking-wide text-[#666]">
            {effectiveProviderLabel}
          </span>
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
      <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-[#888] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
          <span>Summary</span>
        </span>
        <span className="shrink-0 text-[10px] font-normal uppercase tracking-wide text-[#666]">
          {effectiveProviderLabel}
        </span>
      </summary>
      <div className="px-3 pb-3">
        {state === 'loading' && (
          <p className="animate-pulse text-xs text-[#555]">Summarizing...</p>
        )}
        {state === 'done' && (
          <div className="space-y-2">
            <div className="text-xs leading-relaxed text-[#aaa]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
                  li: ({ children }) => <li className="mb-1">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold text-[#cfcfcf]">{children}</strong>,
                  em: ({ children }) => <em className="italic text-[#bcbcbc]">{children}</em>,
                  code: ({ children }) => <code className="rounded bg-[#151515] px-1 py-0.5 text-[11px] text-[#bdbdbd]">{children}</code>,
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#9d9d9d] underline decoration-[#4a4a4a] underline-offset-2 hover:text-[#b8b8b8]"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {summary}
              </ReactMarkdown>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copySummary()}
                className="inline-flex items-center gap-1 text-xs text-[#666] transition-colors hover:text-[#888]"
                title="Copy summary"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <span className="text-[#333]">·</span>
              <button
                type="button"
                onClick={() => void summarizePage()}
                className="inline-flex items-center gap-1 text-xs text-[#666] transition-colors hover:text-[#888]"
              >
                <RotateCcw className="h-3 w-3" />
                Summarize again
              </button>
              <span className="text-[#333]">·</span>
              <button
                type="button"
                onClick={() => void startPicker()}
                className="inline-flex items-center gap-1 text-xs text-[#555] transition-colors hover:text-[#777]"
              >
                <ScanSearch className="h-3 w-3" />
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
