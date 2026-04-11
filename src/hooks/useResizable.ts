import { useCallback, useEffect, useState } from 'react'

const SIDEBAR_WIDTH_KEY = 'sidebarWidth'
const STORAGE_KEEP_KEYS = new Set(['settings', 'lastScan', SIDEBAR_WIDTH_KEY])

function useResizable(
  initial: number,
  min: number,
  max: number,
): { width: number; startDrag: (e: React.MouseEvent) => void } {
  const [width, setWidth] = useState(initial)

  // Load persisted width on mount
  useEffect(() => {
    chrome.storage.local.get(SIDEBAR_WIDTH_KEY)
      .then(result => {
        const w = result[SIDEBAR_WIDTH_KEY] as number | undefined
        if (w && w >= min && w <= max) setWidth(w)
      })
      .catch(() => {
      })
  }, [min, max])

  const startDrag = useCallback((e: React.MouseEvent) => {
    const startX = e.clientX
    const startW = width

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(e: MouseEvent) {
      const next = Math.min(max, Math.max(min, startW + e.clientX - startX))
      setWidth(next)
    }
    function onUp() {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      void saveSidebarWidth(width)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }, [width, min, max])

  return { width, startDrag }
}

async function saveSidebarWidth(width: number): Promise<void> {
  try {
    await chrome.storage.local.set({ [SIDEBAR_WIDTH_KEY]: width })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.toLowerCase().includes('quota')) return

    try {
      const all = await chrome.storage.local.get(null)
      const staleKeys = Object.keys(all).filter((key) => !STORAGE_KEEP_KEYS.has(key))
      if (staleKeys.length > 0) {
        await chrome.storage.local.remove(staleKeys)
        await chrome.storage.local.set({ [SIDEBAR_WIDTH_KEY]: width })
      }
    } catch {
    }
  }
}

export { useResizable }
