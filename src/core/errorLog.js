// core/errorLog.js — local error log (PRD §24: no external telemetry).
//
// Errors are recorded here instead of the console — console output vanishes
// the moment DevTools closes and isn't something a user can hand back to you.
// Entries persist in chrome.storage.local (device-scoped, fine to lose on
// uninstall) as a capped ring buffer, and can be pulled as a real .txt file
// from the toolbar's Export ▾ menu.
//
// Shared by both the panel and the background service worker — chrome.storage
// is available in both contexts. No imports of its own, so every layer
// (core/services/ui) can log through it.

const KEY = "errorLog";
const MAX_ENTRIES = 200;

// Fire-and-forget: errors are rare, so a read-modify-write race that drops one
// of two near-simultaneous entries is an acceptable ceiling for a best-effort
// debug log.
// ponytail: no read-modify-write lock; upgrade to a write queue if concurrent
// errors start colliding often enough to matter.
export function logError(tag, err) {
  const message = (err && err.message) || String(err);
  const entry = { at: new Date().toISOString(), tag, message };
  chrome.storage.local.get([KEY], (r) => {
    const entries = Array.isArray(r[KEY]) ? r[KEY] : [];
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    chrome.storage.local.set({ [KEY]: entries });
  });
}

export function getLogText() {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEY], (r) => {
      const entries = Array.isArray(r[KEY]) ? r[KEY] : [];
      resolve(entries.length
        ? entries.map((e) => `[${e.at}] ${e.tag}: ${e.message}`).join("\n")
        : "No errors logged.");
    });
  });
}
