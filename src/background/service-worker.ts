import { initDomainData } from '@/lib/ai/domain-prefill'

void initDomainData()

const MAX_HISTORY = 50
let activeTabId: number | null = null

chrome.tabs.onActivated.addListener(async (info) => {
  activeTabId = info.tabId
  void chrome.runtime.sendMessage({ type: 'tabActivated', tabId: info.tabId }).catch(() => {})

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
    const next = [entry, ...tabHistory.filter((h: { tabId: number }) => h.tabId !== info.tabId)].slice(0, MAX_HISTORY)
    await chrome.storage.session.set({ tabHistory: next })
  } catch {
  }
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const { tabHistory = [] } = await chrome.storage.session.get('tabHistory')
    await chrome.storage.session.set({
      tabHistory: tabHistory.filter((h: { tabId: number }) => h.tabId !== tabId),
    })
  } catch {
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.status === 'complete') {
    void chrome.runtime.sendMessage({ type: 'tabActivated', tabId }).catch(() => {})
  }
})

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/pages/main/index.html'),
  })
})

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-side-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.windowId != null) {
        void chrome.sidePanel.open({ windowId: tab.windowId })
      }
    })
  }
})

function injectElementPicker() {
  const win = window as any
  if (win.__tabLabPickerActive) return

  win.__tabLabPickerActive = true
  let hovered: HTMLElement | null = null
  const HIGHLIGHT_STYLE = '2px solid #3b82f6'

  function highlight(el: HTMLElement | null) {
    if (hovered && hovered !== el) {
      hovered.style.outline = ''
    }
    hovered = el
    if (el) {
      el.style.outline = HIGHLIGHT_STYLE
    }
  }

  function onMouseOver(e: MouseEvent) {
    highlight(e.target as HTMLElement | null)
  }

  function onMouseOut() {
    highlight(null)
  }

  function cleanup() {
    document.removeEventListener('mouseover', onMouseOver, true)
    document.removeEventListener('mouseout', onMouseOut, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    highlight(null)
    win.__tabLabPickerActive = false
    delete win.__tabLabPickerCleanup
  }

  function onClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    const target = e.target as HTMLElement | null
    const text = target?.innerText?.replace(/\s{3,}/g, '\n\n').trim().slice(0, 12_000) ?? ''
    cleanup()
    void chrome.runtime.sendMessage({ type: 'elementPickerResult', text }).catch(() => {})
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    cleanup()
    void chrome.runtime.sendMessage({ type: 'elementPickerCancelled' }).catch(() => {})
  }

  win.__tabLabPickerCleanup = cleanup

  document.addEventListener('mouseover', onMouseOver, true)
  document.addEventListener('mouseout', onMouseOut, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getSidePanelData') {
    void (async () => {
      try {
        const [tabs, bookmarks, { tabHistory = [] }] = await Promise.all([
          chrome.tabs.query({}),
          chrome.bookmarks.getTree(),
          chrome.storage.session.get('tabHistory'),
        ])
        const liveTabIds = new Set(tabs.map((t) => t.id))
        const filteredHistory = (tabHistory as { tabId: number }[]).filter((h) => liveTabIds.has(h.tabId))
        sendResponse({ tabs, bookmarks, tabHistory: filteredHistory })
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

  if (msg.type === 'startElementPicker') {
    void (async () => {
      try {
        const tabId: number = msg.tabId
        await chrome.scripting.executeScript({
          target: { tabId },
          func: injectElementPicker,
        })
        sendResponse({ ok: true })
      } catch (err) {
        sendResponse({ error: String(err) })
      }
    })()
    return true
  }

  if (msg.type === 'cancelElementPicker') {
    void (async () => {
      try {
        const tabId: number = msg.tabId
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const win = window as any
            if (typeof win.__tabLabPickerCleanup === 'function') {
              win.__tabLabPickerCleanup()
            }
          },
        })
        sendResponse({ ok: true })
      } catch (err) {
        sendResponse({ error: String(err) })
      }
    })()
    return true
  }
})
