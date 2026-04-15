import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, Loader2, RotateCcw, ShieldCheck, ShieldX, Cpu, Server, Globe, AlertTriangle, Plus, Trash2, Tags, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { checkLlmAvailability, fetchLmStudioModels } from '@/lib/classifier'
import { getChatProvider } from '@/lib/providers/factory'
import { GeminiNanoProvider } from '@/lib/providers/gemini-nano'
import { DEFAULT_TRANSFORMERS_EMBEDDING_MODEL, DEFAULT_NLI_CATEGORIES } from '@/lib/types'
import type { ChatProvider, ClassificationMethod, EmbeddingProvider, LlmSettings, NliCategory } from '@/lib/types'
import {
  isWebllmModelCached,
  preloadWebllmModel,
} from '@/lib/webllm-provider'
import {
  isTransformersEmbeddingModelCached,
  preloadTransformersEmbeddingModel,
} from '@/lib/webgpu-provider'
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
  const [nliCategories, setNliCategories] = useState<NliCategory[]>(llmSettings.nliCategories ?? [...DEFAULT_NLI_CATEGORIES])

  // UI State
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [geminiStatus, setGeminiStatus] = useState<'checking' | 'ready' | 'after-download' | 'unavailable'>('checking')
  const [geminiInfo, setGeminiInfo] = useState<{ apis: string[]; caps?: any }>({ apis: [] })

  const [loadingWebllm, setLoadingWebllm] = useState(false)
  const [webllmCached, setWebllmCached] = useState(false)
  const [loadingEmbeddingModel, setLoadingEmbeddingModel] = useState(false)
  const [embeddingModelCached, setEmbeddingModelCached] = useState(false)

  const [activeTab, setActiveTab] = useState<'providers' | 'advanced'>('providers')

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

  const canSave = useMemo(() => {
    if (chatProvider === 'browser-ml' && !browserMl.chatModel.trim()) return false
    if (chatProvider === 'lmstudio' && (!lmstudio.baseUrl.trim() || !lmstudio.chatModel.trim())) return false
    if (chatProvider === 'openrouter' && (!openrouter.apiKey.trim() || !openrouter.chatModel.trim())) return false
    return true
  }, [chatProvider, browserMl.chatModel, lmstudio, openrouter])

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
    onSaveSettings({
      ...llmSettings,
      providers: { browserMl, lmstudio, openrouter, geminiNano },
      tasks: {
        chat: { provider: chatProvider },
        embedding: { provider: embeddingProvider },
      },
      nliCategories,
    })
  }, [browserMl, chatProvider, embeddingProvider, llmSettings, lmstudio, onSaveSettings, openrouter, geminiNano, nliCategories])

  return (
    <div className="max-w-4xl space-y-10 py-4">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* PROVIDERS COLUMN */}
        <div className="space-y-6">
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
                <div className="flex gap-2">
                  <Input
                    value={browserMl.chatModel}
                    onChange={(e) => setBrowserMl({ ...browserMl, chatModel: e.target.value })}
                    className="h-8 text-xs flex-1"
                  />
                  <Select value={browserMl.chatModel} onValueChange={(v) => setBrowserMl({ ...browserMl, chatModel: v })}>
                    <SelectTrigger className="h-8 w-10 px-0 flex items-center justify-center">
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </SelectTrigger>
                    <SelectContent>
                      {WEBLLM_CHAT_MODELS.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
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
                <div className="flex gap-2">
                  <Input
                    value={browserMl.embeddingModel}
                    onChange={(e) => setBrowserMl({ ...browserMl, embeddingModel: e.target.value })}
                    placeholder={DEFAULT_TRANSFORMERS_EMBEDDING_MODEL}
                    className="h-8 text-xs flex-1"
                  />
                  <Select value={browserMl.embeddingModel} onValueChange={(v) => setBrowserMl({ ...browserMl, embeddingModel: v })}>
                    <SelectTrigger className="h-8 w-10 px-0 flex items-center justify-center">
                      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSFORMERS_EMBEDDING_MODELS.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
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
                <div className="space-y-1.5 flex-1">
                  <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Classification Method</label>
                  <Select
                    value={browserMl.classificationMethod}
                    onValueChange={(v) => setBrowserMl({ ...browserMl, classificationMethod: v as ClassificationMethod })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="llm" className="text-xs">LLM (Smart, slower)</SelectItem>
                      <SelectItem value="nli" className="text-xs">NLI (Fast semantic match)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                <div className="flex gap-2">
                  <Input
                    value={lmstudio.chatModel}
                    onChange={(e) => setLmstudio({ ...lmstudio, chatModel: e.target.value })}
                    className="h-8 text-xs flex-1"
                  />
                  <Select
                    value={lmstudio.chatModel}
                    onValueChange={(v) => setLmstudio({ ...lmstudio, chatModel: v })}
                    onOpenChange={(open) => open && handleLoadModels()}
                  >
                    <SelectTrigger className="h-8 w-10 px-0 flex items-center justify-center">
                      {loadingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />}
                    </SelectTrigger>
                    <SelectContent>
                      {models.length === 0 && !loadingModels && <div className="p-2 text-[10px] text-muted-foreground">Click to fetch models...</div>}
                      {models.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Embedding Model ID</label>
                <div className="flex gap-2">
                  <Input
                    value={lmstudio.embeddingModel}
                    onChange={(e) => setLmstudio({ ...lmstudio, embeddingModel: e.target.value })}
                    className="h-8 text-xs flex-1"
                  />
                  <Select
                    value={lmstudio.embeddingModel}
                    onValueChange={(v) => setLmstudio({ ...lmstudio, embeddingModel: v })}
                    onOpenChange={(open) => open && handleLoadModels()}
                  >
                    <SelectTrigger className="h-8 w-10 px-0 flex items-center justify-center">
                      {loadingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />}
                    </SelectTrigger>
                    <SelectContent>
                      {models.length === 0 && !loadingModels && <div className="p-2 text-[10px] text-muted-foreground">Click to fetch models...</div>}
                      {models.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-4 pt-1">
                <div className="space-y-1.5 flex-1">
                  <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Classification Method</label>
                  <Select
                    value={lmstudio.classificationMethod}
                    onValueChange={(v) => setLmstudio({ ...lmstudio, classificationMethod: v as ClassificationMethod })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="llm" className="text-xs">LLM (Smart, slower)</SelectItem>
                      <SelectItem value="nli" className="text-xs">NLI (Fast semantic match)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                <Input
                  value={openrouter.chatModel}
                  onChange={(e) => setOpenrouter({ ...openrouter, chatModel: e.target.value })}
                  placeholder="google/gemini-pro-1.5"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Embedding Model ID</label>
                <div className="flex gap-2">
                  <Input
                    value={openrouter.embeddingModel}
                    onChange={(e) => setOpenrouter({ ...openrouter, embeddingModel: e.target.value })}
                    placeholder="google/gemini-embedding-004"
                    className="h-8 text-xs flex-1"
                  />
                  <Select value={openrouter.embeddingModel} onValueChange={(v) => setOpenrouter({ ...openrouter, embeddingModel: v })}>
                    <SelectTrigger className="h-8 w-10 px-0 flex items-center justify-center">
                      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                    </SelectTrigger>
                    <SelectContent>
                      {OPENROUTER_EMBEDDING_MODELS.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-4 pt-1">
                <div className="space-y-1.5 flex-1">
                  <label className="text-[10px] font-medium uppercase text-muted-foreground tracking-tight">Classification Method</label>
                  <Select
                    value={openrouter.classificationMethod}
                    onValueChange={(v) => setOpenrouter({ ...openrouter, classificationMethod: v as ClassificationMethod })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="llm" className="text-xs">LLM (Smart, slower)</SelectItem>
                      <SelectItem value="nli" className="text-xs">NLI (Fast semantic match)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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

        {/* ASSIGNMENTS COLUMN */}
        <div className="space-y-6">
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
            </div>

            {/* NLI Categories Section */}
            <div className="space-y-4 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary">
                  <Tags className="h-4 w-4" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">NLI Taxonomy</h3>
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
                Custom labels used for semantic bucketing. The descriptor should contain keywords that describe the typical content of this category.
              </p>

              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                {nliCategories.map((cat, idx) => (
                  <div key={idx} className="group relative rounded-lg border border-border/40 bg-card/10 p-3 space-y-2 hover:border-border/80 transition-colors">
                    <div className="flex items-center gap-2">
                      <Input
                        value={cat.label}
                        onChange={(e) => {
                          const next = [...nliCategories]
                          next[idx] = { ...cat, label: e.target.value }
                          setNliCategories(next)
                        }}
                        placeholder="Label (e.g. Science)"
                        className="h-7 text-xs font-semibold bg-background/50 flex-1"
                      />
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
                    </div>
                    <textarea
                      value={cat.descriptor}
                      onChange={(e) => {
                        const next = [...nliCategories]
                        next[idx] = { ...cat, descriptor: e.target.value }
                        setNliCategories(next)
                      }}
                      placeholder="Semantic descriptor (keywords, examples...)"
                      className="w-full min-h-[40px] text-[11px] bg-background/30 rounded-md border border-input p-2 focus:ring-1 focus:ring-primary outline-none resize-none leading-relaxed"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 flex flex-col items-stretch gap-3">
              <Button onClick={handleSave} disabled={!canSave} className="w-full shadow-lg shadow-primary/10">
                Save & Apply Configuration
              </Button>
              {error && <p className="text-[11px] text-destructive text-center">{error}</p>}
            </div>
          </div>

          <div className="space-y-4 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50">Gemini Nano Configuration</h3>
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
            </div>

            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50">Gemini Nano Diagnostics</h3>
            <div className="rounded-xl border border-border/60 bg-card/10 p-5 space-y-4">
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
                <p className="text-[9px] font-medium uppercase text-muted-foreground">
                  Availability: <span className="text-foreground">
                    {typeof geminiInfo.caps === 'string' ? geminiInfo.caps : geminiInfo.caps?.available || 'unknown'}
                  </span>
                </p>
                {geminiInfo.caps?.message && (
                  <p className={`text-[9px] font-medium uppercase mt-1 ${geminiStatus === 'ready' || geminiStatus === 'after-download'
                      ? 'text-muted-foreground'
                      : 'text-destructive'
                    }`}>
                    {geminiStatus === 'ready' || geminiStatus === 'after-download' ? 'Status' : 'Error'}: {' '}
                    <span className="text-foreground">{geminiInfo.caps.message}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
