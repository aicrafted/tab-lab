const OFFSCREEN_URL = 'offscreen.html'

async function ensureOffscreen(): Promise<void> {
  if (!chrome.offscreen) {
    throw new Error('chrome.offscreen API is unavailable')
  }
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

export async function webgpuEmbed(text: string): Promise<number[]> {
  await ensureOffscreen()
  const response = await sendToOffscreen<{ ok: true; vector: number[] }>({
    type: 'WEBGPU_EMBED',
    text,
  })
  return response.vector
}
