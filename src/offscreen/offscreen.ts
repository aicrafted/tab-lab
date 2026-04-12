import { env, pipeline } from '@xenova/transformers'

env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/')
env.allowRemoteModels = true

interface FeatureExtractionOutput {
  data: Float32Array | number[]
}

type EmbedPipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: true },
) => Promise<FeatureExtractionOutput>

interface WebgpuEmbedMessage {
  type: 'WEBGPU_EMBED'
  text: string
  model?: string
}
interface WebgpuEmbedPreloadMessage {
  type: 'WEBGPU_EMBED_PRELOAD'
  model?: string
}
interface WebgpuEmbedCheckCacheMessage {
  type: 'WEBGPU_EMBED_CHECK_CACHE'
  model?: string
}

interface WebgpuEmbedSuccess {
  ok: true
  vector: number[]
}
interface WebgpuEmbedPreloadSuccess {
  ok: true
}
interface WebgpuEmbedCheckCacheSuccess {
  ok: true
  cached: boolean
}

interface WebgpuEmbedFailure {
  ok: false
  error: string
}

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
const embedPipes = new Map<string, EmbedPipeline>()

async function getEmbedPipe(model: string): Promise<EmbedPipeline> {
  const targetModel = model.trim() || DEFAULT_MODEL
  const cached = embedPipes.get(targetModel)
  if (cached) return cached

  const instance = await pipeline('feature-extraction', targetModel, {
      quantized: true,
  })
  const pipe = instance as unknown as EmbedPipeline
  embedPipes.set(targetModel, pipe)
  return pipe
}

async function isModelCached(model: string): Promise<boolean> {
  const targetModel = model.trim() || DEFAULT_MODEL
  if (embedPipes.has(targetModel)) return true
  try {
    const instance = await pipeline('feature-extraction', targetModel, {
      quantized: true,
      local_files_only: true,
    })
    embedPipes.set(targetModel, instance as unknown as EmbedPipeline)
    return true
  } catch {
    return false
  }
}

function isWebgpuEmbedMessage(msg: unknown): msg is WebgpuEmbedMessage {
  return Boolean(
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    'text' in msg &&
    (msg as Record<string, unknown>).type === 'WEBGPU_EMBED' &&
    typeof (msg as Record<string, unknown>).text === 'string' &&
    (!('model' in (msg as Record<string, unknown>)) || typeof (msg as Record<string, unknown>).model === 'string'),
  )
}

function isWebgpuEmbedPreloadMessage(msg: unknown): msg is WebgpuEmbedPreloadMessage {
  return Boolean(
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    (msg as Record<string, unknown>).type === 'WEBGPU_EMBED_PRELOAD' &&
    (!('model' in (msg as Record<string, unknown>)) || typeof (msg as Record<string, unknown>).model === 'string'),
  )
}

function isWebgpuEmbedCheckCacheMessage(msg: unknown): msg is WebgpuEmbedCheckCacheMessage {
  return Boolean(
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    (msg as Record<string, unknown>).type === 'WEBGPU_EMBED_CHECK_CACHE' &&
    (!('model' in (msg as Record<string, unknown>)) || typeof (msg as Record<string, unknown>).model === 'string'),
  )
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse: (response: WebgpuEmbedSuccess | WebgpuEmbedPreloadSuccess | WebgpuEmbedCheckCacheSuccess | WebgpuEmbedFailure) => void) => {
  if (isWebgpuEmbedMessage(msg)) {
    getEmbedPipe(msg.model ?? DEFAULT_MODEL)
      .then(async (pipe) => {
        const output = await pipe(msg.text, { pooling: 'mean', normalize: true })
        sendResponse({ ok: true, vector: Array.from(output.data) })
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }
  if (isWebgpuEmbedPreloadMessage(msg)) {
    getEmbedPipe(msg.model ?? DEFAULT_MODEL)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }
  if (isWebgpuEmbedCheckCacheMessage(msg)) {
    isModelCached(msg.model ?? DEFAULT_MODEL)
      .then((cached) => sendResponse({ ok: true, cached }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }

  return false
})
