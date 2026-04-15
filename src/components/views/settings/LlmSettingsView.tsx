import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
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
import { DEFAULT_TRANSFORMERS_EMBEDDING_MODEL, DEFAULT_LOCAL_NETWORKS } from '@/lib/types'
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
  'Qwen3-0.6B-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f32_1-MLC',
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
  const [geminiAvailable, setGeminiAvailable] = useState(false)
  const [loadingWebllm, setLoadingWebllm] = useState(false)
  const [webllmReady, setWebllmReady] = useState(false)
  const [webllmCached, setWebllmCached] = useState(false)
  const [loadingEmbeddingModel, setLoadingEmbeddingModel] = useState(false)
  const [embeddingModelCached, setEmbeddingModelCached] = useState(false)

  const nliAvailable = embeddingProvider === 'transformers'

  useEffect(() => {
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
    void checkLlmAvailability(geminiProbeSettings).then((status) => {
      setGeminiAvailable(status === 'ready' || status === 'after-download')
    })
  }, [llmSettings])

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
    <div className="max-w-4xl space-y-6 py-4">
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
                    {geminiAvailable && <SelectItem value="gemini-nano">Gemini Nano</SelectItem>}
                    <SelectItem value="webllm">WebLLM (Local)</SelectItem>
                    <SelectItem value="lmstudio">LM Studio</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {chatProvider !== 'gemini-nano' && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Model ID</label>
                  <Input
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    className="h-9"
                  />
                  {chatProvider === 'webllm' && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant={webllmCached ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={handlePreloadWebllm}
                        disabled={loadingWebllm || !chatModel.trim()}
                        className="h-7 text-[10px]"
                      >
                        {loadingWebllm ? 'Downloading…' : webllmCached ? 'Cached' : 'Download'}
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
                      {loadingEmbeddingModel ? 'Downloading…' : embeddingModelCached ? 'Cached' : 'Download'}
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

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
