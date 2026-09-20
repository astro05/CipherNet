// services/storage.js — the single persistence boundary over chrome.storage.
//
// Device/session UI state (key, layout, columns, filters, …) lives in
// chrome.storage.local — it's wiped on uninstall, which is fine, it's not
// meant to survive that.
//
// Collections and Request History are meant to survive uninstall/reinstall,
// so they live in chrome.storage.sync instead — sync data is tied to the
// signed-in Chrome profile, not the local install, and reappears
// automatically next time the extension is loaded. The tradeoff is a hard
// quota: 100 KB total, 8 KB per stored key. History is sharded across one
// key per entry (plus a small index key) so no single write can approach the
// per-key cap, and entries are capped at 100 with oldest-first eviction to
// stay under the total budget.

import { logError } from "../core/errorLog.js";

const KEYS = [
  "key", "iv", "columns", "layout", "sort",
  "preserveLog", "disableCache", "throttle", "typeFilters", "moreFilters", "hideUrlPatterns",
];

// Read all persisted (local, device-scoped) settings at once.
export function loadSettings() {
  return new Promise((resolve) => chrome.storage.local.get(KEYS, resolve));
}

// Persist a partial settings object. Optional callback mirrors chrome.storage.
export function saveSettings(partial, cb) {
  chrome.storage.local.set(partial, () => {
    if (chrome.runtime.lastError) logError("storage.saveSettings", chrome.runtime.lastError);
    cb && cb();
  });
}

/* ------------------------------ collections ------------------------------ */
// Saved Encrypt-URL requests as folder-based collections:
//   { folderName: { requestName: { url, body, token } } }
// Stored in chrome.storage.sync so they survive uninstall/reinstall.

// Also returns the pre-2.9 flat `savedRequests` (if any) so callers can migrate.
export function getCollections() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["savedCollections"], (syncRes) => {
      if (syncRes.savedCollections) { resolve({ collections: syncRes.savedCollections, legacy: null }); return; }
      // Nothing in sync yet — fall back to (and let the caller migrate from)
      // local storage, where versions before 2.14 kept this data.
      chrome.storage.local.get(["savedCollections", "savedRequests"], (localRes) => {
        resolve({ collections: localRes.savedCollections || null, legacy: localRes.savedRequests || null });
      });
    });
  });
}
// cb receives an error message on failure (e.g. sync quota exceeded), or
// null/undefined on success — callers should surface it to the user rather
// than silently drop the save, since Collections are a deliberate save.
export function setCollections(map, cb) {
  chrome.storage.sync.set({ savedCollections: map }, () => {
    const err = chrome.runtime.lastError;
    if (err) logError("storage.setCollections", err);
    cb && cb(err ? err.message : null);
  });
}

/* ----------------------------- environments ----------------------------- */
// Postman-style environments: named sets of variables referenced as {{name}} in
// the API Testing URL / headers / body / token. Small config, so — like
// Collections — they live in chrome.storage.sync to survive uninstall/reinstall.
//   environments: { envName: { varName: value } }
//   activeEnv:    the currently-selected environment name ("" = none)
export function getEnvironments() {
  return new Promise((resolve) =>
    chrome.storage.sync.get(["environments", "activeEnv"], (r) =>
      resolve({ environments: r.environments || {}, activeEnv: r.activeEnv || "" }))
  );
}
export function setEnvironments(environments, activeEnv, cb) {
  chrome.storage.sync.set({ environments, activeEnv }, () => {
    const err = chrome.runtime.lastError;
    if (err) logError("storage.setEnvironments", err);
    cb && cb(err ? err.message : null);
  });
}
// Write only the variable map (used by a backup pull/restore) without disturbing
// which environment this device has active.
export function setEnvironmentsMap(environments) {
  return new Promise((resolve) => chrome.storage.sync.set({ environments }, () => {
    if (chrome.runtime.lastError) logError("storage.setEnvironmentsMap", chrome.runtime.lastError);
    resolve();
  }));
}

