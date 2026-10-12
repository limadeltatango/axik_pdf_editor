/**
 * MV3 startup: user gesture to launch tab, or user-initiated link context menu.
 * No automatic interception, document fetch or arbitrary script injection.
 */
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

const CONTEXT_MENU_ID = "axik-open-pdf-link";
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Open PDF link with Axik PDF Editor",
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.linkUrl ||
      info.linkUrl.length > 8000) return;
  try {
    const url = new URL(info.linkUrl);
    if (!["https:", "http:"].includes(url.protocol) ||
        url.username || url.password) return;
    const viewer = chrome.runtime.getURL("viewer.html");
    void chrome.tabs.create({ url: viewer + "?sourceUrl=" + encodeURIComponent(url.toString()) });
  } catch {
    // Ignore invalid/inaccessible link URLs. Nothing is fetched automatically.
  }
});
