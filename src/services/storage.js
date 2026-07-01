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
