// ui/encryptTool.js — the 🔒 Encrypt URL drawer: a Postman-style Query Params
// editor two-way bound to the URL, AES encryption of the query/body, and
// Send Encrypt / Send Decrypt requests with a decrypting response viewer.

import { state } from "../core/state.js";
import { els } from "../core/els.js";
import { el, copyBtn } from "../core/dom.js";
import { CipherNetCrypto } from "../core/crypto.js";
import { safeDecode, fmtTime, fmtSize, stripQuotes } from "../core/format.js";
import { bodyView } from "./detail.js";
import { showView, currentView } from "./views.js";

// Encrypt a plaintext URL/payload with the saved key the same way the CipherNet
// backend does (AES-128-CBC -> Base64), so the output round-trips with the
// decrypt path. The URL's query string is what gets encrypted; a bare value
// (no "?") is encrypted whole.
els.encryptToggle.addEventListener("click", () => {
  // Toggle the Encrypt URL drawer; showView hides the network list / detail view
  // and the resource-type filter row for a focused encrypt view (Network button
  // or clicking Encrypt URL again returns to the list).
  const open = currentView() !== "encrypt";
  showView(open ? "encrypt" : "network");
  if (open) renderParamsFromUrl();
});
els.encryptBtn.addEventListener("click", runEncrypt);
els.sendEncryptBtn.addEventListener("click", () => sendRequest("encrypt"));
els.sendDecryptBtn.addEventListener("click", () => sendRequest("decrypt"));
els.encUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runEncrypt(); }
});
// Live Postman-style Query Params: parse the URL's query into an editable table.
els.encUrl.addEventListener("input", renderParamsFromUrl);
els.encryptClear.addEventListener("click", () => {
  els.encUrl.value = "";
  els.encBody.value = "";
  els.encToken.value = "";
  els.encOutput.hidden = true;
  els.encOutput.innerHTML = "";
  els.encResponse.hidden = true;
  els.encResponse.innerHTML = "";
  renderParamsFromUrl(); // clears + hides the params table
  flashEnc("");
});

/* ---- Query Params editor (Postman-style, two-way bound to the URL) ---- */
// Split a URL into the part before "?" and the raw query (no encrypt semantics).
function urlBaseQuery(url) {
  const i = url.indexOf("?");
  return i === -1 ? { base: url, query: "" } : { base: url.slice(0, i), query: url.slice(i + 1) };
}
function parseQueryPairs(query) {
  const pairs = [];
  for (const part of query.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = i === -1 ? part : part.slice(0, i);
    const v = i === -1 ? "" : part.slice(i + 1);
    pairs.push({ key: safeDecode(k) ?? k, value: safeDecode(v) ?? v });
  }
  return pairs;
}
// One editable row: [enable] Key | Value | Description | [remove].
function makeParamRow(key = "", value = "", enabled = true) {
  const row = el("div", "ep-row");
  const enWrap = el("span", "ep-col-enable");
  const en = el("input", "ep-enable");
  en.type = "checkbox";
  en.checked = enabled;
  enWrap.appendChild(en);
  const mk = (cls, ph, val) => {
    const inp = el("input", cls);
    inp.type = "text";
    inp.placeholder = ph;
    inp.spellcheck = false;
    inp.value = val;
    return inp;
  };
  const actWrap = el("span", "ep-col-act");
  const rm = el("button", "ep-remove", "✕");
  rm.type = "button";
  rm.title = "Remove parameter";
  rm.addEventListener("click", () => { row.remove(); syncUrlFromParams(); });
  actWrap.appendChild(rm);
  row.append(enWrap, mk("ep-key", "Key", key), mk("ep-value", "Value", value), mk("ep-desc", "Description", ""), actWrap);
  return row;
}
// Rebuild the params table from the URL's query (URL is the source of truth when
// the user edits the URL text directly).
function renderParamsFromUrl() {
  const url = els.encUrl.value;
  els.encParamsBody.innerHTML = "";
  if (!url.trim()) { els.encParams.hidden = true; return; }
  els.encParams.hidden = false;
  for (const p of parseQueryPairs(urlBaseQuery(url).query)) {
    els.encParamsBody.appendChild(makeParamRow(p.key, p.value, true));
  }
  els.encParamsBody.appendChild(makeParamRow()); // trailing "add" row
}
// Rebuild the URL's query from the table (the table is the source of truth while
// the user edits params); keeps one empty trailing row like Postman.
function syncUrlFromParams() {
  const rows = [...els.encParamsBody.querySelectorAll(".ep-row")];
  const query = rows
    .map((r) => ({
      on: r.querySelector(".ep-enable").checked,
      key: r.querySelector(".ep-key").value,
      value: r.querySelector(".ep-value").value,
    }))
    .filter((p) => p.on && p.key !== "")
    .map((p) => encodeURIComponent(p.key) + "=" + encodeURIComponent(p.value))
    .join("&");
  const { base } = urlBaseQuery(els.encUrl.value);
  els.encUrl.value = base + (query ? "?" + query : "");
  ensureTrailingRow();
}
function ensureTrailingRow() {
  const rows = [...els.encParamsBody.querySelectorAll(".ep-row")];
  const last = rows[rows.length - 1];
  if (!last) { els.encParamsBody.appendChild(makeParamRow()); return; }
  const used = last.querySelector(".ep-key").value !== "" || last.querySelector(".ep-value").value !== "";
  if (used) els.encParamsBody.appendChild(makeParamRow());
}
els.encParamsBody.addEventListener("input", syncUrlFromParams);
els.encParamsBody.addEventListener("change", syncUrlFromParams);