/* -------------------------- saved responses ---------------------------- */
// Pinned/saved responses keep the FULL response body (plus the request that
// produced it), which is far too large for the sync quota — so they live in
// chrome.storage.local instead (bigger budget, but wiped on uninstall, which is
// an acceptable tradeoff for bulky, best-effort-persistent captures). Capped by
// count and total bytes with oldest-first eviction so the store can't grow
// without bound (no `unlimitedStorage` permission).
const SAVED_RESP_KEY = "savedResponses";
const SAVED_RESP_MAX_ITEMS = 50;
const SAVED_RESP_MAX_BYTES = 4_000_000; // ~4 MB, comfortably under local's ~10 MB

export function loadSavedResponses() {
  return new Promise((resolve) =>
    chrome.storage.local.get([SAVED_RESP_KEY], (r) => resolve(Array.isArray(r[SAVED_RESP_KEY]) ? r[SAVED_RESP_KEY] : []))
  );
}
// Prepend `entry` (newest-first), evicting the oldest until it fits the count and
// byte budgets. Resolves { ok, list, evicted } — ok:false only if the single
// entry alone blows the budget.
export async function addSavedResponse(entry) {
  const list = await loadSavedResponses();
  const next = [entry, ...list];
  let evicted = 0;
  while (next.length > SAVED_RESP_MAX_ITEMS) { next.pop(); evicted++; }
  while (next.length > 1 && JSON.stringify(next).length > SAVED_RESP_MAX_BYTES) { next.pop(); evicted++; }
  if (JSON.stringify(next).length > SAVED_RESP_MAX_BYTES) return { ok: false, list, evicted };
  const ok = await new Promise((resolve) => chrome.storage.local.set({ [SAVED_RESP_KEY]: next }, () => {
    const err = chrome.runtime.lastError;
    if (err) logError("storage.addSavedResponse", err);
    resolve(!err);
  }));
  return ok ? { ok: true, list: next, evicted } : { ok: false, list, evicted };
}
export async function updateSavedResponses(list) {
  await new Promise((resolve) => chrome.storage.local.set({ [SAVED_RESP_KEY]: list }, () => {
    if (chrome.runtime.lastError) logError("storage.updateSavedResponses", chrome.runtime.lastError);
    resolve();
  }));
  return list;
}

/* ------------------------------- history -------------------------------- */
// Request History: an automatic (unnamed) log of the last HIST_MAX_ITEMS
// Send Encrypted / Send Plain requests, so they can be reloaded later. Each
// entry holds the request (URL/body/token) and a response summary — not the
// full response body, which would blow the sync quota well before 100
// entries. Also stored in chrome.storage.sync to survive uninstall.
const HIST_INDEX_KEY = "historyIndex"; // { next: number, order: string[] } — order is oldest-first
const HIST_MAX_ITEMS = 100;
const HIST_FIELD_MAX = 4000;    // per-field char cap, defensive: keeps one entry well under the 8KB/item limit
const SYNC_SAFETY_BYTES = 92000; // stay under the 100KB total quota, leaving headroom for Collections

function histKey(n) {
  return "hist_" + n;
}
function truncate(s, max) {
  if (typeof s !== "string" || s.length <= max) return s || "";
  return s.slice(0, max) + "…(truncated)";
}
function getIndex() {
  return new Promise((resolve) =>
    chrome.storage.sync.get([HIST_INDEX_KEY], (res) => resolve(res[HIST_INDEX_KEY] || { next: 0, order: [] }))
  );
}
function removeKeys(keys) {
  return keys.length ? new Promise((resolve) => chrome.storage.sync.remove(keys, resolve)) : Promise.resolve();
}
function bytesInUse() {
  return new Promise((resolve) => chrome.storage.sync.getBytesInUse(null, resolve));
}
// One stored history entry: the request as sent plus a response *summary*.
function trimEntry(entry) {
  return {
    method: entry.method,
    mode: entry.mode,
    url: truncate(entry.url, HIST_FIELD_MAX),
    body: truncate(entry.body, HIST_FIELD_MAX),
    token: truncate(entry.token, HIST_FIELD_MAX),
    status: entry.status,
    statusText: truncate(entry.statusText, 200),
    timeMs: entry.timeMs,
    size: entry.size,
    at: entry.at,
  };
}

