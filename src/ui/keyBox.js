// ui/keyBox.js — the 🔑 Key box: save/clear the AES key & IV (persisted) and
// invalidate derived caches when the key changes so views re-decrypt live.

import { state, DEFAULT_KEY, DEFAULT_IV } from "../core/state.js";
import { els } from "../core/els.js";
import { saveSettings } from "../services/storage.js";
import { runSearch } from "../services/search.js";
import { renderDetail } from "./detail.js";
import { decryptKeyFile } from "../core/keyFile.js";
import { logError } from "../core/errorLog.js";

function flashKey(msg) {
  els.keyStatus.textContent = msg;
  setTimeout(() => (els.keyStatus.textContent = ""), 1500);
}

// Blink the 🔑 Key button while no key is saved so it's obvious one is needed;
// stop blinking once a key is set. Called on init and after every save/clear.
export function refreshKeyIndicator() {
  els.keysToggle.classList.toggle("needs-key", !state.key);
}

// Decryption results depend on the key, so drop derived caches when it changes.
function onKeyChanged() {
  for (const e of state.entries) { e._searchReady = false; e.decrypted = false; }
  if (state.search.active) runSearch();
  if (state.selectedId != null) renderDetail();
}

els.saveKey.addEventListener("click", () => {
  state.key = els.keyInput.value || DEFAULT_KEY;
  state.iv = els.ivInput.value || DEFAULT_IV;
  saveSettings({ key: state.key, iv: state.iv }, () => flashKey("Saved ✓"));
  onKeyChanged();
  els.keysRow.classList.remove("open"); // save hides the Key panel automatically
  refreshKeyIndicator();                // stop blinking once a key is saved
});
els.resetKey.addEventListener("click", () => {
  state.key = DEFAULT_KEY;
  state.iv = DEFAULT_IV;
  els.keyInput.value = DEFAULT_KEY;
  els.ivInput.value = DEFAULT_IV;
  saveSettings({ key: state.key, iv: state.iv }, () => flashKey("Cleared ✓"));
  els.keysRow.classList.add("open");
  onKeyChanged();
  refreshKeyIndicator(); // no key now → resume blinking
});
els.keysToggle.addEventListener("click", () => els.keysRow.classList.toggle("open"));

// Load: pick a key file, decrypt it under the app's fixed passphrase (see
// core/keyFile.js), and use the result exactly like a manually-typed key
// (persist + invalidate caches). No passphrase prompt — the file alone is
// enough.
els.loadKeyFile.addEventListener("click", () => els.keyFileInput.click());
els.keyFileInput.addEventListener("change", async () => {
  const file = els.keyFileInput.files && els.keyFileInput.files[0];
  els.keyFileInput.value = ""; // let the same file be picked again later
  if (!file) return;
  try {
    const { key, iv } = await decryptKeyFile(await file.text());
    state.key = key;
    state.iv = iv;
    els.keyInput.value = key;
    els.ivInput.value = iv;
    saveSettings({ key: state.key, iv: state.iv }, () => flashKey("Loaded ✓"));
    onKeyChanged();
    els.keysRow.classList.remove("open");
    refreshKeyIndicator();
  } catch (e) {
    logError("keyBox.loadKeyFile", e);
    flashKey("Load failed — not a valid key file");
  }
});
