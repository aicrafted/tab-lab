// MV3 service worker — no persistent state here.
// All state lives in chrome.storage.local or the page's React state.

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

// Track active tab so side panel always knows current context
let activeTabId: number | null = null

chrome.tabs.onActivated.addListener((info) => {
  activeTabId = info.tabId
  // Notify side panel if it's open
  void chrome.runtime.sendMessage({ type: 'tabActivated', tabId: info.tabId }).catch(() => {})
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.status === 'complete') {
    void chrome.runtime.sendMessage({ type: 'tabActivated', tabId }).catch(() => {})
  }
})

// Messaging: side panel requests data
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getSidePanelData') {
    void (async () => {
      try {
        const [tabs, bookmarks] = await Promise.all([
          chrome.tabs.query({}),
          chrome.bookmarks.getTree(),
        ])
        sendResponse({ tabs, bookmarks })
      } catch (err) {
        sendResponse({ error: String(err) })
      }
    })()
    return true // keep channel open for async response
  }
})
