// MV3 service worker — no persistent state here.
// All state lives in chrome.storage.local or the page's React state.

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/pages/main/index.html'),
  })
})
