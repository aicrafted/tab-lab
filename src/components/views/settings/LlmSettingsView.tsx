import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ChevronDown, Cpu, Globe, Info, Loader2, Plus, RotateCcw, Server, ShieldCheck, ShieldX, Tags, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchLmStudioModels } from '@/lib/ai/classifier'
import { checkLlmAvailability } from '@/lib/ai/setup'
import { getChatProvider } from '@/lib/ai/providers/factory'
import { GeminiNanoProvider } from '@/lib/ai/providers/gemini-nano'
import { DEFAULT_TRANSFORMERS_EMBEDDING_MODEL, DEFAULT_NLI_CATEGORIES } from '@/lib/core/types'
import type { ChatProvider, ClassificationMethod, EmbeddingProvider, LlmSettings, NliCategory } from '@/lib/core/types'
import {
  isWebllmModelCached,
  preloadWebllmModel,
} from '@/lib/ai/providers/webllm-provider'
import {
  isTransformersEmbeddingModelCached,
  preloadTransformersEmbeddingModel,
} from '@/lib/ai/providers/webgpu-provider'
import type { ViewProps } from '@/components/views/types'

const WEBLLM_CHAT_MODELS = [
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'Phi-3.5-mini-instruct-q4f16_1-MLC',
] as const

const TRANSFORMERS_EMBEDDING_MODELS = [
  'Xenova/all-MiniLM-L6-v2',
  'Xenova/bge-small-en-v1.5',
  'Xenova/multilingual-e5-small',
] as const

const OPENROUTER_EMBEDDING_MODELS = [
  'google/gemini-embedding-004',
  'openai/text-embedding-3-small',
  'openai/text-embedding-3-large',
] as const

const OPENROUTER_CHAT_MODELS = [
  'google/gemini-2.5-flash',
  'google/gemini-pro-1.5',
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-sonnet',
] as const

const OPENROUTER_MODELS_CACHE_KEY = 'tablab.openrouter.models.v1'
const OPENROUTER_MODELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000

function hasText(value: string): boolean {
  return value.replace(/\s/g, '').length > 0
}

function isEmbeddingModelName(model: string): boolean {
  const lower = model.toLowerCase()
  return lower.includes('embed')
    || lower.includes('embedding')
    || lower.includes('text-embedding')
    || lower.includes('nomic-embed')
    || lower.includes('bge')
    || lower.includes('e5')
}

function normalizeModelList(models: string[]): string[] {
  return Array.from(
    new Set(
      models
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b))
}

function readCachedOpenRouterModels(): string[] | null {
  try {
    const raw = window.localStorage.getItem(OPENROUTER_MODELS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ts?: number; models?: string[] }
    if (!parsed?.ts || !Array.isArray(parsed.models)) return null
    if (Date.now() - parsed.ts > OPENROUTER_MODELS_CACHE_TTL_MS) return null
    return normalizeModelList(parsed.models)
  } catch {
    return null
  }
}

function writeCachedOpenRouterModels(models: string[]): void {
  try {
    window.localStorage.setItem(OPENROUTER_MODELS_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      models,
    }))
  } catch {
  }
}

interface ModelSuggestInputProps {
  value: string
  onChange: (value: string) => void
  options: readonly string[]
  placeholder?: string
  loading?: boolean
  onOpen?: () => void | Promise<void>
}

