// services/capture.js — captures network requests into the state store,
// fetches response bodies lazily, and decrypts every encrypted part in one place.
// In-flight requests appear immediately as "(pending)" rows (fed by webRequest
// events relayed from background.js) and are upgraded in place once the
// finished HAR entry arrives.

import { state } from "../core/state.js";
import { CipherNetCrypto } from "../core/crypto.js";
import { rawQuery, looksEncrypted, safeDecode, safeAtob } from "../core/format.js";
import { addRow, refreshRow, updateCount, applySortDebounced } from "../ui/table.js";
import { renderDetail } from "../ui/detail.js";
import { searchDebounced } from "./search.js";

function ingestHar(har) {
  const url = har.request.url;
  const method = har.request.method;
  // A finished HAR that matches a "(pending)" row completes that row even while
  // capture is paused — it's not a new request, just the end of one we show.
  const upgraded = takePendingMatch(method, url);
  if (!upgraded && state.paused) return;

  const postData = har.request.postData ? har.request.postData.text || "" : "";
  const query = rawQuery(url);

  const entry = upgraded || {
    id: state.nextId++,
    decrypted: false,   // set true once any part decrypts cleanly
    maybeEncrypted: false,
    tags: [],
    reqHash: null,
    respHash: null,
  };
  Object.assign(entry, {
    har,
    url,
    method,
    pending: false,
    failed: false,
    status: har.response.status,
    statusText: har.response.statusText || "",
    mime: (har.response.content && har.response.content.mimeType) || "",
    size: pickSize(har),
    time: har.time,
    serverIP: har.serverIPAddress || "",
    reqHeaders: har.request.headers || [],
    respHeaders: har.response.headers || [],
    postData,
    query,
    responseRaw: null,
    maybeEncrypted: entry.maybeEncrypted || looksEncrypted(postData) || looksEncrypted(query),
  });
  // Anything cached during the pending phase is stale now.
  entry._contentPromise = null;
  entry.responseB64 = null;
  entry._searchReady = false;
  entry._searchText = null;

  if (upgraded) {
    refreshRow(entry); // status/type/size/time now have real values
    if (state.selectedId === entry.id) renderDetail();
  } else {
    state.entries.push(entry);
    state.byId.set(entry.id, entry);
    addRow(entry);
    updateCount();
  }
  if (state.sort.col && state.sort.dir) applySortDebounced(); // keep sort order live
  if (state.search.active && state.search.regex) searchDebounced(); // index the new request
}

/* ------------- live "(pending)" rows (PRD §2/§3, is:running) ------------- */
// background.js relays webRequest start/done/error events for the inspected
// tab. Each start becomes a pending row; the HAR entry later replaces it.

const pendingByReqId = new Map(); // webRequest requestId -> entry
const pendingByKey = new Map();   // "METHOD url" -> [entries] oldest-first

function pendingKey(method, url) {
  return method + " " + url;
}

function addPending(msg) {
  if (state.paused) return;
  const query = rawQuery(msg.url);
  const entry = {
    id: state.nextId++,
    har: null,
    pending: true,
    failed: false,
    webRequestId: msg.requestId,
    resourceType: msg.resourceType || "",
    initiator: msg.initiator || "",
    url: msg.url,
    method: msg.method,
    status: 0,
    statusText: "",
    mime: "",
    size: -1,
    time: -1,
    serverIP: "",
    reqHeaders: [],
    respHeaders: [],
    postData: "",
    query,
    responseRaw: null,
    maybeEncrypted: looksEncrypted(query),
    decrypted: false,
    tags: [],
    reqHash: null,
    respHash: null,
  };
  state.entries.push(entry);
  state.byId.set(entry.id, entry);
  // A redirect hop re-fires "start" with the same requestId; point it at the
  // newest hop (the previous hop stays matchable by its own URL key).
  pendingByReqId.set(msg.requestId, entry);
  const key = pendingKey(entry.method, entry.url);
  if (!pendingByKey.has(key)) pendingByKey.set(key, []);
  pendingByKey.get(key).push(entry);
  addRow(entry);
  updateCount();
  if (state.sort.col && state.sort.dir) applySortDebounced();
  if (state.search.active && state.search.regex) searchDebounced(); // index the new row
}