function flashEnc(msg, isErr) {
  els.encStatus.textContent = msg;
  els.encStatus.classList.toggle("err", !!isErr);
}

// Split a URL into base + query. With no "?", the whole value is encrypted.
function splitUrlForEncrypt(url) {
  const i = url.indexOf("?");
  if (i === -1) return { base: null, query: url };
  return { base: url.slice(0, i), query: url.slice(i + 1) };
}

// One output line: label + value + Copy button.
function encOutRow(label, value) {
  const row = el("div", "enc-out-row");
  row.appendChild(el("div", "enc-out-label", label));
  row.appendChild(el("div", "enc-out-value", value));
  row.appendChild(copyBtn(() => value));
  return row;
}

async function runEncrypt() {
  const url = els.encUrl.value.trim();
  const body = els.encBody.value;
  els.encOutput.hidden = true;
  els.encOutput.innerHTML = "";

  if (!url && !body.trim()) { flashEnc("Enter a URL or payload to encrypt.", true); return; }
  if (!state.key) { flashEnc("Set the AES key in 🔑 Key first.", true); return; }

  // Only a URL's query string is encryptable; a URL with no query params is left
  // as-is (there's nothing to encrypt in a bare path).
  const { base, query } = url ? splitUrlForEncrypt(url) : { base: null, query: "" };
  const hasQuery = base != null && query.trim() !== "";
  const hasBody = body.trim() !== "";
  if (url && !hasQuery && !hasBody) {
    flashEnc("This URL has no query params to encrypt.", true);
    return;
  }

  flashEnc("Encrypting…");
  try {
    const out = el("div");
    if (hasQuery) {
      const cipher = await CipherNetCrypto.encrypt(query, state.key, state.iv);
      out.appendChild(encOutRow("Encrypted URL", base + "?" + cipher));
      out.appendChild(encOutRow("Encrypted query", cipher));
    } else if (url) {
      out.appendChild(el("div", "muted", "URL has no query params — left unencrypted."));
    }
    if (hasBody) {
      const cipher = await CipherNetCrypto.encrypt(body, state.key, state.iv);
      out.appendChild(encOutRow("Encrypted body", cipher));
    }
    els.encOutput.appendChild(out);
    els.encOutput.hidden = false;
    flashEnc("Encrypted ✓");
  } catch (e) {
    flashEnc(e.message || "Encryption failed.", true);
  }
}

