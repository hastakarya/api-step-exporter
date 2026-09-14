// Relay for the DevTools panel on Firefox, where browser.tabs is not
// exposed to panel documents (only to the background script). Chrome's
// panel has full chrome.tabs access already, so it never sends this
// message — this listener only ever fires there on Firefox.
const isFirefox = typeof browser !== 'undefined';

function captureTab(tabId) {
  if (isFirefox) {
    return browser.tabs.get(tabId).then((tab) => browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (shot) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(shot);
      });
    });
  });
}

const runtime = isFirefox ? browser.runtime : chrome.runtime;

runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'CAPTURE_TAB') return undefined;
  captureTab(message.tabId)
    .then((shot) => sendResponse({ ok: true, shot }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the message channel open for the async response
});
