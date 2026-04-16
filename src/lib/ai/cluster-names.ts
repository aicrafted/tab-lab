const STORAGE_KEY = 'clusterNames'

export async function saveClusterNames(names: Map<number, string>): Promise<void> {
  const payload: Record<string, string> = {}
  for (const [clusterId, name] of names.entries()) {
    payload[String(clusterId)] = name
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: payload })
}

export async function loadClusterNames(): Promise<Map<number, string>> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY)
    const raw = stored[STORAGE_KEY]
    if (!raw || typeof raw !== 'object') return new Map()
    const map = new Map<number, string>()
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = Number.parseInt(key, 10)
      if (!Number.isFinite(parsed) || typeof value !== 'string') continue
      map.set(parsed, value)
    }
    return map
  } catch {
    return new Map()
  }
}
