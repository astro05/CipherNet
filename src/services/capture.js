// services/capture.js — captures finished network requests into the state store,
// fetches response bodies lazily, and decrypts every encrypted part in one place.

import { state } from "../core/state.js";
import { CipherNetCrypto } from "../core/crypto.js";
import { rawQuery, looksEncrypted, safeDecode, safeAtob } from "../core/format.js";
import { addRow, updateCount, applySortDebounced } from "../ui/table.js";
import { searchDebounced } from "./search.js";

function ingestHar(har) {
  if (state.paused) return;

  const url = har.request.url;
  const postData = har.request.postData ? har.request.postData.text || "" : "";
  const query = rawQuery(url);

  const entry = {
    id: state.nextId++,
    har,
    url,
    method: har.request.method,
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
    maybeEncrypted: looksEncrypted(postData) || looksEncrypted(query),
    decrypted: false,   // set true once any part decrypts cleanly
    tags: [],
    reqHash: null,
    respHash: null,
  };

  state.entries.push(entry);
  state.byId.set(entry.id, entry);
  addRow(entry);
  updateCount();
  if (state.sort.col && state.sort.dir) applySortDebounced(); // keep sort order live
  if (state.search.active && state.search.regex) searchDebounced(); // index the new request
}

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