// Oldest-first array of history entries (each tagged with its storage `_key`
// so removeHistoryEntry can target it).
export async function loadHistory() {
  const idx = await getIndex();
  if (!idx.order.length) return [];
  const entries = await new Promise((resolve) => chrome.storage.sync.get(idx.order, resolve));
  return idx.order.map((k) => (entries[k] ? { ...entries[k], _key: k } : null)).filter(Boolean);
}

// Append one entry, evicting the oldest first past the 100-item cap or when
// approaching the total sync quota. Best-effort: resolves { ok: false } (and
// drops the entry) rather than throwing, since history is a convenience log,
// not canonical data — it should never block or error out the actual send.
// On success, resolves { ok: true, key } so the caller can mirror it
// in-memory (e.g. for delete) without a round-trip read.
export async function addHistoryEntry(entry) {
  const trimmed = trimEntry(entry);

  const idx = await getIndex();
  let order = idx.order.slice();

  while (order.length >= HIST_MAX_ITEMS) await removeKeys([order.shift()]);

  const estBytes = JSON.stringify(trimmed).length + 40; // +overhead for the key name/envelope
  let used = await bytesInUse();
  while (used + estBytes > SYNC_SAFETY_BYTES && order.length) {
    await removeKeys([order.shift()]);
    used = await bytesInUse();
  }

  const key = histKey(idx.next);
  order.push(key);
  const nextIdx = { next: idx.next + 1, order };
  const ok = await new Promise((resolve) =>
    chrome.storage.sync.set({ [key]: trimmed, [HIST_INDEX_KEY]: nextIdx }, () => {
      const err = chrome.runtime.lastError;
      if (err) logError("storage.addHistoryEntry", err);
      resolve(!err);
    })
  );
  return ok ? { ok: true, key } : { ok: false, key: null };
}

export async function removeHistoryEntry(key) {
  const idx = await getIndex();
  const order = idx.order.filter((k) => k !== key);
  await new Promise((resolve) => chrome.storage.sync.set({ [HIST_INDEX_KEY]: { ...idx, order } }, resolve));
  await removeKeys([key]);
}

export async function clearHistory() {
  const idx = await getIndex();
  await removeKeys([...idx.order, HIST_INDEX_KEY]);
}

// Replace the whole history with `entries` (oldest-first) — used by a backup
// restore, which brings back a batch at once rather than one send at a time.
// Newest entries win if the batch doesn't fit: it's written newest-first until
// the item cap or the sync quota is reached, then the rest is dropped. Resolves
// with what was actually stored (oldest-first, each tagged with its `_key`).
export async function setHistoryBulk(entries) {
  await clearHistory();

  const newestFirst = entries.slice().reverse().slice(0, HIST_MAX_ITEMS);
  let used = await bytesInUse(); // collections + settings, now that history is gone

  const kept = []; // newest-first
  const writes = {};
  for (const entry of newestFirst) {
    const trimmed = trimEntry(entry);
    const est = JSON.stringify(trimmed).length + 40; // + key name/envelope overhead
    if (used + est > SYNC_SAFETY_BYTES) break;
    used += est;
    const key = histKey(kept.length);
    writes[key] = trimmed;
    kept.push({ ...trimmed, _key: key });
  }

  const order = kept.map((e) => e._key).reverse(); // storage keeps oldest-first
  writes[HIST_INDEX_KEY] = { next: kept.length, order };
  const ok = await new Promise((resolve) =>
    chrome.storage.sync.set(writes, () => {
      const err = chrome.runtime.lastError;
      if (err) logError("storage.setHistoryBulk", err);
      resolve(!err);
    })
  );
  return ok ? kept.reverse() : [];
}
