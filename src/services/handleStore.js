// services/handleStore.js — where the linked backup file's handle lives.
//
// A FileSystemFileHandle is structured-cloneable but not JSON-serialisable, so
// chrome.storage can't hold one; IndexedDB can. IndexedDB is keyed by origin, so
// the handle the helper page (backup.html) picks is the same one the service
// worker reads back when it writes the file.
//
// Like every other extension store, this is erased when the extension is
// removed — which is the point: after a re-add the *file* still exists, the user
// re-links it once, and everything is pulled back in. See services/backup.js.

const DB_NAME = "ciphernet-backup";
const DB_STORE = "handles";
export const HANDLE_KEY = "file";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
