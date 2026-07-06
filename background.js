// background.js — MV3 service worker. The devtools HAR API only reports
// *finished* requests, so this worker relays webRequest lifecycle events
// (start / done / error) to any connected CipherNet panel, keyed by tab,
// letting the panel show "(pending)" rows like Chrome's own Network panel.
//
// A panel connects a port named "ciphernet-live" and sends { type: "watch", tabId }.
// Events for that tab are forwarded until the port closes. The panel
// reconnects if Chrome shuts this worker down (webRequest events wake it).

const watchers = new Map(); // tabId -> Set<Port>

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ciphernet-live") return;
  let tabId = null;
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === "watch" && typeof msg.tabId === "number") {
      tabId = msg.tabId;
      if (!watchers.has(tabId)) watchers.set(tabId, new Set());
      watchers.get(tabId).add(port);
    }
  });
  port.onDisconnect.addListener(() => {
    if (tabId === null) return;
    const set = watchers.get(tabId);
    if (set) {
      set.delete(port);
      if (!set.size) watchers.delete(tabId);
    }
  });
});

function relay(tabId, msg) {
  const set = watchers.get(tabId);
  if (!set) return;
  for (const port of set) {
    try { port.postMessage(msg); } catch { /* port closed mid-send */ }
  }
}

const FILTER = { urls: ["<all_urls>"] };

chrome.webRequest.onBeforeRequest.addListener((d) => {
  relay(d.tabId, {
    kind: "start",
    requestId: d.requestId,
    url: d.url,
    method: d.method,
    resourceType: d.type,
    ts: d.timeStamp,
    initiator: d.initiator || "",
  });
}, FILTER);

chrome.webRequest.onCompleted.addListener((d) => {
  relay(d.tabId, { kind: "done", requestId: d.requestId, statusCode: d.statusCode });
}, FILTER);

chrome.webRequest.onErrorOccurred.addListener((d) => {
  relay(d.tabId, { kind: "error", requestId: d.requestId, error: d.error });
}, FILTER);
