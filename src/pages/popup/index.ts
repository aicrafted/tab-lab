// popup — two buttons: Side Panel / Full View
document.getElementById('openPanel')?.addEventListener('click', () => {
  // Route through background so popup.js has no direct sidePanel/sidebarAction reference
  void chrome.runtime.sendMessage({ type: 'openSidePanel' })
  window.close()
})

document.getElementById('openFull')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/main/index.html') })
  window.close()
})
