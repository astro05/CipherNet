// ui/encryptTool.js — the 🔒 API Testing drawer: a Postman-style Query Params
// editor two-way bound to the URL, plus Send Encrypted / Send Plain requests
// (Send Encrypted AES-encrypts the query/body first) with a decrypting response
// viewer. Encrypting a value on its own lives in the 🔐 Encrypt/Decrypt drawer.
// (Internally the view is still named "encrypt".)

import { state } from "../core/state.js";
import { els } from "../core/els.js";
import { el } from "../core/dom.js";
import { CipherNetCrypto } from "../core/crypto.js";
import { safeDecode, fmtTime, fmtSize, stripQuotes } from "../core/format.js";
import {
  getCollections, setCollections, loadHistory, addHistoryEntry, removeHistoryEntry, clearHistory,
} from "../services/storage.js";
import * as backup from "../services/backup.js";
import { bodyView } from "./detail.js";
import { showView, currentView } from "./views.js";

els.encryptToggle.addEventListener("click", () => {
  // Toggle the API Testing drawer; showView hides the network list / detail view
  // and the resource-type filter row for a focused view (Network button
  // or clicking API Testing again returns to the list).
  const open = currentView() !== "encrypt";
  showView(open ? "encrypt" : "network");
  if (open) renderParamsFromUrl();
});
els.sendEncryptBtn.addEventListener("click", () => sendRequest("encrypt"));
els.sendDecryptBtn.addEventListener("click", () => sendRequest("decrypt"));
// Live Postman-style Query Params: parse the URL's query into an editable table.
els.encUrl.addEventListener("input", renderParamsFromUrl);
els.encryptClear.addEventListener("click", () => {
  els.encUrl.value = "";
  els.encBody.value = "";
  els.encToken.value = "";
  els.encResponse.hidden = true;
  els.encResponse.innerHTML = "";
  renderParamsFromUrl(); // clears + hides the params table
  currentRef = null;     // no longer editing a saved request
  checkDirty();
  closePanels();
  flashEnc("");
});

/* ------------------------------ collections ------------------------------ */
// Folders of saved requests: { folderName: { apiName: { url, body, token } } }.
// The toolbar's 📚 Collection (browse tree) and ➕ Add (save new) buttons drive
// this; 💾 Save appears when a loaded request is modified so you can update it.
let collections = {};
let currentRef = null;      // { folder, name } of the loaded/saved request, or null
let currentSnapshot = null; // { url, body, token } captured at load/save time

// Write collections to chrome.storage *and* mirror them to the backup file (a
// no-op when none is linked). Every mutation below goes through here so the file
// can't drift from the live store.
function persistCollections(cb) {
  setCollections(collections, cb);
  backup.scheduleWrite(collections, history);
}

function snapshot() {
  return { url: els.encUrl.value, body: els.encBody.value, token: els.encToken.value };
}
function sameSnapshot(a, b) {
  return !!a && !!b && a.url === b.url && a.body === b.body && a.token === b.token;
}
// Show 💾 Save only when a saved request is loaded AND has been modified.
function checkDirty() {
  els.saveReqBtn.hidden = !(currentRef && !sameSnapshot(snapshot(), currentSnapshot));
}
[els.encUrl, els.encBody, els.encToken].forEach((elm) => elm.addEventListener("input", checkDirty));

function closePanels() {
  els.addPanel.hidden = true;
  els.collectionPanel.hidden = true;
  els.historyPanel.hidden = true;
  els.backupMenu.hidden = true;
}
// Close the pop-panels when clicking anywhere outside the collection tools.
document.addEventListener("click", (e) => {
  if (e.target.closest && !e.target.closest("#encTools")) closePanels();
});

/* ---- ➕ Add: save the current request under an API name + folder ---- */
els.addReqBtn.addEventListener("click", () => {
  const willOpen = els.addPanel.hidden;
  closePanels();
  if (!willOpen) return;
  const names = Object.keys(collections).sort();
  els.addFolder.innerHTML = "";
  if (!names.length) els.addFolder.appendChild(new Option("(use New folder below)", ""));
  for (const n of names) els.addFolder.appendChild(new Option(n, n));
  if (currentRef) els.addFolder.value = currentRef.folder;
  els.addName.value = currentRef ? currentRef.name : "";
  els.addNewFolder.value = "";
  els.addPanel.hidden = false;
  els.addName.focus();
});
els.addCancelBtn.addEventListener("click", () => { els.addPanel.hidden = true; });
els.addSaveBtn.addEventListener("click", () => {
  const name = els.addName.value.trim();
  if (!name) { flashEnc("Enter an API name.", true); return; }
  const folder = els.addNewFolder.value.trim() || els.addFolder.value || "Default";
  if (!collections[folder]) collections[folder] = {};
  collections[folder][name] = snapshot();
  persistCollections((err) => flashEnc(err ? `Save failed: ${err}` : `Saved “${name}” to “${folder}” ✓`, !!err));
  currentRef = { folder, name };
  currentSnapshot = snapshot();
  els.addPanel.hidden = true;
  checkDirty();
});