/* ------- Send Encrypt / Send Decrypt: fire the request like Postman ------- */
// Common reason phrases (the browser leaves statusText empty on HTTP/2).
function reasonPhrase(code) {
  const M = {
    200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 304: "Not Modified",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 415: "Unsupported Media Type",
    422: "Unprocessable Entity", 429: "Too Many Requests",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return M[code] || "";
}

// mode "encrypt": encrypt the query string + body first, then send.
// mode "decrypt": send the URL/body exactly as entered (no encryption).
// The Bearer Token is always sent as-is in the Authorization header.
async function sendRequest(mode) {
  const rawUrl = els.encUrl.value.trim();
  const rawBody = els.encBody.value;
  const token = els.encToken.value.trim();
  els.encResponse.hidden = true;
  els.encResponse.innerHTML = "";

  if (!rawUrl) { flashEnc("Enter a URL to send.", true); return; }

  const { base, query } = splitUrlForEncrypt(rawUrl);
  const willEncryptQuery = base != null && query.trim() !== "";
  const willEncryptBody = rawBody.trim() !== "";
  if (mode === "encrypt" && (willEncryptQuery || willEncryptBody) && !state.key) {
    flashEnc("Set the AES key in 🔑 Key first.", true);
    return;
  }

  let url = rawUrl;
  let body = rawBody;
  try {
    if (mode === "encrypt") {
      if (willEncryptQuery) url = base + "?" + (await CipherNetCrypto.encrypt(query, state.key, state.iv));
      if (willEncryptBody) body = await CipherNetCrypto.encrypt(rawBody, state.key, state.iv);
    }
  } catch (e) {
    flashEnc(e.message || "Encryption failed.", true);
    return;
  }

  const method = body.trim() !== "" ? "POST" : "GET";
  const headers = {};
  if (token) headers["Authorization"] = /^bearer\s/i.test(token) ? token : "Bearer " + token;
  if (method === "POST") headers["Content-Type"] = "application/json";

  flashEnc("Sending…");
  const started = performance.now();
  try {
    const resp = await fetch(url, { method, headers, body: method === "POST" ? body : undefined });
    const text = await resp.text();
    await renderSendResponse({
      status: resp.status,
      statusText: resp.statusText,
      timeMs: Math.round(performance.now() - started),
      size: new Blob([text]).size,
      body: text,
    });
    flashEnc("");
  } catch (e) {
    flashEnc("Request failed: " + (e.message || e), true);
  }
}

// Postman-style response: a status/time/size meta line + the body. The body reuses
// bodyView (same as the Response detail tab): it shows the decrypted text when the
// body decrypts, and the raw bytes + the reason when it can't — so "View decrypted"
// always gives feedback instead of silently doing nothing on an error response.
async function renderSendResponse(r) {
  els.encResponse.innerHTML = "";
  els.encResponse.hidden = false;

  const ok = r.status >= 200 && r.status < 400;
  const meta = el("div", "resp-meta");
  meta.appendChild(el("span", "resp-status " + (ok ? "ok" : "bad"),
    `${r.status} ${r.statusText || reasonPhrase(r.status)}`.trim()));
  meta.appendChild(el("span", "resp-dim", fmtTime(r.timeMs)));
  meta.appendChild(el("span", "resp-dim", fmtSize(r.size)));
  els.encResponse.appendChild(meta);

  if (!r.body) {
    els.encResponse.appendChild(el("div", "muted-block", "No response body."));
    return;
  }
  // Try a few encodings so quoted / whitespace-wrapped ciphertext still decrypts.
  // tryDecryptLoose also falls back to a best-effort no-pad decrypt, so an
  // odd-padded API response (e.g. an error body) still comes out as text.
  const candidates = [r.body, r.body.trim(), stripQuotes(r.body), safeDecode(r.body)];
  const res = await CipherNetCrypto.tryDecryptLoose(candidates, state.key, state.iv);
  if (res.forced) {
    els.encResponse.appendChild(el("div", "muted-block", "Decrypted best-effort (response padding ignored)."));
  }
  els.encResponse.appendChild(bodyView(res.ok ? res.text : null, r.body, res));
}
