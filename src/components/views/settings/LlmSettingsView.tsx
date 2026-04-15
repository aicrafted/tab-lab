import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, Loader2, RotateCcw, ShieldCheck, ShieldX } from 'lucide-react'
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
import { DEFAULT_TRANSFORMERS_EMBEDDING_MODEL } from '@/lib/types'
import type { ChatProvider, ClassificationMethod, EmbeddingProvider, LlmSettings } from '@/lib/types'
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

export function LlmSettingsView({ llmSettings, onSaveSettings }: ViewProps) {
  if (!llmSettings || !onSaveSettings) return <div>Settings state missing</div>

  const [chatProvider, setChatProvider] = useState<ChatProvider>(llmSettings.tasks.chat.provider)
  const [chatModel, setChatModel] = useState(llmSettings.tasks.chat.model)
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>(llmSettings.tasks.embedding.provider)
  const [embeddingModel, setEmbeddingModel] = useState(
    llmSettings.tasks.embedding.model || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
  )
  const [classificationMethod, setClassificationMethod] = useState<ClassificationMethod>(llmSettings.tasks.classification.method)

  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState(llmSettings.providers.lmstudio.baseUrl)
  const [lmStudioApiKey, setLmStudioApiKey] = useState(llmSettings.providers.lmstudio.apiKey)
  const [openRouterApiKey, setOpenRouterApiKey] = useState(llmSettings.providers.openrouter.apiKey)

  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [geminiStatus, setGeminiStatus] = useState<'checking' | 'ready' | 'after-download' | 'unavailable'>('checking')
  const [geminiInfo, setGeminiInfo] = useState<{ apis: string[]; caps?: any }>({ apis: [] })
  const [loadingWebllm, setLoadingWebllm] = useState(false)
  const [webllmReady, setWebllmReady] = useState(false)
  const [webllmCached, setWebllmCached] = useState(false)
  const [loadingEmbeddingModel, setLoadingEmbeddingModel] = useState(false)
  const [embeddingModelCached, setEmbeddingModelCached] = useState(false)

  const nliAvailable = embeddingProvider === 'transformers'

  const checkGemini = useCallback(async () => {
    setGeminiStatus('checking')
    const win = (window as any)
    const ai = win.ai
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
        chat: {
          ...llmSettings.tasks.chat,
          provider: 'gemini-nano',
        },
      },
    }
    const status = await checkLlmAvailability(geminiProbeSettings)
    
    let caps
    const promptApi = win.ai?.languageModel || win.ai?.assistant || win.LanguageModel
    if (promptApi) {
      try {
        caps = await (promptApi.capabilities?.() || promptApi.availability?.())
      } catch (e) {}
    }

    setGeminiInfo({ apis, caps })
    setGeminiStatus(status)
  }, [llmSettings])

  useEffect(() => {
    void checkGemini()
  }, [checkGemini])

  useEffect(() => {
    if (chatProvider !== 'webllm') return
    const modelId = chatModel.trim()
    if (!modelId) {
      setWebllmCached(false)
      return
    }
    let active = true
    void isWebllmModelCached(modelId).then((cached) => {
      if (!active) return
      setWebllmCached(cached)
      if (cached) setWebllmReady(true)
    })
    return () => { active = false }
  }, [chatModel, chatProvider])

  useEffect(() => {
    if (embeddingProvider !== 'transformers') return
    const modelId = (embeddingModel.trim() || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL)
    let active = true
    void isTransformersEmbeddingModelCached(modelId).then((cached) => {
      if (!active) return
      setEmbeddingModelCached(cached)
    })
    return () => { active = false }
  }, [embeddingModel, embeddingProvider])

  const canSave = useMemo(() => {
    if (chatProvider === 'webllm' && !chatModel.trim()) return false
    if (chatProvider === 'lmstudio' && (!lmStudioBaseUrl.trim() || !chatModel.trim())) return false
    if (chatProvider === 'openrouter' && (!openRouterApiKey.trim() || !chatModel.trim())) return false
    if (embeddingProvider === 'lmstudio' && (!lmStudioBaseUrl.trim() || !embeddingModel.trim())) return false
    if (embeddingProvider === 'openrouter' && (!openRouterApiKey.trim() || !embeddingModel.trim())) return false
    return true
  }, [chatModel, chatProvider, embeddingModel, embeddingProvider, lmStudioBaseUrl, openRouterApiKey])

  const handleLoadModels = useCallback(async () => {
    if (!lmStudioBaseUrl.trim()) return
    setLoadingModels(true)
    setError(null)
    try {
      const list = await fetchLmStudioModels({
        ...llmSettings,
        providers: {
          lmstudio: { baseUrl: lmStudioBaseUrl, apiKey: lmStudioApiKey },
          openrouter: { apiKey: openRouterApiKey },
        },
      })
      setModels(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingModels(false)
    }
  }, [llmSettings, lmStudioApiKey, lmStudioBaseUrl, openRouterApiKey])
  
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
      await preloadWebllmModel(chatModel)
      setWebllmReady(true)
      setWebllmCached(true)
    } catch (err) {
      setWebllmReady(false)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingWebllm(false)
    }
  }, [chatModel])

  const handlePreloadEmbeddingModel = useCallback(async () => {
    setError(null)
    setLoadingEmbeddingModel(true)
    try {
      const modelId = embeddingModel.trim() || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL
      await preloadTransformersEmbeddingModel(modelId)
      setEmbeddingModelCached(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingEmbeddingModel(false)
    }
  }, [embeddingModel])

  const handleSave = useCallback(() => {
    onSaveSettings({
      ...llmSettings,
      providers: {
        lmstudio: { baseUrl: lmStudioBaseUrl.trim(), apiKey: lmStudioApiKey.trim() },
        openrouter: { apiKey: openRouterApiKey.trim() },
      },
      tasks: {
        chat: { provider: chatProvider, model: chatModel.trim() },
        embedding: {
          provider: embeddingProvider,
          model: embeddingModel.trim() || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
        },
        classification: {
          method: nliAvailable ? classificationMethod : 'llm',
        },
      },
    })
  }, [chatModel, chatProvider, classificationMethod, embeddingModel, embeddingProvider, llmSettings, lmStudioApiKey, lmStudioBaseUrl, nliAvailable, onSaveSettings, openRouterApiKey])

  return (
    <div className="max-w-4xl space-y-8 py-4">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Providers</h3>
          
          <div className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
            <p className="text-sm font-medium">LM Studio / Ollama</p>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Base URL</label>
              <Input
                value={lmStudioBaseUrl}
                onChange={(e) => setLmStudioBaseUrl(e.target.value)}
                placeholder="http://localhost:1234/v1"
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">API Key (optional)</label>
              <Input
                value={lmStudioApiKey}
                onChange={(e) => setLmStudioApiKey(e.target.value)}
                type="password"
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
            <p className="text-sm font-medium">OpenRouter</p>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">API Key</label>
              <Input
                value={openRouterApiKey}
                onChange={(e) => setOpenRouterApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                type="password"
                className="h-9"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Model Assignments</h3>

          <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Chat & Reasoning</p>
                <Select value={chatProvider} onValueChange={(v) => setChatProvider(v as ChatProvider)}>
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(geminiStatus === 'ready' || geminiStatus === 'after-download') && (
                      <SelectItem value="gemini-nano">Gemini Nano (Chrome Built-in)</SelectItem>
                    )}
                    <SelectItem value="webllm">WebLLM (Local Browser)</SelectItem>
                    <SelectItem value="lmstudio">LM Studio / Ollama</SelectItem>
                    <SelectItem value="openrouter">OpenRouter (Cloud)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {chatProvider !== 'gemini-nano' && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Model ID</label>
                  <div className="flex gap-2">
                    <Input
                      value={chatModel}
                      onChange={(e) => setChatModel(e.target.value)}
                      className="h-9 flex-1"
                    />
                    {chatProvider === 'webllm' && (
                      <Select value={chatModel} onValueChange={setChatModel}>
                        <SelectTrigger className="h-9 w-10 px-0 flex items-center justify-center">
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </SelectTrigger>
                        <SelectContent>
                          {WEBLLM_CHAT_MODELS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {chatProvider === 'webllm' && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant={webllmCached ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={handlePreloadWebllm}
                        disabled={loadingWebllm || !chatModel.trim()}
                        className="h-7 text-[10px]"
                      >
                        {loadingWebllm ? 'Downloading…' : webllmCached ? 'Cached' : 'Download Model'}
                      </Button>
                      {webllmReady && <span className="text-[10px] text-emerald-500">Ready</span>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="h-px bg-border/50" />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Embeddings</p>
                <Select value={embeddingProvider} onValueChange={(v) => setEmbeddingProvider(v as EmbeddingProvider)}>
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transformers">Transformers.js</SelectItem>
                    <SelectItem value="lmstudio">LM Studio</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Model ID</label>
                <Input
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                  className="h-9"
                />
                {embeddingProvider === 'transformers' && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant={embeddingModelCached ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={handlePreloadEmbeddingModel}
                      disabled={loadingEmbeddingModel}
                      className="h-7 text-[10px]"
                    >
                      {loadingEmbeddingModel ? 'Downloading…' : embeddingModelCached ? 'Cached' : 'Download Model'}
                    </Button>
                    {embeddingModelCached && <span className="text-[10px] text-emerald-500">Ready</span>}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            {(chatProvider === 'lmstudio' || embeddingProvider === 'lmstudio') && (
              <Button variant="outline" size="sm" onClick={handleLoadModels} disabled={loadingModels}>
                {loadingModels ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                Refresh Models
              </Button>
            )}
            <Button onClick={handleSave} disabled={!canSave}>
              Save Model Settings
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Built-in AI (Gemini Nano)</h3>
        
        <div className="rounded-lg border border-border bg-card/50 p-6">
          <div className="flex items-start gap-4">
            <div className={`shrink-0 p-2 rounded-md ${
              geminiStatus === 'ready' ? 'bg-emerald-500/10 text-emerald-500' : 
              geminiStatus === 'after-download' ? 'bg-amber-500/10 text-amber-500' :
              geminiStatus === 'checking' ? 'bg-secondary/10 text-secondary' :
              'bg-destructive/10 text-destructive'
            }`}>
              {geminiStatus === 'ready' ? <ShieldCheck className="h-6 w-6" /> : 
               geminiStatus === 'checking' ? <Loader2 className="h-6 w-6 animate-spin" /> :
               <ShieldX className="h-6 w-6" />}
            </div>
            
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {geminiStatus === 'ready' ? 'Gemini Nano is Ready' :
                     geminiStatus === 'after-download' ? 'Gemini Nano is downloading components...' :
                     geminiStatus === 'checking' ? 'Checking compatibility...' :
                     'Gemini Nano is Unsupported'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Chrome's built-in AI for privacy-first, on-device processing.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={checkGemini} className="h-8">
                  <RotateCcw className="h-3.5 w-3.5 mr-2" />
                  Re-check
                </Button>
              </div>

              {geminiStatus === 'unavailable' && (
                <div className="mt-4 rounded border border-destructive/20 bg-destructive/5 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
                    <Info className="h-3.5 w-3.5" />
                    Troubleshooting
                  </div>
                  <ul className="text-[11px] text-muted-foreground list-disc list-inside space-y-2">
                    <li>Use <b>Chrome Dev/Canary</b> (version 127+)</li>
                    <li>
                      Enable <button onClick={() => handleOpenFlag('chrome://flags/#optimization-guide-on-device-model')} className="text-primary hover:underline font-mono bg-background px-1 rounded">#optimization-guide-on-device-model</button> 
                      (Set to <b>Enabled BypassPrefavorite</b>)
                    </li>
                    <li>
                      Enable <button onClick={() => handleOpenFlag('chrome://flags/#prompt-api-for-gemini-nano')} className="text-primary hover:underline font-mono bg-background px-1 rounded">#prompt-api-for-gemini-nano</button>
                    </li>
                    <li className="bg-destructive/10 p-1.5 rounded text-destructive-foreground">
                      ⚠️ <b>Extension Origin Restriction:</b> Chrome often disables <code className="text-[10px]">window.ai</code> for extension pages (<code className="text-[10px]">chrome-extension://</code>). 
                      If Detected APIs is "none" but it works on normal sites, this is the reason.
                    </li>
                    <li>Note: <b>Summarization API</b> is a different feature; TabLab requires <b>Prompt API</b>.</li>
                    <li>Restart Chrome and wait for component download (~2GB)</li>
                  </ul>
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                <p className="text-[10px] text-muted-foreground">
                  Detected APIs: {geminiInfo.apis.length > 0 ? geminiInfo.apis.join(', ') : 'none'}
                </p>
                {geminiInfo.caps && (
                  <p className="text-[10px] text-muted-foreground">
                    Caps: {geminiInfo.caps.available}
                  </p>
                )}
              </div>

              {geminiStatus === 'after-download' && (
                <p className="text-[11px] text-amber-500 italic">
                  Chrome has triggered the model download. This might take a few minutes. 
                  Check <code className="bg-background px-1 rounded">chrome://components</code> for "Optimization Guide On Device Model" progress.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