/* ---- 💾 Save: update the currently-loaded request in place ---- */
els.saveReqBtn.addEventListener("click", () => {
  if (!currentRef) return;
  if (!collections[currentRef.folder]) collections[currentRef.folder] = {};
  collections[currentRef.folder][currentRef.name] = snapshot();
  persistCollections((err) => flashEnc(err ? `Save failed: ${err}` : `Updated “${currentRef.name}” ✓`, !!err));
  currentSnapshot = snapshot();
  checkDirty();
});

/* ---- 📚 Collection: a tree of folders → APIs, each deletable ---- */
els.collectionBtn.addEventListener("click", () => {
  const willOpen = els.collectionPanel.hidden;
  closePanels();
  if (!willOpen) return;
  renderCollectionTree();
  els.collectionPanel.hidden = false;
});
function renderCollectionTree() {
  const panel = els.collectionPanel;
  panel.innerHTML = "";
  const folders = Object.keys(collections).sort();
  if (!folders.length) {
    panel.appendChild(el("div", "muted-block", "No saved requests yet — use ➕ Add."));
    return;
  }
  for (const folder of folders) {
    const fRow = el("div", "tree-folder");
    fRow.append(el("span", "tree-ic", "📁"), el("span", "tree-name", folder));
    const fRen = el("button", "tree-rename", "✎");
    fRen.title = "Rename folder";
    fRen.addEventListener("click", (e) => { e.stopPropagation(); renameFolder(folder); });
    const fDel = el("button", "tree-del", "🗑");
    fDel.title = "Delete folder and its requests";
    fDel.addEventListener("click", (e) => { e.stopPropagation(); delFolder(folder); });
    fRow.append(fRen, fDel);
    panel.appendChild(fRow);

    const apis = Object.keys(collections[folder]).sort();
    if (!apis.length) panel.appendChild(el("div", "tree-empty", "(empty)"));
    for (const name of apis) {
      const aRow = el("div", "tree-api" + (currentRef && currentRef.folder === folder && currentRef.name === name ? " active" : ""));
      aRow.append(el("span", "tree-ic", "•"), el("span", "tree-name", name));
      const aRen = el("button", "tree-rename", "✎");
      aRen.title = "Rename request";
      aRen.addEventListener("click", (e) => { e.stopPropagation(); renameApi(folder, name); });
      const aDel = el("button", "tree-del", "🗑");
      aDel.title = "Delete request";
      aDel.addEventListener("click", (e) => { e.stopPropagation(); delApi(folder, name); });
      aRow.append(aRen, aDel);
      aRow.addEventListener("click", () => loadApi(folder, name));
      panel.appendChild(aRow);
    }
  }
}

/* ---- 🕘 History: an automatic, unnamed log of the last 100 sent requests ---- */
// Request-only (+ response summary) so it stays comfortably inside the
// chrome.storage.sync quota — see services/storage.js. Kept in sync with the
// synced store in `history`, newest first.
let history = [];

// Persist one sent request (request + response summary, no response body —
// see services/storage.js) and mirror it into the in-memory list.
function saveHistoryEntry(histEntry) {
  addHistoryEntry(histEntry).then(({ ok, key }) => {
    if (!ok) return;
    history.unshift({ ...histEntry, _key: key });
    if (history.length > 100) history.length = 100;
    backup.scheduleWrite(collections, history);
    if (!els.historyPanel.hidden) renderHistoryPanel();
  });
}

/* -------------------------- load collections + history -------------------------- */
// chrome.storage first, then the linked backup file (if any) on top of it —
// that second step is what brings saved requests back after the extension has
// been removed and re-added, with no interaction beyond re-linking the file once.
async function loadStores() {
  const { collections: c, legacy } = await getCollections();
  collections = c || {};
  // Migrate pre-2.9 flat saves, and pre-2.14 local-only saves, into synced
  // folder-based collections the first time.
  if (!c && legacy && Object.keys(legacy).length) {
    collections = { Default: legacy };
    setCollections(collections);
  }
  history = (await loadHistory()).reverse(); // storage keeps oldest-first; show newest first

  const res = await backup.pullOnLoad(collections, history);
  if (res.pulled) {
    collections = res.collections;
    history = res.history;
  }
  renderOpenPanels();
  refreshBackupState();
}
function renderOpenPanels() {
  if (!els.historyPanel.hidden) renderHistoryPanel();
  if (!els.collectionPanel.hidden) renderCollectionTree();
}
loadStores();

