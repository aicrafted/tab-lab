// MV3 service worker — no persistent state here.
// All state lives in chrome.storage.local or the page's React state.
import { initDomainData } from '@/lib/ai/domain-prefill'

// Initialize domain data at startup
void initDomainData()

const MAX_HISTORY = 50
let activeTabId: number | null = null

// Track active tab for history tracking + side panel notification
chrome.tabs.onActivated.addListener(async (info) => {
  activeTabId = info.tabId
  // Notify side panel
  void chrome.runtime.sendMessage({ type: 'tabActivated', tabId: info.tabId }).catch(() => {})

  // Record in history
  try {
    const tab = await chrome.tabs.get(info.tabId)
    if (!tab.url || tab.url.startsWith('chrome://')) return

    const { tabHistory = [] } = await chrome.storage.session.get('tabHistory')
    const entry = {
      tabId: info.tabId,
      windowId: info.windowId,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      ts: Date.now(),
    }
    // Deduplicate by tabId — move existing entry to top
    const next = [entry, ...tabHistory.filter((h: { tabId: number }) => h.tabId !== info.tabId)].slice(0, MAX_HISTORY)
    await chrome.storage.session.set({ tabHistory: next })
  } catch {
    // ignore errors (tab may have been closed)
  }
})

// Remove closed tabs from history
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const { tabHistory = [] } = await chrome.storage.session.get('tabHistory')
    await chrome.storage.session.set({
      tabHistory: tabHistory.filter((h: { tabId: number }) => h.tabId !== tabId),
    })
  } catch {
    // ignore
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.status === 'complete') {
    void chrome.runtime.sendMessage({ type: 'tabActivated', tabId }).catch(() => {})
  }
})

// Full page: open TabLab in a new tab
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/pages/main/index.html'),
  })
})

// Side panel: open for current window
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-side-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.windowId != null) {
        void chrome.sidePanel.open({ windowId: tab.windowId })
      }
    })
  }
})

// Messaging: side panel requests data
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getSidePanelData') {
    void (async () => {
      try {
        const [tabs, bookmarks, { tabHistory = [] }] = await Promise.all([
          chrome.tabs.query({}),
          chrome.bookmarks.getTree(),
          chrome.storage.session.get('tabHistory'),
        ])
        sendResponse({ tabs, bookmarks, tabHistory })
      } catch (err) {
        sendResponse({ error: String(err) })
      }
    })()
    return true // keep channel open for async response
  }

  if (msg.type === 'extractPageText') {
    void (async () => {
      try {
        const tabId: number = msg.tabId
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const clone = document.body.cloneNode(true) as HTMLElement
            clone.querySelectorAll('script,style,nav,footer,header,aside').forEach((el) => el.remove())
            return clone.innerText.replace(/\s{3,}/g, '\n\n').trim().slice(0, 12_000)
          },
        })
        sendResponse({ text: results[0]?.result ?? '' })
      } catch (err) {
        sendResponse({ error: String(err) })
      }
    })()
    return true
  }
})
