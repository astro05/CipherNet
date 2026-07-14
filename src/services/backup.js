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

import { getCollections, setCollections, loadHistory, setHistoryBulk } from "./storage.js";

const FORMAT = "ciphernet-backup";
const FORMAT_VERSION = 1;
const HIST_MAX_ITEMS = 100;
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

export function serialize(collections, history) {
  return JSON.stringify({
    format: FORMAT,
    version: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    collections: collections || {},
    // Order doesn't matter — mergeHistory re-sorts by timestamp on the way back
    // in. `_key` is a chrome.storage shard name, meaningless in a file: drop it.
    history: (history || []).map(({ _key, ...rest }) => rest),
  }, null, 2);
}

// Throws on anything that isn't a backup file, so callers can flag a bad pick.
export function parse(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("not a JSON file"); }
  if (!data || data.format !== FORMAT) throw new Error("not a CipherNet backup file");
  const collections = data.collections && typeof data.collections === "object" ? data.collections : {};
  const history = Array.isArray(data.history) ? data.history : [];
  return { collections, history };
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

/* ------------------------------- auto-save ------------------------------- */
// Every Collections/History change schedules a write. Coalesced, because a
// rename or a burst of sends would otherwise rewrite the file several times in a
// row. Silently no-ops when no file is linked — backup is opt-in.

let timer = null;
let pending = null;

export function scheduleWrite(collections, history) {
  pending = { collections, history };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const p = pending;
    pending = null;
    if (p) writeNow(p.collections, p.history);
  }, WRITE_DEBOUNCE_MS);
}

// Resolves { ok, reason } — "not-linked" is the normal, uninteresting case.
export function writeNow(collections, history) {
  return send({ type: "backup.write", text: serialize(collections, history) });
}

/* ------------------------- automatic pull on load ------------------------- */
// Read the linked file (if any, and if still authorised) and fold it into
// chrome.storage. This is what makes a re-added extension come back with its
// Collections and History already in place: the user re-links the file once and
// every load after that pulls it in with no interaction at all.
//
// Resolves { pulled: false } when there's nothing to do, or
// { pulled: true, collections, history } with the merged result to render.
export async function pullOnLoad(localCollections, localHistory) {
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

  const added =
    JSON.stringify(collections) !== JSON.stringify(localCollections || {}) ||
    history.length !== (localHistory || []).length;
  if (!added) return { pulled: true, changed: false, collections, history: localHistory, status: st };

  await new Promise((resolve) => setCollections(collections, resolve));
  // Re-shards history, so entries come back with the storage keys they now
  // actually have — the caller deletes single entries by that key.
  const stored = await setHistoryBulk(history.slice().reverse()); // storage wants oldest-first
  return { pulled: true, changed: true, collections, history: stored.reverse(), status: st };
}

/* --------------------------- restore from a file -------------------------- */
// Explicit restore: the file wins name collisions, and the result is written
// back to chrome.storage. Returns a summary for the UI.
export async function restoreFromText(text) {
  const incoming = parse(text); // throws on a bad file — caller reports it
  const { collections: localCollections } = await getCollections();
  const localHistory = await loadHistory();

  const collections = mergeCollections(localCollections || {}, incoming.collections, true);
  const history = mergeHistory((localHistory || []).slice().reverse(), incoming.history);

  await new Promise((resolve, reject) =>
    setCollections(collections, (err) => (err ? reject(new Error(err)) : resolve()))
  );
  const storedHistory = await setHistoryBulk(history.slice().reverse());

  const folders = Object.keys(collections).length;
  const requests = Object.values(collections).reduce((n, f) => n + Object.keys(f).length, 0);
  return {
    collections,
    history: storedHistory.slice().reverse(), // newest-first for the panel
    folders,
    requests,
  };
}