function ModelSuggestInput({
  value,
  onChange,
  options,
  placeholder,
  loading = false,
  onOpen,
}: ModelSuggestInputProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [open, setOpen] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null)
  const [interactionMode, setInteractionMode] = useState<'mouse' | 'keyboard'>('mouse')

  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => option.toLowerCase().includes(query))
  }, [options, value])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      const insideInput = !!rootRef.current?.contains(target)
      const insideDropdown = !!dropdownRef.current?.contains(target)
      if (!insideInput && !insideDropdown) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (highlightedValue && filteredOptions.includes(highlightedValue)) return
    if (value && filteredOptions.includes(value)) {
      setHighlightedValue(value)
      return
    }
    setHighlightedValue(filteredOptions[0] ?? null)
  }, [open, filteredOptions, highlightedValue, value])

  useEffect(() => {
    if (!open || !highlightedValue) return
    const target = optionRefs.current[highlightedValue]
    if (!target) return
    target.scrollIntoView({ block: 'nearest' })
  }, [open, highlightedValue])

  useEffect(() => {
    if (!open) return
    const updateRect = () => {
      const input = inputRef.current
      if (!input) return
      const rect = input.getBoundingClientRect()
      setDropdownRect({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }

    updateRect()
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)
    return () => {
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [open])

  const openSuggestions = useCallback(() => {
    if (!open) {
      if (onOpen) {
        void onOpen()
      }
      setOpen(true)
    }
    inputRef.current?.focus()
  }, [onOpen, open])

  const selectOption = useCallback((option: string) => {
    onChange(option)
    setOpen(false)
    setHighlightedValue(option)
    setInteractionMode('mouse')
  }, [onChange])

  return (
    <div ref={rootRef} className="relative">
      <Input
        ref={inputRef}
        value={value}
        onFocus={openSuggestions}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            setOpen(false)
            return
          }
          if (e.key === 'Escape') {
            setOpen(false)
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            openSuggestions()
            setInteractionMode('keyboard')
            if (filteredOptions.length > 0) {
              const currentIndex = highlightedValue ? filteredOptions.indexOf(highlightedValue) : -1
              const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, filteredOptions.length - 1)
              setHighlightedValue(filteredOptions[nextIndex] ?? null)
            }
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            openSuggestions()
            setInteractionMode('keyboard')
            if (filteredOptions.length > 0) {
              const currentIndex = highlightedValue ? filteredOptions.indexOf(highlightedValue) : -1
              const nextIndex = currentIndex < 0 ? filteredOptions.length - 1 : Math.max(currentIndex - 1, 0)
              setHighlightedValue(filteredOptions[nextIndex] ?? null)
            }
            return
          }
          if (e.key === 'Enter' && open && highlightedValue && filteredOptions.includes(highlightedValue)) {
            e.preventDefault()
            selectOption(highlightedValue)
          }
        }}
        placeholder={placeholder}
        className="h-8 pr-8 text-xs"
      />
      <button
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          openSuggestions()
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        title="Show model suggestions"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && dropdownRect && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] max-h-48 overflow-y-auto rounded-md border border-border bg-card p-1 text-foreground shadow-md"
          style={{ top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}
        >
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">No matches</div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option}
                ref={(el) => {
                  optionRefs.current[option] = el
                }}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  setInteractionMode('mouse')
                  setHighlightedValue(option)
                }}
                onClick={() => selectOption(option)}
                className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  option === highlightedValue
                    ? 'bg-primary/20 text-foreground'
                    : interactionMode === 'keyboard'
                      ? 'text-foreground'
                      : 'text-foreground hover:bg-primary/20'
                }`}
              >
                {option}
              </button>
            ))
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

export function LlmSettingsView({ llmSettings, onSaveSettings }: ViewProps) {
  if (!llmSettings || !onSaveSettings) return <div>Settings state missing</div>

  // Provider Settings
  const [browserMl, setBrowserMl] = useState(llmSettings.providers.browserMl)
  const [lmstudio, setLmstudio] = useState(llmSettings.providers.lmstudio)
  const [openrouter, setOpenrouter] = useState(llmSettings.providers.openrouter)
  const [geminiNano, setGeminiNano] = useState(llmSettings.providers.geminiNano)

  // Task Assignments
  const [chatProvider, setChatProvider] = useState<ChatProvider>(llmSettings.tasks.chat.provider)
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>(llmSettings.tasks.embedding.provider)
  const [embeddingFlags, setEmbeddingFlags] = useState({
    includeTitle: llmSettings.tasks.embedding.includeTitle,
    includeDomain: llmSettings.tasks.embedding.includeDomain,
    includePath: llmSettings.tasks.embedding.includePath,
    includeDomainCategory: llmSettings.tasks.embedding.includeDomainCategory,
    includeDomainDescription: llmSettings.tasks.embedding.includeDomainDescription,
    includeDomainPlatform: llmSettings.tasks.embedding.includeDomainPlatform,
    includeCategory: llmSettings.tasks.embedding.includeCategory,
    includeLocalLabel: llmSettings.tasks.embedding.includeLocalLabel,
  })
  const [classificationMethod, setClassificationMethod] = useState<ClassificationMethod>(llmSettings.tasks.classification.method)
  const [nliCategories, setNliCategories] = useState<NliCategory[]>(llmSettings.nliCategories ?? [...DEFAULT_NLI_CATEGORIES])
  const [nliConfidenceThreshold, setNliConfidenceThreshold] = useState(llmSettings.nliConfidenceThreshold ?? 0.25)

  // UI State
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [openrouterModels, setOpenrouterModels] = useState<string[]>([])
  const [loadingOpenrouterModels, setLoadingOpenrouterModels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [geminiStatus, setGeminiStatus] = useState<'checking' | 'ready' | 'after-download' | 'unavailable'>('checking')
  const [geminiInfo, setGeminiInfo] = useState<{ apis: string[]; caps?: any }>({ apis: [] })

  const [loadingWebllm, setLoadingWebllm] = useState(false)
  const [webllmCached, setWebllmCached] = useState(false)
  const [loadingEmbeddingModel, setLoadingEmbeddingModel] = useState(false)
  const [embeddingModelCached, setEmbeddingModelCached] = useState(false)


  const checkGemini = useCallback(async () => {
    setGeminiStatus('checking')
    const win = (window as any)
    const apis = []
    if (win.ai) apis.push('window.ai')
    if (win.ai?.languageModel) apis.push('ai.languageModel')
    if (win.ai?.assistant) apis.push('ai.assistant')
    if (win.LanguageModel) apis.push('LanguageModel (global)')
    if (win.Summarizer) apis.push('Summarizer (global)')
    if (win.ai?.summarizer) apis.push('ai.summarizer')

    const geminiProbeSettings: LlmSettings = {
      ...llmSettings,
      tasks: {
        ...llmSettings.tasks,
        chat: { provider: 'gemini-nano' },
      },
    }
    const status = await checkLlmAvailability(geminiProbeSettings)

    // Get full status object from provider for diagnostics (message etc)
    const provider = getChatProvider('gemini-nano') as GeminiNanoProvider
    const fullStatus = await provider.checkStatus(geminiProbeSettings)

    setGeminiInfo({ apis, caps: fullStatus })
    setGeminiStatus(status)
  }, [llmSettings])

  useEffect(() => {
    void checkGemini()
  }, [checkGemini])

  useEffect(() => {
    const modelId = browserMl.chatModel.trim()
    if (!modelId) {
      setWebllmCached(false)
      return
    }
    let active = true
    void isWebllmModelCached(modelId).then((cached) => {
      if (!active) return
      setWebllmCached(cached)
    })
    return () => { active = false }
  }, [browserMl.chatModel])

  useEffect(() => {
    const modelId = (browserMl.embeddingModel.trim() || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL)
    let active = true
    void isTransformersEmbeddingModelCached(modelId).then((cached) => {
      if (!active) return
      setEmbeddingModelCached(cached)
    })
    return () => { active = false }
  }, [browserMl.embeddingModel])

  useEffect(() => {
    const cached = readCachedOpenRouterModels()
    if (cached && cached.length > 0) {
      setOpenrouterModels(cached)
    }
  }, [])

  const lmstudioModelOptions = useMemo(
    () => normalizeModelList(models),
    [models],
  )

  const lmstudioChatModelOptions = useMemo(() => {
    const chatOnly = lmstudioModelOptions.filter((model) => !isEmbeddingModelName(model))
    return chatOnly.length > 0 ? chatOnly : lmstudioModelOptions
  }, [lmstudioModelOptions])

  const lmstudioEmbeddingModelOptions = useMemo(() => {
    const embedOnly = lmstudioModelOptions.filter((model) => isEmbeddingModelName(model))
    return embedOnly.length > 0 ? embedOnly : lmstudioModelOptions
  }, [lmstudioModelOptions])

  const openrouterModelOptions = useMemo(() => {
    if (openrouterModels.length > 0) return normalizeModelList(openrouterModels)
    return normalizeModelList([...OPENROUTER_CHAT_MODELS, ...OPENROUTER_EMBEDDING_MODELS])
  }, [openrouterModels])

  const openrouterChatModelOptions = useMemo(() => {
    const chatOnly = openrouterModelOptions.filter((model) => !isEmbeddingModelName(model))
    return chatOnly.length > 0 ? chatOnly : openrouterModelOptions
  }, [openrouterModelOptions])

  const openrouterEmbeddingModelOptions = useMemo(() => {
    const embedOnly = openrouterModelOptions.filter((model) => isEmbeddingModelName(model))
    return embedOnly.length > 0 ? embedOnly : openrouterModelOptions
  }, [openrouterModelOptions])

  const configHints = useMemo(() => {
    const hints: string[] = []

    if (chatProvider === 'browser-ml') {
      if (!browserMl.chatModel.trim()) {
        hints.push('Current selected chat provider is Browser ML, but no chat model is selected. AI chat-related functions will not work until you select a model.')
      } else if (!loadingWebllm && !webllmCached) {
        hints.push('Current selected chat provider is Browser ML, but the selected chat model is not downloaded. AI chat-related functions will not work until you download the model.')
      }
    }

    if (chatProvider === 'lmstudio') {
      if (!hasText(lmstudio.baseUrl)) {
        hints.push('Current selected chat provider is LM Studio / Ollama, but Base URL is empty. AI chat-related functions will not work until you set Base URL.')
      }
      if (!hasText(lmstudio.chatModel)) {
        hints.push('Current selected chat provider is LM Studio / Ollama, but no chat model is selected. AI chat-related functions will not work until you select a model.')
      }
    }

    if (chatProvider === 'openrouter') {
      if (!hasText(openrouter.apiKey)) {
        hints.push('Current selected chat provider is OpenRouter, but API key is missing. AI chat-related functions will not work until you provide API key.')
      }
      if (!hasText(openrouter.chatModel)) {
        hints.push('Current selected chat provider is OpenRouter, but no chat model is selected. AI chat-related functions will not work until you select a model.')
      }
    }

    if (chatProvider === 'gemini-nano') {
      if (geminiStatus === 'unavailable') {
        hints.push('Current selected chat provider is Gemini Nano, but Prompt API is unavailable in current browser context. AI chat-related functions will not work until Gemini Nano is enabled and available.')
      }
      if (geminiStatus === 'after-download') {
        hints.push('Current selected chat provider is Gemini Nano, but model download is still in progress. AI chat-related functions may fail until download is finished.')
      }
    }

    if (embeddingProvider === 'browser-ml') {
      if (!loadingEmbeddingModel && !embeddingModelCached) {
        hints.push('Current selected embedding provider is Browser ML, but the selected embedding model is not downloaded. Embedding-related functions (semantic search, NLI) will not work until you download the model.')
      }
    }

    if (embeddingProvider === 'lmstudio') {
      if (!hasText(lmstudio.baseUrl)) {
        hints.push('Current selected embedding provider is LM Studio / Ollama, but Base URL is empty. Embedding-related functions will not work until you set Base URL.')
      }
      if (!hasText(lmstudio.embeddingModel)) {
        hints.push('Current selected embedding provider is LM Studio / Ollama, but no embedding model is selected. Embedding-related functions will not work until you select a model.')
      }
    }

    if (embeddingProvider === 'openrouter') {
      if (!hasText(openrouter.apiKey)) {
        hints.push('Current selected embedding provider is OpenRouter, but API key is missing. Embedding-related functions will not work until you provide API key.')
      }
      if (!hasText(openrouter.embeddingModel)) {
        hints.push('Current selected embedding provider is OpenRouter, but no embedding model is selected. Embedding-related functions will not work until you select a model.')
      }
    }

    return hints
  }, [
    chatProvider,
    embeddingProvider,
    browserMl.chatModel,
    lmstudio.baseUrl,
    lmstudio.chatModel,
    lmstudio.embeddingModel,
    openrouter.apiKey,
    openrouter.chatModel,
    openrouter.embeddingModel,
    geminiStatus,
    loadingWebllm,
    webllmCached,
    loadingEmbeddingModel,
    embeddingModelCached,
    hasText,
  ])

  const handleLoadModels = useCallback(async () => {
    if (!lmstudio.baseUrl.trim()) return
    setLoadingModels(true)
    setError(null)
    try {
      const list = await fetchLmStudioModels({
        ...llmSettings,
        providers: { browserMl, lmstudio, openrouter, geminiNano }
      })
      setModels(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingModels(false)
    }
  }, [llmSettings, browserMl, lmstudio, openrouter])

  const handleLoadOpenrouterModels = useCallback(async () => {
    setError(null)
    const cached = readCachedOpenRouterModels()
    if (cached && cached.length > 0) {
      setOpenrouterModels(cached)
      return
    }

    setLoadingOpenrouterModels(true)
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models?output_modalities=all', {
        method: 'GET',
        headers: openrouter.apiKey.trim() ? { Authorization: `Bearer ${openrouter.apiKey.trim()}` } : {},
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        throw new Error(`OpenRouter models API returned ${res.status}`)
      }
      const json = await res.json() as { data?: Array<{ id?: string }> }
      const fetched = normalizeModelList((json.data ?? []).map((item) => item.id ?? ''))
      if (fetched.length === 0) {
        throw new Error('OpenRouter returned empty model list')
      }
      setOpenrouterModels(fetched)
      writeCachedOpenRouterModels(fetched)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingOpenrouterModels(false)
    }
  }, [openrouter.apiKey])

  const handleOpenFlag = (flagUrl: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      void chrome.tabs.create({ url: flagUrl })
    } else {
      window.open(flagUrl, '_blank')
    }
  }

  const handlePreloadWebllm = useCallback(async () => {
    setError(null)
    setLoadingWebllm(true)
    try {
      await preloadWebllmModel(browserMl.chatModel)
      setWebllmCached(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingWebllm(false)
    }
  }, [browserMl.chatModel])

  const handlePreloadEmbeddingModel = useCallback(async () => {
    setError(null)
    setLoadingEmbeddingModel(true)
    try {
      const modelId = browserMl.embeddingModel.trim() || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL
      await preloadTransformersEmbeddingModel(modelId)
      setEmbeddingModelCached(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingEmbeddingModel(false)
    }
  }, [browserMl.embeddingModel])

  const handleSave = useCallback(() => {
    setError(null)
    onSaveSettings({
      ...llmSettings,
      providers: { browserMl, lmstudio, openrouter, geminiNano },
      tasks: {
        chat: { provider: chatProvider },
        embedding: { 
          provider: embeddingProvider,
          ...embeddingFlags
        },
        classification: { method: classificationMethod },
      },
      nliCategories,
      nliConfidenceThreshold,
    })
  }, [browserMl, chatProvider, embeddingProvider, embeddingFlags, classificationMethod, llmSettings, lmstudio, onSaveSettings, openrouter, geminiNano, nliCategories, nliConfidenceThreshold])

  return (
    <div className="max-w-[1600px] mx-auto space-y-10 pb-4 px-6 overflow-x-hidden">
      <div className="grid gap-8 xl:grid-cols-12 lg:grid-cols-2">
        {/* PROVIDERS COLUMN */}
        <div className="xl:col-span-4 xl:row-span-2 space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">Providers</h3>

          {/* Browser-local ML */}
          <div className="space-y-4 rounded-xl border border-border/60 bg-card/30 p-5 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <Cpu className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold uppercase">Browser-local ML</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Chat Model (WebLLM)</label>
                <ModelSuggestInput
                  value={browserMl.chatModel}
                  onChange={(v) => setBrowserMl({ ...browserMl, chatModel: v })}
                  options={WEBLLM_CHAT_MODELS}
                />
                {browserMl.chatModel && (
                  <Button
                    variant={webllmCached ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={handlePreloadWebllm}
                    disabled={loadingWebllm}
                    className="h-6 text-[9px] px-2 mt-1"
                  >
                    {loadingWebllm ? 'Downloading…' : webllmCached ? 'Cached' : 'Download to Cache'}
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Embeddings (Transformers.js)</label>
                <ModelSuggestInput
                  value={browserMl.embeddingModel}
                  onChange={(v) => setBrowserMl({ ...browserMl, embeddingModel: v })}
                  options={TRANSFORMERS_EMBEDDING_MODELS}
                  placeholder={DEFAULT_TRANSFORMERS_EMBEDDING_MODEL}
                />
                <Button
                  variant={embeddingModelCached ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={handlePreloadEmbeddingModel}
                  disabled={loadingEmbeddingModel}
                  className="h-6 text-[9px] px-2 mt-1"
                >
                  {loadingEmbeddingModel ? 'Downloading…' : embeddingModelCached ? 'Cached' : 'Download to Cache'}
                </Button>
              </div>

              <div className="flex gap-4 pt-1">
                <div className="space-y-1.5 w-24">
                  <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Temperature</label>
                  <Input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={browserMl.temperature}
                    onChange={(e) => setBrowserMl({ ...browserMl, temperature: parseFloat(e.target.value) || 0 })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* LM Studio / Ollama */}
          <div className="space-y-4 rounded-xl border border-border/60 bg-card/30 p-5 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <Server className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold uppercase">LM Studio / Ollama</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Base URL</label>
                <Input
                  value={lmstudio.baseUrl}
                  onChange={(e) => setLmstudio({ ...lmstudio, baseUrl: e.target.value })}
                  placeholder="http://localhost:1234/v1"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Chat Model ID</label>
                <ModelSuggestInput
                  value={lmstudio.chatModel}
                  onChange={(v) => setLmstudio({ ...lmstudio, chatModel: v })}
                  options={lmstudioChatModelOptions}
                  loading={loadingModels}
                  onOpen={handleLoadModels}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Embedding Model ID</label>
                <ModelSuggestInput
                  value={lmstudio.embeddingModel}
                  onChange={(v) => setLmstudio({ ...lmstudio, embeddingModel: v })}
                  options={lmstudioEmbeddingModelOptions}
                  loading={loadingModels}
                  onOpen={handleLoadModels}
                />
              </div>
              <div className="flex gap-4 pt-1">
                <div className="space-y-1.5 w-24">
                  <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Temperature</label>
                  <Input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={lmstudio.temperature}
                    onChange={(e) => setLmstudio({ ...lmstudio, temperature: parseFloat(e.target.value) || 0 })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* OpenRouter */}
          <div className="space-y-4 rounded-xl border border-border/60 bg-card/30 p-5 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold uppercase">OpenRouter (Cloud)</p>
            </div>

            <div className="rounded-lg border border-amber-500/10 bg-amber-500/5 p-3 flex gap-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] leading-relaxed text-muted-foreground italic">
                <strong className="text-amber-500 not-italic">WARNING!</strong> Using a cloud provider means tab and bookmarks metadata (titles, URLs) will be sent to external servers for processing.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">API Key</label>
                <Input
                  value={openrouter.apiKey}
                  onChange={(e) => setOpenrouter({ ...openrouter, apiKey: e.target.value })}
                  placeholder="sk-or-v1-..."
                  type="password"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Chat Model ID</label>
                <ModelSuggestInput
                  value={openrouter.chatModel}
                  onChange={(v) => setOpenrouter({ ...openrouter, chatModel: v })}
                  options={openrouterChatModelOptions}
                  placeholder="Type model ID or pick from list"
                  loading={loadingOpenrouterModels}
                  onOpen={handleLoadOpenrouterModels}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Embedding Model ID</label>
                <ModelSuggestInput
                  value={openrouter.embeddingModel}
                  onChange={(v) => setOpenrouter({ ...openrouter, embeddingModel: v })}
                  options={openrouterEmbeddingModelOptions}
                  placeholder="Type embedding model ID or pick from list"
                  loading={loadingOpenrouterModels}
                  onOpen={handleLoadOpenrouterModels}
                />
              </div>
              <div className="flex gap-4 pt-1">
                <div className="space-y-1.5 w-24">
                  <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Temperature</label>
                  <Input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={openrouter.temperature}
                    onChange={(e) => setOpenrouter({ ...openrouter, temperature: parseFloat(e.target.value) || 0 })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* GEMINI COLUMN */}
        <div className="xl:col-span-4 space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">Gemini Nano</h3>

          <div className="rounded-xl border border-border/60 bg-card/10 p-5 space-y-4">
            <div className="space-y-1.5 w-24">
              <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Temperature</label>
              <Input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={geminiNano.temperature}
                onChange={(e) => setGeminiNano({ ...geminiNano, temperature: parseFloat(e.target.value) || 0 })}
                className="h-8 text-xs"
              />
            </div>

            <div className="h-px bg-border/40" />

            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className={`shrink-0 p-2 rounded-lg ${geminiStatus === 'ready' ? 'bg-emerald-500/10 text-emerald-500' :
                    geminiStatus === 'after-download' ? 'bg-amber-500/10 text-amber-500' :
                      geminiStatus === 'checking' ? 'bg-secondary/10 text-secondary' :
                        'bg-destructive/10 text-destructive'
                  }`}>
                  {geminiStatus === 'ready' ? <ShieldCheck className="h-5 w-5" /> :
                    geminiStatus === 'checking' ? <Loader2 className="h-5 w-5 animate-spin" /> :
                      <ShieldX className="h-5 w-5" />}
                </div>

                <div className="flex-1 space-y-1">
                  <p className="text-xs font-bold uppercase tracking-tight">
                    {geminiStatus === 'ready' ? 'System Ready' :
                      geminiStatus === 'after-download' ? 'Downloading Model...' :
                        geminiStatus === 'checking' ? 'Analyzing...' :
                          'System Unsupported'}
                  </p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Native Chrome AI for private inference. Requires specific browser flags.
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={checkGemini} className="h-8 w-8">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>

              {geminiStatus === 'unavailable' && (
                <div className="rounded-lg border border-destructive/10 bg-destructive/5 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-destructive uppercase tracking-widest">
                    <Info className="h-3 w-3" />
                    Required Actions
                  </div>
                  <ul className="text-[10px] text-muted-foreground space-y-2 list-none">
                    <li className="flex gap-2">
                      <span className="text-primary font-bold">1</span>
                      <span>Use <b>Chrome Canary/Dev</b> (127+)</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary font-bold">2</span>
                      <span>Enable <button onClick={() => handleOpenFlag('chrome://flags/#optimization-guide-on-device-model')} className="text-primary hover:underline font-mono bg-background px-1 rounded">#optimization-guide-on-device-model</button> to <b>Enabled BypassPrefavorite</b></span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary font-bold">3</span>
                      <span>Enable <button onClick={() => handleOpenFlag('chrome://flags/#prompt-api-for-gemini-nano')} className="text-primary hover:underline font-mono bg-background px-1 rounded">#prompt-api-for-gemini-nano</button></span>
                    </li>
                    <li className="bg-destructive/10 p-2 rounded-md text-destructive mt-3 font-medium border border-destructive/20">
                      ⚠️ <b>Extension Origin Policy:</b> Chrome blocks Prompt API on <code className="text-[9px]">chrome-extension://</code> pages.
                      If diagnostics show "none" but it works on standard sites, this restriction is active.
                    </li>
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 opacity-60">
                <p className="text-[9px] font-medium uppercase text-muted-foreground">
                  APIs: <span className="text-foreground">{geminiInfo.apis.length > 0 ? geminiInfo.apis.join(', ') : 'none'}</span>
                </p>
                {geminiInfo.caps?.message && (
                  <p className={`text-[9px] font-medium uppercase mt-1 ${geminiStatus === 'ready' || geminiStatus === 'after-download'
                      ? 'text-muted-foreground'
                      : 'text-destructive'
                    }`}>
                    {' '}
                    <span className="text-foreground">{geminiInfo.caps.message}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {configHints.length > 0 && (
              <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                {configHints.map((hint) => (
                  <p key={hint} className="text-[11px] leading-relaxed text-amber-200/90">
                    {hint}
                  </p>
                ))}
              </div>
            )}
            <Button onClick={handleSave} className="w-full shadow-lg shadow-primary/10">
              Save & Apply Configuration
            </Button>
            {error && <p className="text-[11px] text-destructive text-center">{error}</p>}
          </div>
        </div>

        {/* ASSIGNMENTS COLUMN */}
        <div className="xl:col-span-4 space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">Assignments</h3>

          <div className="space-y-6 rounded-xl border border-border/60 bg-card/30 p-6 shadow-sm backdrop-blur-sm">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold uppercase tracking-tight">Chat Logic</p>
                  <p className="text-[11px] text-muted-foreground">Used for categorization & tagging</p>
                </div>
                <Select value={chatProvider} onValueChange={(v) => setChatProvider(v as ChatProvider)}>
                  <SelectTrigger className="h-9 w-44 text-xs font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(geminiStatus === 'ready' || geminiStatus === 'after-download') && (
                      <SelectItem value="gemini-nano">Gemini Nano</SelectItem>
                    )}
                    <SelectItem value="browser-ml">Browser-local ML</SelectItem>
                    <SelectItem value="lmstudio">LM Studio / Ollama</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="h-px bg-border/40" />

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold uppercase tracking-tight">Embeddings</p>
                  <p className="text-[11px] text-muted-foreground">Used for semantic search & focus</p>
                </div>
                <Select value={embeddingProvider} onValueChange={(v) => setEmbeddingProvider(v as EmbeddingProvider)}>
                  <SelectTrigger className="h-9 w-44 text-xs font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="browser-ml">Browser-local ML</SelectItem>
                    <SelectItem value="lmstudio">LM Studio / Ollama</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Embedding Content Toggles */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 pl-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={embeddingFlags.includeTitle}
                    onChange={(e) => setEmbeddingFlags({ ...embeddingFlags, includeTitle: e.target.checked })}
                    className="h-3.5 w-3.5 rounded-sm border-border bg-background accent-primary cursor-pointer transition-all"
                  />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground group-hover:text-foreground transition-colors">Title</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={embeddingFlags.includeDomain}
                    onChange={(e) => setEmbeddingFlags({ ...embeddingFlags, includeDomain: e.target.checked })}
                    className="h-3.5 w-3.5 rounded-sm border-border bg-background accent-primary cursor-pointer transition-all"
                  />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground group-hover:text-foreground transition-colors">Domain</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={embeddingFlags.includePath}
                    onChange={(e) => setEmbeddingFlags({ ...embeddingFlags, includePath: e.target.checked })}
                    className="h-3.5 w-3.5 rounded-sm border-border bg-background accent-primary cursor-pointer transition-all"
                  />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground group-hover:text-foreground transition-colors">Path</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={embeddingFlags.includeDomainCategory}
                    onChange={(e) => setEmbeddingFlags({ ...embeddingFlags, includeDomainCategory: e.target.checked })}
                    className="h-3.5 w-3.5 rounded-sm border-border bg-background accent-primary cursor-pointer transition-all"
                  />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground group-hover:text-foreground transition-colors">Domain Category</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={embeddingFlags.includeDomainDescription}
                    onChange={(e) => setEmbeddingFlags({ ...embeddingFlags, includeDomainDescription: e.target.checked })}
                    className="h-3.5 w-3.5 rounded-sm border-border bg-background accent-primary cursor-pointer transition-all"
                  />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground group-hover:text-foreground transition-colors">Domain Description</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={embeddingFlags.includeDomainPlatform}
                    onChange={(e) => setEmbeddingFlags({ ...embeddingFlags, includeDomainPlatform: e.target.checked })}
                    className="h-3.5 w-3.5 rounded-sm border-border bg-background accent-primary cursor-pointer transition-all"
                  />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground group-hover:text-foreground transition-colors">Domain Platform</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={embeddingFlags.includeCategory}
                    onChange={(e) => setEmbeddingFlags({ ...embeddingFlags, includeCategory: e.target.checked })}
                    className="h-3.5 w-3.5 rounded-sm border-border bg-background accent-primary cursor-pointer transition-all"
                  />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground group-hover:text-foreground transition-colors">AI Category</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={embeddingFlags.includeLocalLabel}
                    onChange={(e) => setEmbeddingFlags({ ...embeddingFlags, includeLocalLabel: e.target.checked })}
                    className="h-3.5 w-3.5 rounded-sm border-border bg-background accent-primary cursor-pointer transition-all"
                  />
                  <span className="text-[10px] font-medium uppercase text-muted-foreground group-hover:text-foreground transition-colors">Local Label</span>
                </label>
              </div>

              <div className="h-px bg-border/40" />

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold uppercase tracking-tight">Classification</p>
                  <p className="text-[11px] text-muted-foreground">Choose speed vs. reasoning</p>
                </div>
                <Select value={classificationMethod} onValueChange={(v) => setClassificationMethod(v as ClassificationMethod)}>
                  <SelectTrigger className="h-9 w-44 text-xs font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="llm">LLM (Smart, slower)</SelectItem>
                    <SelectItem value="nli">NLI (Fast semantic)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

          </div>

        </div>

        {/* NLI TAXONOMY COLUMN */}
        <div className="lg:col-span-2 xl:col-span-8 space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">Taxonomy</h3>
          <div className="space-y-6 rounded-xl border border-border/60 bg-card/30 p-6 shadow-sm backdrop-blur-sm">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary">
                  <Tags className="h-4 w-4" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">NLI Categories</h3>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[10px] gap-1.5 border-dashed"
                  onClick={() => setNliCategories([...nliCategories, { label: 'New Category', descriptor: '' }])}
                >
                  <Plus className="h-3 w-3" />
                  Add Category
                </Button>
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed px-1">
                Custom labels used for semantic bucketing. The descriptor should contain keywords that describe the typical content.
              </p>

              <div className="space-y-2 px-1 py-3 border-y border-border/40">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Confidence Threshold</label>
                    <p className="text-[9px] text-muted-foreground/60 italic">Minimum score (0 to 1) for a valid classification</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold text-primary">{nliConfidenceThreshold.toFixed(2)}</span>
                    <Input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={nliConfidenceThreshold}
                      onChange={(e) => setNliConfidenceThreshold(parseFloat(e.target.value))}
                      className="w-32 h-4 accent-primary"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border/40 bg-background/20">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[140px] px-2 h-8 text-[10px] uppercase tracking-wider">Label</TableHead>
                      <TableHead className="px-2 h-8 text-[10px] uppercase tracking-wider">Descriptor</TableHead>
                      <TableHead className="w-[40px] px-2 h-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nliCategories.map((cat, idx) => (
                      <TableRow key={idx} className="group hover:bg-card/40 border-border/40">
                        <TableCell className="p-1 px-2">
                          <Input
                            value={cat.label}
                            onChange={(e) => {
                              const next = [...nliCategories]
                              next[idx] = { ...cat, label: e.target.value }
                              setNliCategories(next)
                            }}
                            placeholder="e.g. Science"
                            className="h-7 text-[11px] font-medium bg-background/40 border-transparent focus:border-primary/30 transition-all px-2"
                          />
                        </TableCell>
                        <TableCell className="p-1 px-2">
                          <Input
                            value={cat.descriptor}
                            onChange={(e) => {
                              const next = [...nliCategories]
                              next[idx] = { ...cat, descriptor: e.target.value }
                              setNliCategories(next)
                            }}
                            placeholder="keywords, examples..."
                            className="h-7 text-[11px] bg-background/20 border-transparent focus:border-primary/30 transition-all px-2 w-full"
                          />
                        </TableCell>
                        <TableCell className="p-1 px-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              const next = nliCategories.filter((_, i) => i !== idx)
                              setNliCategories(next)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {nliCategories.length === 0 && (
                  <div className="py-8 text-center text-[10px] text-muted-foreground italic">
                    No categories defined. Click "Add Category" to start.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
