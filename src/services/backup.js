// services/backup.js — Collections + History survive uninstall by living in a
// file, not just in chrome.storage.
//
// Chrome erases an extension's storage — local *and* sync — when the extension
// is removed. (Sync only reappears for Web Store installs on a signed-in
// profile; a sideloaded build like this one gets nothing back.) So the only way
// to keep saved requests across a remove/re-add is to mirror them to a real file
// on disk that the user picks once.
//
//   Link   -> backup.html picks the file and stores its handle in IndexedDB.
//   Save   -> every Collections/History change is written back to that file
//             (debounced), via the service worker — see background.js for why.
//   Pull   -> on panel load the file is read and merged back in, automatically.
//
// The file holds saved requests and history only. Keys and IVs are deliberately
// never written to it (PRD §24) — they stay in chrome.storage.

import {
  getCollections, setCollections, loadHistory, setHistoryBulk,
  getEnvironments, setEnvironmentsMap, loadSavedResponses, updateSavedResponses,
  loadSettings, saveSettings,
} from "./storage.js";

const FORMAT = "ciphernet-backup";
const FORMAT_VERSION = 3; // v3 adds hideUrlPatterns (v1/v2 files still load)
const HIST_MAX_ITEMS = 100;
const SAVED_RESP_MAX = 50;
const WRITE_DEBOUNCE_MS = 600;

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        // lastError just means the worker went away mid-call; treat as "no".
        resolve(chrome.runtime.lastError ? { ok: false, reason: "unavailable" } : res || { ok: false });
      });
    } catch {
      resolve({ ok: false, reason: "unavailable" });
    }
  });
}

// { linked, name, ready } — `ready: false` on a linked file means Chrome dropped
// the file-permission grant (it does that across browser restarts) and the user
// has to re-authorise it once before auto-save resumes.
export function status() {
  return send({ type: "backup.status" });
}
// Open the helper page: "link" (pick a file), "restore" (pick a file to read
// back), or "grant" (re-authorise the linked file).
export function openHelper(mode) {
  return send({ type: "backup.open", mode });
}
export function unlink() {
  return send({ type: "backup.unlink" });
}

/* ------------------------------ file format ------------------------------ */

export function serialize(collections, history, environments, savedResponses, hideUrlPatterns) {
  return JSON.stringify({
    format: FORMAT,
    version: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    collections: collections || {},
    // Order doesn't matter — mergeHistory re-sorts by timestamp on the way back
    // in. `_key` is a chrome.storage shard name, meaningless in a file: drop it.
    history: (history || []).map(({ _key, ...rest }) => rest),
    // v2 additions. Only the environment variable *map* is stored (not which one
    // a device has active) — each device picks its own active environment.
    environments: environments || {},
    savedResponses: savedResponses || [],
    // v3 addition (§33): the Hide URL pattern list, so it survives a
    // remove/re-add like the rest. No keys/IVs — just the filter lines.
    hideUrlPatterns: (hideUrlPatterns || []).filter((p) => typeof p === "string").map((p) => p.trim()).filter(Boolean),
  }, null, 2);
}

// Throws on anything that isn't a backup file, so callers can flag a bad pick.
// v1/v2 files (no environments/savedResponses/hideUrlPatterns) load fine — the
// fields default empty.
export function parse(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("not a JSON file"); }
  if (!data || data.format !== FORMAT) throw new Error("not a CipherNet backup file");
  const collections = data.collections && typeof data.collections === "object" ? data.collections : {};
  const history = Array.isArray(data.history) ? data.history : [];
  const environments = data.environments && typeof data.environments === "object" ? data.environments : {};
  const savedResponses = Array.isArray(data.savedResponses) ? data.savedResponses : [];
  const hideUrlPatterns = Array.isArray(data.hideUrlPatterns)
    ? data.hideUrlPatterns.filter((p) => typeof p === "string").map((p) => p.trim()).filter(Boolean)
    : [];
  return { collections, history, environments, savedResponses, hideUrlPatterns };
}

/* -------------------------------- merging -------------------------------- */
// Both merges are non-destructive unions: a restore never silently drops what's
// already here. `preferIncoming` decides who wins a name collision — the file
// does on an explicit "Restore" (that's what the user asked for), and the
// in-memory copy does on the automatic pull at load (it's the live one).

