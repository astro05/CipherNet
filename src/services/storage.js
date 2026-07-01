// services/storage.js — the single persistence boundary over chrome.storage.local.

const KEYS = [
  "key", "iv", "columns", "layout", "sort",
  "preserveLog", "disableCache", "throttle", "typeFilters", "moreFilters",
];

// Read all persisted settings at once.
export function loadSettings() {
  return new Promise((resolve) => chrome.storage.local.get(KEYS, resolve));
}

// Persist a partial settings object. Optional callback mirrors chrome.storage.
export function saveSettings(partial, cb) {
  chrome.storage.local.set(partial, cb);
}

// Saved Encrypt-URL requests as folder-based collections:
//   { folderName: { requestName: { url, body, token } } }
// Also returns the pre-2.9 flat `savedRequests` (if any) so callers can migrate.
export function getCollections() {
  return new Promise((resolve) =>
    chrome.storage.local.get(["savedCollections", "savedRequests"], (r) =>
      resolve({ collections: r.savedCollections || null, legacy: r.savedRequests || null })
    )
  );
}
export function setCollections(map, cb) {
  chrome.storage.local.set({ savedCollections: map }, cb);
}
