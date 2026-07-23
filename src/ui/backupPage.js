// ui/backupPage.js — the backup.html helper page.
//
// It exists for one reason: Chrome blocks file pickers in cross-origin iframes,
// and a DevTools panel *is* a cross-origin iframe. So the panel can never call
// showSaveFilePicker / showOpenFilePicker itself. This is a plain top-level
// extension page, where the picker (and the permission prompt that comes with
// it) works normally. It picks the file, stashes the handle where the service
// worker can find it, and tells the panel to refresh. See services/backup.js.

import { idbGet, idbSet, HANDLE_KEY } from "../services/handleStore.js";
import { serialize, restoreFromText } from "../services/backup.js";
import { getCollections, loadHistory } from "../services/storage.js";
import { logError } from "../core/errorLog.js";

const els = {
  linked: document.getElementById("linked"),
  status: document.getElementById("status"),
  openBtn: document.getElementById("openBtn"),
  createBtn: document.getElementById("createBtn"),
  grantBtn: document.getElementById("grantBtn"),
  cardOpen: document.getElementById("cardOpen"),
  cardCreate: document.getElementById("cardCreate"),
  cardGrant: document.getElementById("cardGrant"),
};

// Match the browser theme; the panel gets this from the DevTools theme instead.
if (!window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.setAttribute("data-theme", "light");
}

const FILE_TYPES = [{
  description: "CipherNet backup",
  accept: { "application/json": [".json"] },
}];

function say(msg, kind) {
  els.status.textContent = msg;
  els.status.className = kind || "muted";
}

// The panel re-reads chrome.storage (and re-links) when it sees this.
function notifyPanel() {
  try { chrome.runtime.sendMessage({ type: "backup.linked" }, () => void chrome.runtime.lastError); } catch { /* no listener */ }
}

async function writeFile(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

// Everything currently in chrome.storage, as backup-file text.
async function currentText() {
  const { collections } = await getCollections();
  const history = await loadHistory(); // oldest-first, as the file stores it
  return serialize(collections || {}, history);
}

async function showLinked() {
  const handle = await idbGet(HANDLE_KEY).catch((err) => {
    logError("backupPage.idbGet", err);
    return null;
  });
  const mode = new URLSearchParams(location.search).get("mode");

  if (!handle) {
    els.linked.textContent = "No backup file linked yet.";
    els.cardGrant.hidden = true;
    return;
  }
  const perm = await handle.queryPermission({ mode: "readwrite" }).catch((err) => {
    logError("backupPage.queryPermission", err);
    return "prompt";
  });
  els.linked.textContent = perm === "granted"
    ? `Linked to “${handle.name}” — auto-save is on.`
    : `Linked to “${handle.name}” — access needs re-authorising.`;
  els.cardGrant.hidden = perm === "granted" && mode !== "grant";
}

/* ---- Open an existing backup: restore from it, then keep it linked ---- */
els.openBtn.addEventListener("click", async () => {
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
  } catch (e) {
    if (e.name !== "AbortError") {
      logError("backupPage.filePicker", e);
      say(e.message || "Could not open the file picker.", "err");
    }
    return;
  }
  try {
    // Read+write, not just read: this file becomes the live backup target.
    if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
      say("Access to the file was denied.", "err");
      return;
    }
    const text = await (await handle.getFile()).text();
    const summary = await restoreFromText(text); // merges into chrome.storage
    await idbSet(HANDLE_KEY, handle);
    // Write the merged result straight back, so file and storage agree.
    await writeFile(handle, await currentText());
    notifyPanel();
    await showLinked();
    say(
      `Restored ${summary.requests} request(s) in ${summary.folders} folder(s) and ` +
      `${summary.history.length} history entr${summary.history.length === 1 ? "y" : "ies"}. ` +
      `You can close this tab.`,
      "ok"
    );
  } catch (e) {
    logError("backupPage.restoreFromOpen", e);
    say(e.message || "Restore failed.", "err");
  }
});

/* ---- Create a new backup file and write the current data to it ---- */
els.createBtn.addEventListener("click", async () => {
  let handle;
  try {
    handle = await window.showSaveFilePicker({ suggestedName: "ciphernet-backup.json", types: FILE_TYPES });
  } catch (e) {
    if (e.name !== "AbortError") {
      logError("backupPage.filePicker", e);
      say(e.message || "Could not open the file picker.", "err");
    }
    return;
  }
  try {
    // The Save picker happily returns an existing file, and the first write
    // would truncate it — so if the user pointed at a backup they already had,
    // fold it in before overwriting rather than destroying it.
    let restored = null;
    try {
      const existing = await (await handle.getFile()).text();
      if (existing.trim()) restored = await restoreFromText(existing);
    } catch { /* new/empty/not-a-backup file — nothing to fold in */ }

    await idbSet(HANDLE_KEY, handle);
    await writeFile(handle, await currentText());
    notifyPanel();
    await showLinked();
    say(
      restored
        ? `Linked to “${handle.name}” — it already held a backup, so ${restored.requests} request(s) were restored first. Auto-save is on. You can close this tab.`
        : `Linked to “${handle.name}” — auto-save is on. You can close this tab.`,
      "ok"
    );
  } catch (e) {
    logError("backupPage.createBackupFile", e);
    say(e.message || "Could not write the backup file.", "err");
  }
});

/* ---- Re-authorise a file Chrome has since revoked access to ---- */
els.grantBtn.addEventListener("click", async () => {
  const handle = await idbGet(HANDLE_KEY).catch((err) => {
    logError("backupPage.idbGet", err);
    return null;
  });
  if (!handle) { say("No backup file is linked.", "err"); return; }
  try {
    if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
      say("Access to the file was denied.", "err");
      return;
    }
    notifyPanel();
    await showLinked();
    say("Auto-save is on again. You can close this tab.", "ok");
  } catch (e) {
    logError("backupPage.reauthorise", e);
    say(e.message || "Could not re-authorise the file.", "err");
  }
});

showLinked();