export function mergeCollections(local, incoming, preferIncoming) {
  const out = {};
  for (const folder of new Set([...Object.keys(local || {}), ...Object.keys(incoming || {})])) {
    const a = (local && local[folder]) || {};
    const b = (incoming && incoming[folder]) || {};
    out[folder] = preferIncoming ? { ...a, ...b } : { ...b, ...a };
  }
  return out;
}

// Union by (timestamp, method, URL), newest-first, capped like the live log.
export function mergeHistory(local, incoming) {
  const byId = new Map();
  const id = (h) => `${h.at}|${h.method}|${h.url}`;
  for (const h of [...(local || []), ...(incoming || [])]) {
    if (!h || !h.at) continue;
    if (!byId.has(id(h))) byId.set(id(h), h);
  }
  return [...byId.values()]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, HIST_MAX_ITEMS);
}

// Union of environments by name; a name collision merges the two variable maps,
// with `preferIncoming` deciding who wins a per-variable collision.
export function mergeEnvironments(local, incoming, preferIncoming) {
  const out = {};
  for (const name of new Set([...Object.keys(local || {}), ...Object.keys(incoming || {})])) {
    const a = (local && local[name]) || {};
    const b = (incoming && incoming[name]) || {};
    out[name] = preferIncoming ? { ...a, ...b } : { ...b, ...a };
  }
  return out;
}

// Union of saved responses by their unique id, newest-first, capped.
export function mergeSavedResponses(local, incoming, preferIncoming) {
  const ordered = preferIncoming
    ? [...(incoming || []), ...(local || [])]
    : [...(local || []), ...(incoming || [])];
  const byId = new Map();
  for (const s of ordered) { if (s && s.id && !byId.has(s.id)) byId.set(s.id, s); }
  return [...byId.values()]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, SAVED_RESP_MAX);
}

// Union of Hide URL patterns (§33). Both sides are kept (restores are
// non-destructive); duplicates are dropped case-insensitively, since matching
// itself is case-insensitive. Local order first, incoming appended.
export function mergeHideUrlPatterns(local, incoming) {
  const seen = new Set();
  const out = [];
  for (const p of [...(local || []), ...(incoming || [])]) {
    const s = typeof p === "string" ? p.trim() : "";
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/* ------------------------------- auto-save ------------------------------- */
// Every Collections/History/environments/saved-responses/hide-URL-patterns
// change schedules a write. Coalesced, because a rename or a burst of sends
// would otherwise rewrite the file several times in a row. The latest value of
// each field is kept in a snapshot, so callers that only touch one field (e.g.
// the §33 pattern list) pass just that one — `undefined` means "unchanged".
// Silently no-ops when no file is linked — backup is opt-in.

let timer = null;
const snapshot = { collections: null, history: null, environments: null, savedResponses: null, hideUrlPatterns: null };

export function scheduleWrite(collections, history, environments, savedResponses, hideUrlPatterns) {
  if (collections !== undefined) snapshot.collections = collections;
  if (history !== undefined) snapshot.history = history;
  if (environments !== undefined) snapshot.environments = environments;
  if (savedResponses !== undefined) snapshot.savedResponses = savedResponses;
  if (hideUrlPatterns !== undefined) snapshot.hideUrlPatterns = hideUrlPatterns;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    writeNow(snapshot.collections, snapshot.history, snapshot.environments, snapshot.savedResponses, snapshot.hideUrlPatterns);
  }, WRITE_DEBOUNCE_MS);
}

// §33 convenience: the filter engine only knows about the pattern list.
export function scheduleHideUrlPatterns(hideUrlPatterns) {
  scheduleWrite(undefined, undefined, undefined, undefined, hideUrlPatterns);
}

// Resolves { ok, reason } — "not-linked" is the normal, uninteresting case.
export function writeNow(collections, history, environments, savedResponses, hideUrlPatterns) {
  return send({ type: "backup.write", text: serialize(collections, history, environments, savedResponses, hideUrlPatterns) });
}

