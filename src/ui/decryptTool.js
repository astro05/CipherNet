// ui/decryptTool.js — the 🔓 Decrypt drawer: paste an encrypted (Base64) value
// and get the decrypted, formatted result with a Copy button. The output reuses
// bodyView (same as the Response detail tab): pretty-printed JSON when the
// plaintext is JSON, a raw/decrypted toggle, and Copy.

import { state } from "../core/state.js";
import { els } from "../core/els.js";
import { el } from "../core/dom.js";
import { CipherNetCrypto } from "../core/crypto.js";
import { safeDecode, stripQuotes } from "../core/format.js";
import { bodyView } from "./detail.js";
import { showView, currentView } from "./views.js";

els.decryptToggle.addEventListener("click", () => {
  const open = currentView() !== "decrypt";
  showView(open ? "decrypt" : "network");
  if (open) els.decInput.focus();
});
els.decryptBtn.addEventListener("click", runDecrypt);
els.decInput.addEventListener("keydown", (e) => {
  // Ctrl/Cmd+Enter runs the decrypt (a bare Enter inserts a newline in the box).
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runDecrypt(); }
});
els.decryptClear.addEventListener("click", () => {
  els.decInput.value = "";
  els.decOutput.hidden = true;
  els.decOutput.innerHTML = "";
  flashDec("");
});

function flashDec(msg, isErr) {
  els.decStatus.textContent = msg;
  els.decStatus.classList.toggle("err", !!isErr);
}

async function runDecrypt() {
  const raw = els.decInput.value;
  els.decOutput.hidden = true;
  els.decOutput.innerHTML = "";

  if (!raw.trim()) { flashDec("Paste an encrypted value to decrypt.", true); return; }
  if (!state.key) { flashDec("Set the AES key in 🔑 Key first.", true); return; }

  flashDec("Decrypting…");
  // Try a few encodings so quoted / percent-encoded / whitespace-wrapped
  // ciphertext still decrypts; tryDecryptLoose also does a best-effort no-pad pass.
  const candidates = [raw, raw.trim(), stripQuotes(raw), safeDecode(raw)];
  const res = await CipherNetCrypto.tryDecryptLoose(candidates, state.key, state.iv);
  if (res.forced) {
    els.decOutput.appendChild(el("div", "muted-block", "Decrypted best-effort (padding ignored)."));
  }
  els.decOutput.appendChild(bodyView(res.ok ? res.text : null, raw, res));
  els.decOutput.hidden = false;
  flashDec(res.ok ? "Decrypted ✓" : (res.error || "Decryption failed."), !res.ok);
}
