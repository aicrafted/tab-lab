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
}

interface WebgpuEmbedSuccess {
  ok: true
  vector: number[]
}

interface WebgpuEmbedFailure {
  ok: false
  error: string
}

let embedPipe: EmbedPipeline | null = null

async function getEmbedPipe(): Promise<EmbedPipeline> {
  if (!embedPipe) {
    const instance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    })
    embedPipe = instance as unknown as EmbedPipeline
  }
  return embedPipe
}

function isWebgpuEmbedMessage(msg: unknown): msg is WebgpuEmbedMessage {
  return Boolean(
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    'text' in msg &&
    (msg as Record<string, unknown>).type === 'WEBGPU_EMBED' &&
    typeof (msg as Record<string, unknown>).text === 'string',
  )
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse: (response: WebgpuEmbedSuccess | WebgpuEmbedFailure) => void) => {
  if (isWebgpuEmbedMessage(msg)) {
    getEmbedPipe()
      .then(async (pipe) => {
        const output = await pipe(msg.text, { pooling: 'mean', normalize: true })
        sendResponse({ ok: true, vector: Array.from(output.data) })
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }

  return false
})