/* ------------------------- automatic pull on load ------------------------- */
// Read the linked file (if any, and if still authorised) and fold it into
// chrome.storage. This is what makes a re-added extension come back with its
// Collections and History already in place: the user re-links the file once and
// every load after that pulls it in with no interaction at all.
//
// Resolves { pulled: false } when there's nothing to do, or
// { pulled: true, collections, history } with the merged result to render.
export async function pullOnLoad(localCollections, localHistory, localEnvironments, localSavedResponses, localHideUrlPatterns) {
  const st = await status();
  if (!st || !st.linked || !st.ready) return { pulled: false, status: st };

  const res = await send({ type: "backup.read" });
  if (!res || !res.ok) return { pulled: false, status: st };

  let incoming;
  try { incoming = parse(res.text); } catch { return { pulled: false, status: st }; }

  // The live copy wins collisions here — an edit made in this browser is newer
  // than the file until the next write lands.
  const collections = mergeCollections(localCollections, incoming.collections, false);
  const history = mergeHistory(localHistory, incoming.history);
  const environments = mergeEnvironments(localEnvironments, incoming.environments, false);
  const savedResponses = mergeSavedResponses(localSavedResponses, incoming.savedResponses, false);
  const hideUrlPatterns = mergeHideUrlPatterns(localHideUrlPatterns, incoming.hideUrlPatterns);

  const collChanged = JSON.stringify(collections) !== JSON.stringify(localCollections || {});
  const histChanged = history.length !== (localHistory || []).length;
  const envChanged = JSON.stringify(environments) !== JSON.stringify(localEnvironments || {});
  const savedChanged = JSON.stringify(savedResponses) !== JSON.stringify(localSavedResponses || []);
  const patternsChanged = JSON.stringify(hideUrlPatterns) !== JSON.stringify(localHideUrlPatterns || []);
  if (!collChanged && !histChanged && !envChanged && !savedChanged && !patternsChanged) {
    return { pulled: true, changed: false, collections, history: localHistory, environments, savedResponses, hideUrlPatterns, status: st };
  }

  if (collChanged) await new Promise((resolve) => setCollections(collections, resolve));
  // Re-shards history, so entries come back with the storage keys they now
  // actually have — the caller deletes single entries by that key.
  let storedHistory = localHistory;
  if (histChanged) storedHistory = (await setHistoryBulk(history.slice().reverse())).reverse(); // storage wants oldest-first
  if (envChanged) await setEnvironmentsMap(environments);
  if (savedChanged) await updateSavedResponses(savedResponses);
  if (patternsChanged) saveSettings({ hideUrlPatterns });
  return { pulled: true, changed: true, collections, history: storedHistory, environments, savedResponses, hideUrlPatterns, status: st };
}

/* --------------------------- restore from a file -------------------------- */
// Explicit restore: the file wins name collisions, and the result is written
// back to chrome.storage. Returns a summary for the UI.
export async function restoreFromText(text) {
  const incoming = parse(text); // throws on a bad file — caller reports it
  const { collections: localCollections } = await getCollections();
  const localHistory = await loadHistory();
  const { environments: localEnvironments } = await getEnvironments();
  const localSavedResponses = await loadSavedResponses();
  const localSettings = await loadSettings();
  const localHideUrlPatterns = Array.isArray(localSettings.hideUrlPatterns) ? localSettings.hideUrlPatterns : [];

  const collections = mergeCollections(localCollections || {}, incoming.collections, true);
  const history = mergeHistory((localHistory || []).slice().reverse(), incoming.history);
  const environments = mergeEnvironments(localEnvironments || {}, incoming.environments, true);
  const savedResponses = mergeSavedResponses(localSavedResponses || [], incoming.savedResponses, true);
  const hideUrlPatterns = mergeHideUrlPatterns(localHideUrlPatterns, incoming.hideUrlPatterns);

  await new Promise((resolve, reject) =>
    setCollections(collections, (err) => (err ? reject(new Error(err)) : resolve()))
  );
  const storedHistory = await setHistoryBulk(history.slice().reverse());
  await setEnvironmentsMap(environments);
  await updateSavedResponses(savedResponses);
  if (JSON.stringify(hideUrlPatterns) !== JSON.stringify(localHideUrlPatterns)) {
    saveSettings({ hideUrlPatterns });
  }

  const folders = Object.keys(collections).length;
  const requests = Object.values(collections).reduce((n, f) => n + Object.keys(f).length, 0);
  return {
    collections,
    history: storedHistory.slice().reverse(), // newest-first for the panel
    environments,
    savedResponses,
    hideUrlPatterns,
    folders,
    requests,
  };
}
