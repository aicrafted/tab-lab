import { env, pipeline } from '@xenova/transformers'

env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/')
env.allowRemoteModels = true

let embedPipe: any = null

async function getEmbedPipe(): Promise<any> {
  if (!embedPipe) {
    embedPipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    })
  }
  return embedPipe
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'WEBGPU_EMBED') {
    getEmbedPipe()
      .then(async (pipe) => {
        const output = await pipe(msg.text, { pooling: 'mean', normalize: true })
        sendResponse({ ok: true, vector: Array.from(output.data as Float32Array) })
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }

  return false
})
