import { useEffect, useRef } from 'react'

/**
 * Hook to synchronize React state with browser events (tabs, bookmarks).
 * Useful for SidePanel and Main views to keep data fresh without page reload.
 */
export function useBrowserStateSync(onSync: () => void, debounceMs = 300) {
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const onSyncRef = useRef(onSync)
  onSyncRef.current = onSync

  useEffect(() => {
    const trigger = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        onSyncRef.current()
      }, debounceMs)
    }

    // Tab events
    const tabHandler = () => trigger()
    chrome.tabs.onCreated.addListener(tabHandler)
    chrome.tabs.onUpdated.addListener(tabHandler)
    chrome.tabs.onRemoved.addListener(tabHandler)
    chrome.tabs.onActivated.addListener(tabHandler)
    chrome.tabs.onMoved.addListener(tabHandler)
    chrome.tabs.onAttached.addListener(tabHandler)
    chrome.tabs.onDetached.addListener(tabHandler)

    // Bookmark events
    const bookmarkHandler = () => trigger()
    chrome.bookmarks.onCreated.addListener(bookmarkHandler)
    chrome.bookmarks.onRemoved.addListener(bookmarkHandler)
    chrome.bookmarks.onChanged.addListener(bookmarkHandler)
    chrome.bookmarks.onMoved.addListener(bookmarkHandler)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      
      chrome.tabs.onCreated.removeListener(tabHandler)
      chrome.tabs.onUpdated.removeListener(tabHandler)
      chrome.tabs.onRemoved.removeListener(tabHandler)
      chrome.tabs.onActivated.removeListener(tabHandler)
      chrome.tabs.onMoved.removeListener(tabHandler)
      chrome.tabs.onAttached.removeListener(tabHandler)
      chrome.tabs.onDetached.removeListener(tabHandler)

      chrome.bookmarks.onCreated.removeListener(bookmarkHandler)
      chrome.bookmarks.onRemoved.removeListener(bookmarkHandler)
      chrome.bookmarks.onChanged.removeListener(bookmarkHandler)
      chrome.bookmarks.onMoved.removeListener(bookmarkHandler)
    }
  }, [debounceMs])
}