// Claim the oldest pending row matching a finished HAR entry, or null.
function takePendingMatch(method, url) {
  const key = pendingKey(method, url);
  const list = pendingByKey.get(key);
  if (!list || !list.length) return null;
  const entry = list.shift();
  if (!list.length) pendingByKey.delete(key);
  if (pendingByReqId.get(entry.webRequestId) === entry) pendingByReqId.delete(entry.webRequestId);
  return entry;
}

// The webRequest status arrives before (or instead of) the HAR — show it, but
// keep the row matchable so the HAR can still fill in size/time/headers.
function markDone(msg) {
  const entry = pendingByReqId.get(msg.requestId);
  if (!entry || !entry.pending) return;
  if (msg.statusCode) entry.status = msg.statusCode;
  refreshRow(entry);
}

function markFailed(msg) {
  const entry = pendingByReqId.get(msg.requestId);
  if (!entry || !entry.pending) return;
  entry.failed = true;
  entry.status = 0;
  entry.statusText = msg.error || "";
  refreshRow(entry);
  if (state.selectedId === entry.id) renderDetail();
}

export function clearPendingIndex() {
  pendingByReqId.clear();
  pendingByKey.clear();
}

// Connect to background.js and watch the inspected tab. Chrome may shut the
// MV3 service worker down at any time, which drops the port — reconnect so
// the watch registration survives worker restarts.
function connectLiveEvents() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (typeof tabId !== "number" || tabId < 0) return;
  let port;
  try {
    port = chrome.runtime.connect({ name: "ciphernet-live" });
  } catch {
    return; // extension context gone (e.g. reloaded) — HAR capture still works
  }
  port.postMessage({ type: "watch", tabId });
  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.kind === "start") addPending(msg);
    else if (msg.kind === "done") markDone(msg);
    else if (msg.kind === "error") markFailed(msg);
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // swallow "receiving end does not exist"
    setTimeout(connectLiveEvents, 1000);
  });
}
connectLiveEvents();

chrome.devtools.network.onRequestFinished.addListener(ingestHar);

// Chrome doesn't load this panel's page until the user actually switches to
// the CipherNet tab, so devtools.js buffers any requests fired before that
// (from the moment Inspect/DevTools opens) and hands them to us here once
// this page is up, so nothing that happened before the first click is lost.
window.__ciphernetFlushBuffered = function (hars) {
  hars.forEach(ingestHar);
};

function pickSize(har) {
  const c = har.response.content;
  if (c && c.size > 0) return c.size;
  if (har.response.bodySize > 0) return har.response.bodySize;
  return c && c.size === 0 ? 0 : -1;
}

export function fetchContent(entry) {
  if (!entry.har) return Promise.resolve(""); // still pending — no body yet
  if (entry._contentPromise) return entry._contentPromise;
  entry._contentPromise = new Promise((resolve) => {
    entry.har.getContent((content, encoding) => {
      entry.responseB64 = encoding === "base64" ? content : null;
      entry.responseRaw = encoding === "base64" ? safeAtob(content) : content || "";
      if (looksEncrypted(entry.responseRaw)) entry.maybeEncrypted = true;
      resolve(entry.responseRaw);
    });
  });
  return entry._contentPromise;
}

// Fetch the response and attempt to decrypt every encrypted part.
// Shared by search indexing and the "Decrypted session" export so the
// decryption logic lives in exactly one place.
export async function gatherDecrypted(entry) {
  const raw = await fetchContent(entry);
  const out = {
    query: entry.query || "",
    payload: entry.postData || "",
    response: raw || "",
    queryDecrypted: null,
    payloadDecrypted: null,
    responseDecrypted: null,
  };
  if (entry.query) {
    const r = await CipherNetCrypto.tryDecrypt(
      [entry.query, safeDecode(entry.query), entry.query.replace(/ /g, "+")],
      state.key,
      state.iv
    );
    if (r.ok) { out.queryDecrypted = r.text; entry.maybeEncrypted = entry.decrypted = true; }
  }
  if (entry.postData) {
    const r = await CipherNetCrypto.tryDecrypt(entry.postData, state.key, state.iv);
    if (r.ok) { out.payloadDecrypted = r.text; entry.maybeEncrypted = entry.decrypted = true; }
  }
  if (raw) {
    const r = await CipherNetCrypto.tryDecrypt(raw, state.key, state.iv);
    if (r.ok) { out.responseDecrypted = r.text; entry.maybeEncrypted = entry.decrypted = true; }
  }
  return out;
}