// backup.html broadcasts this after linking / restoring / re-authorising a file:
// chrome.storage has changed underneath us, so re-read it.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "backup.linked") loadStores();
});

els.historyBtn.addEventListener("click", () => {
  const willOpen = els.historyPanel.hidden;
  closePanels();
  if (!willOpen) return;
  renderHistoryPanel();
  els.historyPanel.hidden = false;
});

function renderHistoryPanel() {
  const panel = els.historyPanel;
  panel.innerHTML = "";
  const actions = el("div", "hist-actions");
  actions.appendChild(el("span", "muted", `Request History (${history.length}/100)`));
  const clearBtn = el("button", "linkbtn", "Clear");
  clearBtn.title = "Clear all request history";
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!history.length) return;
    history = [];
    clearHistory();
    backup.scheduleWrite(collections, history);
    renderHistoryPanel();
  });
  actions.appendChild(clearBtn);
  panel.appendChild(actions);

  if (!history.length) {
    panel.appendChild(el("div", "muted-block", "No requests sent yet — use Send Encrypted / Send Plain."));
    return;
  }
  for (const h of history) {
    const ok = h.status >= 200 && h.status < 400;
    const row = el("div", "hist-row");
    row.append(
      el("span", "rhist-method", h.method),
      el("span", "rhist-status " + (ok ? "ok" : "bad"), String(h.status || "—")),
      el("span", "rhist-url", h.url),
      el("span", "rhist-time", fmtTime(h.timeMs))
    );
    const del = el("button", "tree-del", "🗑");
    del.title = "Remove from history";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      history = history.filter((x) => x !== h);
      if (h._key) removeHistoryEntry(h._key);
      backup.scheduleWrite(collections, history);
      renderHistoryPanel();
    });
    row.appendChild(del);
    row.addEventListener("click", () => {
      els.encUrl.value = h.url || "";
      els.encBody.value = h.body || "";
      els.encToken.value = h.token || "";
      renderParamsFromUrl();
      currentRef = null; // loading history doesn't attach it to a saved collection entry
      currentSnapshot = null;
      checkDirty();
      closePanels();
      flashEnc("Loaded from history");
    });
    panel.appendChild(row);
  }
}

/* ---- 🗄 Backup: keep collections + history in a file, not just in Chrome ---- */
// Chrome wipes an extension's storage — local and sync alike — when the
// extension is removed, so a linked file is the only thing that survives it.
// Linking needs a file picker, which Chrome refuses to open inside a DevTools
// panel, so that step hands off to the backup.html tab; everything else
// (restore-from-a-copy, download-a-copy) works right here.

els.backupBtn.addEventListener("click", () => {
  const willOpen = els.backupMenu.hidden;
  closePanels();
  if (!willOpen) return;
  refreshBackupState();
  els.backupMenu.hidden = false;
});

// Reflect whether a file is linked, and whether Chrome still lets us write it.
async function refreshBackupState() {
  const st = await backup.status();
  const linked = !!(st && st.linked);
  const ready = !!(st && st.ready);
  els.backupMenu.querySelector('[data-act="unlink"]').hidden = !linked;
  els.backupBtn.classList.toggle("warn", linked && !ready);

  if (!linked) {
    els.backupState.className = "menu-note";
    els.backupState.textContent = "Not linked — collections and history are lost if you remove the extension.";
  } else if (ready) {
    els.backupState.className = "menu-note ok";
    els.backupState.textContent = `Auto-saving to “${st.name}”.`;
  } else {
    els.backupState.className = "menu-note warn";
    els.backupState.textContent = `“${st.name}” needs re-authorising — Chrome drops file access when it restarts. Use “Link backup file…”.`;
  }
}

els.backupMenu.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "link") {
    // Opens backup.html; it messages us back ("backup.linked") when it's done.
    backup.openHelper("link");
    closePanels();
  } else if (act === "restore") {
    els.backupFile.click();
  } else if (act === "download") {
    downloadBackup();
    closePanels();
  } else if (act === "unlink") {
    backup.unlink().then(refreshBackupState);
  }
});

