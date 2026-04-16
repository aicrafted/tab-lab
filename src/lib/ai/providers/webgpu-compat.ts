const PATCH_FLAG = '__tabmind_request_adapter_patched__'

type RequestAdapterOptions = { powerPreference?: unknown } & Record<string, unknown>
type GpuLike = {
  requestAdapter?: (options?: RequestAdapterOptions) => Promise<unknown>
  [PATCH_FLAG]?: boolean
}

function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = typeof navigator.platform === 'string' ? navigator.platform.toLowerCase() : ''
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent.toLowerCase() : ''
  return platform.includes('win') || ua.includes('windows')
}

export function patchRequestAdapterForWindows(): void {
  if (typeof navigator === 'undefined' || !isWindowsPlatform()) return
  const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu
  if (!gpu?.requestAdapter || gpu[PATCH_FLAG]) return

  const original = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = (options?: RequestAdapterOptions) => {
    if (!options || !('powerPreference' in options)) {
      return original(options)
    }
    const nextOptions = { ...options }
    delete nextOptions.powerPreference
    return original(nextOptions)
  }
  gpu[PATCH_FLAG] = true
}
