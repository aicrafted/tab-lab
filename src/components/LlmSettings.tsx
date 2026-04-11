import { useCallback, useEffect, useState } from 'react'
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
import type { ChatProvider, EmbeddingProvider, LlmSettings } from '@/lib/types'
import { preloadWebllmModel } from '@/lib/webllm-provider'

interface LlmSettingsProps {
  open: boolean
  settings: LlmSettings
  onSave: (settings: LlmSettings) => void
  onClose: () => void
}

export function LlmSettingsPanel({ open, settings, onSave, onClose }: LlmSettingsProps) {
  const [chatProvider, setChatProvider] = useState<ChatProvider>(settings.chatProvider)
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>(settings.embeddingProvider)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)
  const [embeddingModel, setEmbeddingModel] = useState(settings.embeddingModel)
  const [webllmModel, setWebllmModel] = useState(settings.webllmModel)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [geminiAvailable, setGeminiAvailable] = useState(false)
  const [loadingWebllm, setLoadingWebllm] = useState(false)
  const [webllmReady, setWebllmReady] = useState(false)

  useEffect(() => {
    setChatProvider(settings.chatProvider)
    setEmbeddingProvider(settings.embeddingProvider)
    setBaseUrl(settings.baseUrl)
    setApiKey(settings.apiKey)
    setModel(settings.model)
    setEmbeddingModel(settings.embeddingModel)
    setWebllmModel(settings.webllmModel)
    setModels([])
    setError(null)
    setWebllmReady(false)
  }, [settings])

  useEffect(() => {
    void checkLlmAvailability({ ...settings, chatProvider: 'gemini-nano' }).then((status) => {
      setGeminiAvailable(status === 'ready' || status === 'after-download')
    })
  }, [settings])

  const handleLoadModels = useCallback(async () => {
    if (chatProvider !== 'lmstudio' && embeddingProvider !== 'lmstudio') return
    setLoadingModels(true)
    setError(null)
    try {
      const list = await fetchLmStudioModels({
        chatProvider,
        embeddingProvider,
        baseUrl,
        apiKey,
        model,
        embeddingModel,
        webllmModel,
      })
      setModels(list)
      if (list.length === 1 && !model) setModel(list[0])
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
  }, [chatProvider, embeddingProvider, baseUrl, apiKey, model, embeddingModel, webllmModel])

  const handleSave = useCallback(() => {
    onSave({
      chatProvider,
      embeddingProvider,
      baseUrl,
      apiKey,
      model,
      embeddingModel,
      webllmModel,
    })
    onClose()
  }, [chatProvider, embeddingProvider, baseUrl, apiKey, model, embeddingModel, webllmModel, onSave, onClose])

  const handlePreloadWebllm = useCallback(async () => {
    setError(null)
    setLoadingWebllm(true)
    try {
      await preloadWebllmModel(webllmModel)
      setWebllmReady(true)
    } catch (err) {
      setWebllmReady(false)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingWebllm(false)
    }
  }, [webllmModel])

  if (!open) return null

  const embeddingProviderChanged = embeddingProvider !== settings.embeddingProvider
  const showLmStudioFields = chatProvider === 'lmstudio' || embeddingProvider === 'lmstudio'

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border bg-card p-4 text-sm">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Chat provider</label>
        <Select value={chatProvider} onValueChange={(value) => setChatProvider(value as ChatProvider)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {geminiAvailable && <SelectItem value="gemini-nano">Built-in Gemini Nano</SelectItem>}
            <SelectItem value="lmstudio">LM Studio / Ollama</SelectItem>
            <SelectItem value="webllm">WebLLM (WebGPU, local GPU)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Embedding provider</label>
        <Select value={embeddingProvider} onValueChange={(value) => setEmbeddingProvider(value as EmbeddingProvider)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lmstudio">LM Studio / Ollama</SelectItem>
            <SelectItem value="transformers">Transformers.js (local, CPU, ~23 MB)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {embeddingProviderChanged && (
        <p className="text-xs text-amber-500">
          Embedding provider changed - cached embeddings are invalid. Re-run embeddings after saving.
        </p>
      )}

      {showLmStudioFields && (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Base URL</label>
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://localhost:1234/v1"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">API Key</label>
            <Input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="optional"
              type="password"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <div className="flex gap-2">
              {models.length > 1 ? (
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((item) => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="model name"
                  className="h-8 flex-1 text-xs"
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadModels}
                disabled={loadingModels}
                className="h-8 w-8 shrink-0 p-0"
                title="Load models"
              >
                {loadingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {embeddingProvider === 'lmstudio' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Embedding model <span className="opacity-50">(optional)</span>
              </label>
              <Input
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
                placeholder="nomic-embed-text (leave empty to use chat model)"
                className="h-8 text-xs"
              />
            </div>
          )}
        </>
      )}

      {chatProvider === 'webllm' && (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">WebLLM model</label>
            <Input
              value={webllmModel}
              onChange={(event) => setWebllmModel(event.target.value)}
              placeholder="Llama-3.2-1B-Instruct-q4f32_1-MLC"
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Downloads on first use (~800 MB - 2 GB) and caches in browser. Requires WebGPU.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handlePreloadWebllm()}
              disabled={loadingWebllm || !webllmModel.trim()}
              className="h-7 text-xs"
            >
              {loadingWebllm ? 'Downloading…' : 'Download model'}
            </Button>
            {webllmReady && (
              <span className="text-xs text-emerald-400">Model ready</span>
            )}
          </div>
        </div>
      )}

      {chatProvider === 'gemini-nano' && (
        <p className="text-xs text-muted-foreground">
          Uses built-in Gemini Nano for chat.
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs">
          Cancel
        </Button>
        <Button variant="default" size="sm" onClick={handleSave} className="h-7 text-xs">
          Save
        </Button>
      </div>
    </div>
  )
}
