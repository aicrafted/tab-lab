// popup — two buttons: Side Panel / Full View
document.getElementById('openPanel')?.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.windowId != null) void chrome.sidePanel.open({ windowId: tab.windowId })
  })
  window.close()
})

document.getElementById('openFull')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/main/index.html') })
  window.close()
})
