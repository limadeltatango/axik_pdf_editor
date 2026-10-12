/**
 * Minimal MV3 action handler. It never fetches arbitrary URLs, injects scripts,
 * requests host access, or stores PDF contents in a service worker global.
 */
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});