function downloadBackup() {
  const blob = new Blob([backup.serialize(collections, history)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ciphernet-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  flashEnc("Backup downloaded ✓");
}

// Restore from any backup copy. A plain file input, so it works in the panel
// itself — unlike the File System Access picker that linking needs.
els.backupFile.addEventListener("change", async () => {
  const file = els.backupFile.files && els.backupFile.files[0];
  els.backupFile.value = ""; // let the same file be picked again later
  if (!file) return;
  closePanels();
  try {
    const res = await backup.restoreFromText(await file.text());
    collections = res.collections;
    history = res.history;
    currentRef = null;
    currentSnapshot = null;
    checkDirty();
    flashEnc(`Restored ${res.requests} request(s) in ${res.folders} folder(s) and ${res.history.length} history entries ✓`);
  } catch (err) {
    flashEnc(`Restore failed: ${err.message || err}`, true);
  }
});

function renameFolder(folder) {
  const next = (prompt("Rename folder:", folder) || "").trim();
  if (!next || next === folder) return;
  if (collections[next]) { flashEnc(`Folder “${next}” already exists.`, true); return; }
  collections[next] = collections[folder];
  delete collections[folder];
  if (currentRef && currentRef.folder === folder) currentRef.folder = next;
  persistCollections((err) => flashEnc(err ? `Rename failed: ${err}` : `Renamed folder to “${next}”`, !!err));
  renderCollectionTree();
}
function renameApi(folder, name) {
  const f = collections[folder];
  if (!f) return;
  const next = (prompt("Rename request:", name) || "").trim();
  if (!next || next === name) return;
  if (f[next]) { flashEnc(`“${next}” already exists in this folder.`, true); return; }
  f[next] = f[name];
  delete f[name];
  if (currentRef && currentRef.folder === folder && currentRef.name === name) currentRef.name = next;
  persistCollections((err) => flashEnc(err ? `Rename failed: ${err}` : `Renamed to “${next}”`, !!err));
  renderCollectionTree();
}
function loadApi(folder, name) {
  const r = collections[folder] && collections[folder][name];
  if (!r) return;
  els.encUrl.value = r.url || "";
  els.encBody.value = r.body || "";
  els.encToken.value = r.token || "";
  renderParamsFromUrl();
  currentRef = { folder, name };
  currentSnapshot = snapshot();
  checkDirty();
  els.collectionPanel.hidden = true;
  flashEnc(`Loaded “${name}”`);
}
function delFolder(folder) {
  delete collections[folder];
  if (currentRef && currentRef.folder === folder) { currentRef = null; checkDirty(); }
  persistCollections(() => flashEnc(`Folder “${folder}” deleted`));
  renderCollectionTree();
}
function delApi(folder, name) {
  if (collections[folder]) delete collections[folder][name];
  if (currentRef && currentRef.folder === folder && currentRef.name === name) { currentRef = null; checkDirty(); }
  persistCollections(() => flashEnc(`Deleted “${name}”`));
  renderCollectionTree();
}

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
  checkDirty(); // editing params changes the URL → maybe mark the request dirty
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

/* ------- Send Encrypted / Send Plain: fire the request like Postman ------- */
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
    // Decrypt the response body up front (auto-lenient on failure) so switching
    // response tabs / history is instant.
    const candidates = [text, text.trim(), stripQuotes(text), safeDecode(text)];
    const decRes = text ? await CipherNetCrypto.tryDecryptAuto(candidates, state.key, state.iv) : null;
    const entry = {
      method, url,
      status: resp.status,
      statusText: resp.statusText,
      timeMs: Math.round(performance.now() - started),
      size: new Blob([text]).size,
      body: text,
      headers: [...resp.headers.entries()].map(([name, value]) => ({ name, value })),
      decRes,
      at: new Date(),
    };
    sendHistory.push(entry);
    saveHistoryEntry({
      method, mode, url: rawUrl, body: rawBody, token,
      status: entry.status, statusText: entry.statusText,
      timeMs: entry.timeMs, size: entry.size, at: entry.at.toISOString(),
    });
    respTab = "body";
    renderResponseView(entry);
    flashEnc("");
  } catch (e) {
    flashEnc("Request failed: " + (e.message || e), true);
  }
}

/* --------------------- Postman-style response viewer --------------------- */
// Past sends this session (for the History tab). In-memory only.
const sendHistory = [];
let respTab = "body";

