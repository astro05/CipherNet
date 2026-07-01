// ui/decryptTool.js — the 🔓 Decrypt drawer: paste an encrypted (Base64) value
// (or a full URL whose query string is encrypted) and get the decrypted,
// formatted result with a Copy button. The output reuses bodyView (same as the
// Response detail tab): pretty-printed JSON when the plaintext is JSON, a
// raw/decrypted toggle, and Copy. Decryption auto-falls back to the lenient
// (ragged-tolerant) path when the strict decrypt fails.

import { state } from "../core/state.js";
import { els } from "../core/els.js";
import { el, copyBtn } from "../core/dom.js";
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

// A note describing how a value was decrypted (lenient / best-effort), or null.
function decryptNote(res) {
  if (res.lenient) return `Lenient decrypt: dropped ${res.dropped} ragged tail byte(s) and skipped PKCS7 validation — the end may be garbled.`;
  if (res.forced) return "Decrypted best-effort (padding ignored).";
  return null;
}

// One output row: label + value + Copy (reuses the Encrypt tool's row styles).
function decOutRow(label, value) {
  const row = el("div", "enc-out-row");
  row.appendChild(el("div", "enc-out-label", label));
  row.appendChild(el("div", "enc-out-value", value));
  row.appendChild(copyBtn(() => value));
  return row;
}

// Recognise a URL that carries an (encrypted) query string: "base?<cipher>".
// A bare Base64 ciphertext never contains "?", so a "?" means the input is a URL.
function urlWithQuery(input) {
  const i = input.indexOf("?");
  if (i === -1) return null;
  const base = input.slice(0, i);
  const query = input.slice(i + 1);
  if (!query) return null;
  const looksUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(base) || base.includes("/");
  return looksUrl ? { base, query } : null;
}

async function runDecrypt() {
  const raw = els.decInput.value;
  els.decOutput.hidden = true;
  els.decOutput.innerHTML = "";

  if (!raw.trim()) { flashDec("Paste an encrypted value to decrypt.", true); return; }
  if (!state.key) { flashDec("Set the AES key in 🔑 Key first.", true); return; }

  flashDec("Decrypting…");
  const url = urlWithQuery(raw.trim());
  if (url) { await decryptUrl(url); return; }

  // Plain ciphertext value. Try a few encodings so quoted / percent-encoded /
  // whitespace-wrapped ciphertext still decrypts; tryDecryptAuto also does the
  // best-effort no-pad pass and auto-falls back to the lenient (ragged) path.
  const candidates = [raw, raw.trim(), stripQuotes(raw), safeDecode(raw)];
  const res = await CipherNetCrypto.tryDecryptAuto(candidates, state.key, state.iv);
  renderResult(res, raw);
}

// Task 4: the input is a URL whose query string is the ciphertext — decrypt just
// the query and show the full decrypted URL (plus the decrypted query body).
async function decryptUrl({ base, query }) {
  const candidates = [query, safeDecode(query), query.replace(/ /g, "+")];
  const res = await CipherNetCrypto.tryDecryptAuto(candidates, state.key, state.iv);
  if (!res.ok) { renderResult(res, query); return; }

  els.decOutput.innerHTML = "";
  const note = decryptNote(res);
  if (note) els.decOutput.appendChild(el("div", "muted-block", note));
  els.decOutput.appendChild(decOutRow("Decrypted URL", base + "?" + res.text));
  // The body view below shows the decrypted query on its own (raw/decrypted
  // toggle + Copy), handy when it's JSON or a long param list.
  els.decOutput.appendChild(bodyView(res.text, query, res));
  els.decOutput.hidden = false;
  flashDec("Decrypted ✓");
}

// Render a plain-value decrypt result (or a failure) via bodyView.
function renderResult(res, raw) {
  els.decOutput.innerHTML = "";
  const note = res.ok ? decryptNote(res) : null;
  if (note) els.decOutput.appendChild(el("div", "muted-block", note));
  els.decOutput.appendChild(bodyView(res.ok ? res.text : null, raw, res));
  els.decOutput.hidden = false;
  flashDec(res.ok ? "Decrypted ✓" : (res.error || "Decryption failed."), !res.ok);
}
