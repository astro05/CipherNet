// background.js — MV3 service worker. Two jobs:
//
// 1. Live request relay. The devtools HAR API only reports *finished* requests,
//    so this worker relays webRequest lifecycle events (start / done / error) to
//    any connected CipherNet panel, keyed by tab, letting the panel show
//    "(pending)" rows like Chrome's own Network panel.
//
//    A panel connects a port named "ciphernet-live" and sends { type: "watch", tabId }.
//    Events for that tab are forwarded until the port closes. The panel
//    reconnects if Chrome shuts this worker down (webRequest events wake it).
//
// 2. Backup file I/O (see the "backup" section at the bottom). Chrome erases an
//    extension's storage when it is removed, so Collections + History are
//    mirrored to a real file on disk via the File System Access API. The panel
//    runs in a cross-origin iframe, where Chrome refuses to run file I/O, so the
//    panel messages this worker — a top-level, same-origin context — to do it.

import { idbGet, idbDelete, HANDLE_KEY } from "./src/services/handleStore.js";
import { logError } from "./src/core/errorLog.js";

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

/* ---------------------------- backup file I/O ---------------------------- */
// Division of labour, forced by where Chrome allows what:
//   - Picking a file and granting permission need a *top-level page* with a user
//     gesture  -> backup.html.
//   - Reading/writing an already-granted handle must not happen in a cross-origin
//     iframe (which is what a DevTools panel is) -> this worker.
// The panel therefore asks this worker for every read/write. The handle itself
// lives in IndexedDB — see services/handleStore.js.

// { linked, name, ready } — `ready` means the handle still holds readwrite
// permission, so this worker can use it without a user gesture. Chrome can drop
// that grant (e.g. after a browser restart), which is a re-authorise prompt in
// the panel, not an error.
async function backupStatus() {
  let handle = null;
  try { handle = await idbGet(HANDLE_KEY); } catch (err) { logError("background.backupStatus.idb", err); }
  if (!handle) return { linked: false, name: "", ready: false };
  let perm = "prompt";
  try { perm = await handle.queryPermission({ mode: "readwrite" }); } catch (err) { logError("background.backupStatus.perm", err); }
  return { linked: true, name: handle.name || "", ready: perm === "granted" };
}

async function backupRead() {
  try {
    const handle = await idbGet(HANDLE_KEY);
    if (!handle) return { ok: false, reason: "not-linked" };
    if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
      return { ok: false, reason: "not-authorized" };
    }
    const file = await handle.getFile();
    return { ok: true, text: await file.text(), name: handle.name };
  } catch (err) {
    logError("background.backupRead", err);
    return { ok: false, reason: err.message || "read failed" };
  }
}

async function backupWrite(text) {
  try {
    const handle = await idbGet(HANDLE_KEY);
    if (!handle) return { ok: false, reason: "not-linked" };
    if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
      return { ok: false, reason: "not-authorized" };
    }
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return { ok: true, name: handle.name };
  } catch (err) {
    logError("background.backupWrite", err);
    return { ok: false, reason: err.message || "write failed" };
  }
}

// The panel can't open a tab itself (DevTools pages get a reduced API surface),
// so it asks this worker to open the helper page in the mode it needs.
function openHelper(mode) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`backup.html?mode=${encodeURIComponent(mode)}`) });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("backup.")) return;
  const done = (v) => sendResponse(v);
  const fail = (e) => sendResponse({ ok: false, reason: (e && e.message) || String(e) });

  switch (msg.type) {
    case "backup.status": backupStatus().then(done, fail); return true;
    case "backup.read": backupRead().then(done, fail); return true;
    case "backup.write": backupWrite(msg.text).then(done, fail); return true;
    case "backup.unlink": idbDelete(HANDLE_KEY).then(() => done({ ok: true }), fail); return true;
    case "backup.open": openHelper(msg.mode); done({ ok: true }); return false;
    // "backup.linked" is broadcast by the helper page for the panel's benefit;
    // nothing to do here, but don't leave the sender hanging.
    default: return false;
  }
});