// Status/time/size meta line + Body / Cookies / Headers / History tabs. `entry`
// is the response being shown (may be an older one picked from History).
function renderResponseView(entry) {
  els.encResponse.innerHTML = "";
  els.encResponse.hidden = false;

  const ok = entry.status >= 200 && entry.status < 400;
  const meta = el("div", "resp-meta");
  meta.appendChild(el("span", "resp-status " + (ok ? "ok" : "bad"),
    `${entry.status} ${entry.statusText || reasonPhrase(entry.status)}`.trim()));
  meta.appendChild(el("span", "resp-dim", fmtTime(entry.timeMs)));
  meta.appendChild(el("span", "resp-dim", fmtSize(entry.size)));
  meta.appendChild(el("span", "resp-dim", `${entry.method} ${entry.url}`));
  els.encResponse.appendChild(meta);

  const tabs = el("div", "resp-tabs");
  const content = el("div", "resp-tabcontent");
  const defs = [
    ["body", "Body"],
    ["cookies", "Cookies"],
    ["headers", `Headers (${entry.headers.length})`],
    ["history", `History (${sendHistory.length})`],
  ];
  for (const [id, label] of defs) {
    const b = el("button", "rtab" + (id === respTab ? " active" : ""), label);
    b.addEventListener("click", () => { respTab = id; renderResponseView(entry); });
    tabs.appendChild(b);
  }
  els.encResponse.appendChild(tabs);
  els.encResponse.appendChild(content);

  if (respTab === "headers") content.appendChild(respHeaders(entry));
  else if (respTab === "cookies") content.appendChild(respCookies(entry));
  else if (respTab === "history") content.appendChild(respHistory(entry));
  else content.appendChild(respBody(entry));
}

// Body tab: reuses bodyView (decrypted text when it decrypts, raw + reason when
// not), with a note when the decrypt was lenient / best-effort. When decryption
// fails outright, that almost always means the response simply wasn't
// encrypted (e.g. a plain endpoint hit via Send Plain) rather than a real
// error, so it's shown as plain raw output instead of a decrypt-failure note.
function respBody(entry) {
  if (!entry.body) return el("div", "muted-block", "No response body.");
  const wrap = el("div");
  const res = entry.decRes;
  const ok = !!(res && res.ok);
  if (ok && res.lenient) {
    wrap.appendChild(el("div", "muted-block", `Lenient decrypt: dropped ${res.dropped} ragged tail byte(s).`));
  } else if (ok && res.forced) {
    wrap.appendChild(el("div", "muted-block", "Decrypted best-effort (response padding ignored)."));
  }
  wrap.appendChild(bodyView(ok ? res.text : null, entry.body, ok ? res : null));
  return wrap;
}

function respHeaders(entry) {
  if (!entry.headers.length) {
    return el("div", "muted-block", "No readable response headers. (Cross-origin responses expose only CORS-safelisted headers.)");
  }
  const grid = el("div", "kv");
  for (const h of entry.headers) {
    grid.appendChild(el("div", "k", h.name));
    grid.appendChild(el("div", "v", h.value));
  }
  return grid;
}

function respCookies(entry) {
  const setCookies = entry.headers.filter((h) => /^set-cookie$/i.test(h.name));
  if (!setCookies.length) {
    return el("div", "muted-block", "No response cookies. (Browsers hide Set-Cookie from fetch, so server-set cookies aren't visible here.)");
  }
  const grid = el("div", "kv");
  for (const h of setCookies) {
    const pair = h.value.split(";")[0];
    const i = pair.indexOf("=");
    grid.appendChild(el("div", "k", i < 0 ? pair : pair.slice(0, i)));
    grid.appendChild(el("div", "v", i < 0 ? "" : pair.slice(i + 1)));
  }
  return grid;
}

function respHistory(current) {
  if (!sendHistory.length) return el("div", "muted-block", "No requests sent yet.");
  const list = el("div", "resp-history");
  for (let i = sendHistory.length - 1; i >= 0; i--) {
    const h = sendHistory[i];
    const ok = h.status >= 200 && h.status < 400;
    const row = el("button", "rhist-row" + (h === current ? " active" : ""));
    row.appendChild(el("span", "rhist-method", h.method));
    row.appendChild(el("span", "rhist-status " + (ok ? "ok" : "bad"), String(h.status)));
    row.appendChild(el("span", "rhist-url", h.url));
    row.appendChild(el("span", "rhist-time", fmtTime(h.timeMs)));
    row.addEventListener("click", () => { respTab = "body"; renderResponseView(h); });
    list.appendChild(row);
  }
  return list;
}
