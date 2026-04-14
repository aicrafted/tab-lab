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
import { DEFAULT_LOCAL_NETWORKS, DEFAULT_TRANSFORMERS_EMBEDDING_MODEL } from '@/lib/types'
import type { ChatProvider, ClassificationMethod, EmbeddingProvider, LlmSettings } from '@/lib/types'
import {
  isWebllmModelCached,
  preloadWebllmModel,
} from '@/lib/webllm-provider'
import {
  isTransformersEmbeddingModelCached,
  preloadTransformersEmbeddingModel,
} from '@/lib/webgpu-provider'

interface LlmSettingsProps {
  open: boolean
  settings: LlmSettings
  onSave: (settings: LlmSettings) => void
  onClose: () => void
}

const WEBLLM_CHAT_MODELS = [
  'Qwen3-0.6B-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f32_1-MLC',
  'Phi-3.5-mini-instruct-q4f16_1-MLC',
] as const

export function LlmSettingsPanel({ open, settings, onSave, onClose }: LlmSettingsProps) {
  const [chatProvider, setChatProvider] = useState<ChatProvider>(settings.tasks.chat.provider)
  const [chatModel, setChatModel] = useState(settings.tasks.chat.model)
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>(settings.tasks.embedding.provider)
  const [embeddingModel, setEmbeddingModel] = useState(
    settings.tasks.embedding.model || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
  )
  const [classificationMethod, setClassificationMethod] = useState<ClassificationMethod>(settings.tasks.classification.method)

  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState(settings.providers.lmstudio.baseUrl)
  const [lmStudioApiKey, setLmStudioApiKey] = useState(settings.providers.lmstudio.apiKey)
  const [openRouterApiKey, setOpenRouterApiKey] = useState(settings.providers.openrouter.apiKey)
  const [localNetworksText, setLocalNetworksText] = useState(settings.localNetworks.join('\n'))

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
    setChatProvider(settings.tasks.chat.provider)
    setChatModel(settings.tasks.chat.model)
    setEmbeddingProvider(settings.tasks.embedding.provider)
    setEmbeddingModel(settings.tasks.embedding.model || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL)
    setClassificationMethod(settings.tasks.classification.method)

    setLmStudioBaseUrl(settings.providers.lmstudio.baseUrl)
    setLmStudioApiKey(settings.providers.lmstudio.apiKey)
    setOpenRouterApiKey(settings.providers.openrouter.apiKey)
    setLocalNetworksText(settings.localNetworks.join('\n'))

    setModels([])
    setError(null)
    setWebllmReady(false)
    setWebllmCached(false)
    setEmbeddingModelCached(false)
  }, [settings])

  useEffect(() => {
    const geminiProbeSettings: LlmSettings = {
      ...settings,
      tasks: {
        ...settings.tasks,
        chat: {
          ...settings.tasks.chat,
          provider: 'gemini-nano',
        },
      },
    }
    void checkLlmAvailability(geminiProbeSettings).then((status) => {
      setGeminiAvailable(status === 'ready' || status === 'after-download')
    })
  }, [settings])

  useEffect(() => {
    if (!nliAvailable && classificationMethod === 'nli') {
      setClassificationMethod('llm')
    }
  }, [classificationMethod, nliAvailable])

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

  const embeddingProviderChanged = embeddingProvider !== settings.tasks.embedding.provider

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
        localNetworks: settings.localNetworks,
        providers: {
          lmstudio: { baseUrl: lmStudioBaseUrl, apiKey: lmStudioApiKey },
          openrouter: { apiKey: openRouterApiKey },
        },
        tasks: {
          chat: { provider: chatProvider, model: chatModel },
          embedding: { provider: embeddingProvider, model: embeddingModel },
          classification: { method: classificationMethod },
        },
      })
      setModels(list)
      if (list.length === 1 && chatProvider === 'lmstudio' && !chatModel) setChatModel(list[0])
      if (list.length === 1 && embeddingProvider === 'lmstudio' && !embeddingModel) setEmbeddingModel(list[0])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('Failed to fetch')) {
        setError('Connection refused or CORS blocked. Enable CORS in LM Studio server settings, then retry.')
      } else {
        setError(message)
      }
    } finally {
      setLoadingModels(false)
    }
  }, [chatModel, chatProvider, classificationMethod, embeddingModel, embeddingProvider, lmStudioApiKey, lmStudioBaseUrl, openRouterApiKey])

  const handleSave = useCallback(() => {
    const localNetworks = localNetworksText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const nextLocalNetworks = localNetworks.length > 0 ? localNetworks : [...DEFAULT_LOCAL_NETWORKS]
    onSave({
      localNetworks: nextLocalNetworks,
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
    onClose()
  }, [chatModel, chatProvider, classificationMethod, embeddingModel, embeddingProvider, lmStudioApiKey, lmStudioBaseUrl, localNetworksText, nliAvailable, onClose, onSave, openRouterApiKey])

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

  if (!open) return null

  return (
    <div className="mt-2 space-y-4 rounded-md border border-border bg-card p-4 text-sm">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Providers</h3>
          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <p className="text-xs font-medium text-foreground">LM Studio</p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Base URL</label>
              <Input
                value={lmStudioBaseUrl}
                onChange={(event) => setLmStudioBaseUrl(event.target.value)}
                placeholder="http://localhost:1234/v1"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">API Key</label>
              <Input
                value={lmStudioApiKey}
                onChange={(event) => setLmStudioApiKey(event.target.value)}
                placeholder="optional"
                type="password"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <p className="text-xs font-medium text-foreground">OpenRouter</p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">API Key</label>
              <Input
                value={openRouterApiKey}
                onChange={(event) => setOpenRouterApiKey(event.target.value)}
                placeholder="sk-or-v1-..."
                type="password"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Gemini Nano, WebLLM and Transformers.js run locally and do not need provider credentials.
          </p>
        </div>

        <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</h3>

        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <p className="text-xs font-medium text-foreground">Chat</p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Provider</label>
            <Select value={chatProvider} onValueChange={(value) => setChatProvider(value as ChatProvider)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {geminiAvailable && <SelectItem value="gemini-nano">Built-in Gemini Nano</SelectItem>}
                <SelectItem value="webllm">WebLLM (WebGPU local)</SelectItem>
                <SelectItem value="lmstudio">LM Studio / Ollama</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {chatProvider !== 'gemini-nano' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Model</label>
              {chatProvider === 'lmstudio' && models.length > 0 ? (
                <Select value={chatModel} onValueChange={setChatModel}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((item) => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : chatProvider === 'webllm' ? (
                <div className="space-y-2">
                  <Select value={chatModel} onValueChange={setChatModel}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Choose curated model" />
                    </SelectTrigger>
                    <SelectContent>
                      {WEBLLM_CHAT_MODELS.map((item) => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={chatModel}
                    onChange={(event) => setChatModel(event.target.value)}
                    placeholder="Or type another WebLLM model id"
                    className="h-8 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant={webllmCached ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => void handlePreloadWebllm()}
                      disabled={loadingWebllm || !chatModel.trim()}
                      className="h-7 text-xs"
                    >
                      {loadingWebllm ? 'Downloading…' : webllmCached ? 'Model cached' : 'Download model'}
                    </Button>
                    {webllmReady && <span className="text-xs text-emerald-400">Model ready</span>}
                  </div>
                </div>
              ) : (
                <Input
                  value={chatModel}
                  onChange={(event) => setChatModel(event.target.value)}
                  placeholder={chatProvider === 'openrouter' ? 'openrouter model id' : 'model name'}
                  className="h-8 text-xs"
                />
              )}
            </div>
          )}

          {(chatProvider === 'lmstudio' || embeddingProvider === 'lmstudio') && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleLoadModels()}
                disabled={loadingModels}
                className="h-7 text-xs"
              >
                {loadingModels ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                Refresh LM Studio models
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <p className="text-xs font-medium text-foreground">Embedding</p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Provider</label>
            <Select value={embeddingProvider} onValueChange={(value) => setEmbeddingProvider(value as EmbeddingProvider)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transformers">Transformers.js (local)</SelectItem>
                <SelectItem value="lmstudio">LM Studio / Ollama</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            {embeddingProvider === 'lmstudio' && models.length > 0 ? (
              <Select value={embeddingModel} onValueChange={setEmbeddingModel}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select embedding model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
                placeholder={
                  embeddingProvider === 'openrouter'
                    ? 'openrouter embedding model id'
                    : 'Xenova/all-MiniLM-L6-v2'
                }
                className="h-8 text-xs"
              />
            )}
          </div>

          {embeddingProvider === 'transformers' && (
            <div className="flex items-center gap-2">
              <Button
                variant={embeddingModelCached ? 'default' : 'outline'}
                size="sm"
                onClick={() => void handlePreloadEmbeddingModel()}
                disabled={loadingEmbeddingModel}
                className="h-7 text-xs"
              >
                {loadingEmbeddingModel ? 'Downloading…' : embeddingModelCached ? 'Model cached' : 'Download model'}
              </Button>
              {embeddingModelCached && <span className="text-xs text-emerald-400">Embedding model ready</span>}
            </div>
          )}

          {embeddingProviderChanged && (
            <p className="text-xs text-amber-500">Embedding provider changed - re-run embeddings after save.</p>
          )}
        </div>

        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <p className="text-xs font-medium text-foreground">Classification</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={classificationMethod === 'llm' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setClassificationMethod('llm')}
            >
              LLM
            </Button>
            <Button
              type="button"
              variant={classificationMethod === 'nli' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setClassificationMethod('nli')}
              disabled={!nliAvailable}
              title={!nliAvailable ? 'NLI requires embedding provider = Transformers.js' : undefined}
            >
              NLI
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">LLM uses Chat provider above. NLI uses local Transformers.js and is deterministic.</p>
          {!nliAvailable && (
            <p className="text-xs text-amber-500">NLI requires Embedding provider = Transformers.js. Falling back to LLM.</p>
          )}
        </div>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border/70 p-3">
        <p className="text-xs font-medium text-foreground">Local Network Patterns</p>
        <p className="text-[11px] text-muted-foreground">
          One pattern per line: hostname, CIDR or glob (e.g. <code>*.lan</code>).
        </p>
        <textarea
          value={localNetworksText}
          onChange={(event) => setLocalNetworksText(event.target.value)}
          placeholder={DEFAULT_LOCAL_NETWORKS.join('\n')}
          rows={6}
          className="min-h-[120px] w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs">
          Cancel
        </Button>
        <Button variant="default" size="sm" onClick={handleSave} className="h-7 text-xs" disabled={!canSave}>
          Save
        </Button>
      </div>
    </div>
  )
}
