import { IS_FIREFOX } from '@/lib/core/browser-detect'

const OFFSCREEN_URL = 'offscreen.html'
const DEFAULT_TRANSFORMERS_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

async function ensureOffscreen(): Promise<void> {
  if (IS_FIREFOX) return
  const hasDocument = await chrome.offscreen.hasDocument()
  if (!hasDocument) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Run Transformers.js ONNX inference for embeddings',
    })
  }
}

function sendToOffscreen<T>(msg: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? 'Offscreen call failed'))
        return
      }
      resolve(response as T)
    })
  })
}

export async function webgpuEmbed(text: string, model = DEFAULT_TRANSFORMERS_EMBEDDING_MODEL): Promise<number[]> {
  if (IS_FIREFOX) throw new Error('WebGPU embedding not supported in Firefox')
  await ensureOffscreen()
  const response = await sendToOffscreen<{ ok: true; vector: number[] }>({
    type: 'WEBGPU_EMBED',
    text,
    model,
  })
  return response.vector
}

export async function preloadTransformersEmbeddingModel(
  model = DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
): Promise<void> {
  if (IS_FIREFOX) return
  await ensureOffscreen()
  await sendToOffscreen<{ ok: true }>({
    type: 'WEBGPU_EMBED_PRELOAD',
    model,
  })
}

export async function isTransformersEmbeddingModelCached(
  model = DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
): Promise<boolean> {
  if (IS_FIREFOX) return false
  await ensureOffscreen()
  const response = await sendToOffscreen<{ ok: true; cached: boolean }>({
    type: 'WEBGPU_EMBED_CHECK_CACHE',
    model,
  })
  return response.cached
}
