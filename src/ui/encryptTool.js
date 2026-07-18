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
  getEnvironments, setEnvironments,
  loadSavedResponses, addSavedResponse, updateSavedResponses,
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

/* ---- Request line: method + URL + Send Encrypted / Send Plain buttons ---- */
// Two side-by-side buttons: green Send Encrypted (AES-encrypt the query/body
// first) and purple Send Plain (send exactly as entered).
els.sendEncryptBtn.addEventListener("click", () => sendRequest("encrypt"));
els.sendPlainBtn.addEventListener("click", () => sendRequest("decrypt"));

// Typing a body implies a request that carries one: bump GET → POST (only from
// GET, never overriding an explicit PUT/PATCH/…) so bodies aren't silently dropped.
els.encMethod.addEventListener("change", () => { checkDirty(); updateReqTabIndicators(); });
els.encBody.addEventListener("input", () => {
  if (els.encBody.value.trim() !== "" && els.encMethod.value === "GET") els.encMethod.value = "POST";
  checkDirty();
  updateReqTabIndicators();
});

// Live Postman-style Query Params: parse the URL's query into an editable table.
els.encUrl.addEventListener("input", renderParamsFromUrl);

/* ---- Request tabs (Params / Authorization / Headers / Body) ---- */
els.reqTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".req-tab");
  if (btn) setReqTab(btn.dataset.rtab);
});
function setReqTab(name) {
  for (const b of els.reqTabs.querySelectorAll(".req-tab")) b.classList.toggle("active", b.dataset.rtab === name);
  for (const p of els.reqPanels.querySelectorAll(".req-panel")) p.hidden = p.dataset.panel !== name;
}

/* ---- Authorization: No Auth / Bearer Token ---- */
function syncAuthUi() { els.authTokenField.hidden = els.authType.value !== "bearer"; }
els.authType.addEventListener("change", () => { syncAuthUi(); checkDirty(); updateReqTabIndicators(); });
els.encToken.addEventListener("input", () => { checkDirty(); updateReqTabIndicators(); });

/* ---- Bulk Edit toggles for the Params / Headers tables ---- */
els.reqPanels.addEventListener("click", (e) => {
  const b = e.target.closest(".bulk-toggle");
  if (b) toggleBulk(b.dataset.bulk, b);
});

els.encryptClear.addEventListener("click", () => {
  setReq({});
  els.encResponse.hidden = true;
  els.encResponse.innerHTML = "";
  currentRef = null;     // no longer editing a saved request
  checkDirty();
  closePanels();
  flashEnc("");
});

/* ------------------------------ collections ------------------------------ */
// Folders of saved requests: { folderName: { apiName: <snapshot()> } }, where a
// snapshot is { url, method, body, token, authType, headers }. The toolbar's
// 📚 Collection (browse tree) and ➕ Add (save new) buttons drive this; 💾 Save
// appears when a loaded request is modified so you can update it.
let collections = {};
let currentRef = null;      // { folder, name } of the loaded/saved request, or null
let currentSnapshot = null; // snapshot() captured at load/save time (for dirty checks)

// Mirror the full backed-up state (collections, history, environments, saved
// responses) to the linked file. A no-op when none is linked. Everything that
// mutates any of those four goes through here so the file can't drift.
function scheduleBackup() {
  backup.scheduleWrite(collections, history, environments, savedResponses);
}

// Write collections to chrome.storage *and* mirror them to the backup file.
function persistCollections(cb) {
  setCollections(collections, cb);
  scheduleBackup();
}

/* --------------------------- environments ({{vars}}) --------------------------- */
// Postman-style environments: named sets of variables referenced as {{name}} in
// the URL / headers / body / token, substituted at send time (the editors keep
// the {{name}} literal, so it's non-destructive). Persisted in chrome.storage.sync.
let environments = {};   // { envName: { varName: value } }
let activeEnv = "";      // "" = No Environment

function persistEnvironments(cb) { setEnvironments(environments, activeEnv, cb); scheduleBackup(); }

// Replace every {{name}} with the active environment's value; unknown names are
// left as-is (so a stray {{x}} is visible rather than silently blanked).
function resolveVars(str) {
  if (typeof str !== "string" || str.indexOf("{{") === -1) return str;
  const vars = (activeEnv && environments[activeEnv]) || null;
  if (!vars) return str;
  return str.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m);
}
// Names still unresolved after substitution (for a gentle heads-up on send).
function unresolvedVars(strings) {
  const out = new Set();
  for (const s of strings) {
    if (typeof s !== "string") continue;
    const m = s.match(/\{\{\s*[\w.$-]+\s*\}\}/g);
    if (m) for (const t of m) out.add(t);
  }
  return [...out];
}

function updateEnvLabel() {
  els.envLabel.textContent = activeEnv || "No Env";
  els.envBtn.classList.toggle("env-on", !!activeEnv);
}

els.envBtn.addEventListener("click", () => {
  const willOpen = els.envPanel.hidden;
  closePanels();
  if (!willOpen) return;
  renderEnvPanel();
  els.envPanel.hidden = false;
});

function setActiveEnv(name) {
  activeEnv = environments[name] ? name : "";
  updateEnvLabel();
  persistEnvironments();
  renderEnvPanel();
  refreshUrlHighlight(); // known/unknown colouring depends on the active env
}

// Read the variable rows currently on screen back into the active environment.
function collectEnvVars() {
  if (!activeEnv) return;
  const vars = {};
  for (const row of els.envPanel.querySelectorAll(".env-var-row")) {
    const name = row.querySelector(".env-var-name").value.trim();
    if (name) vars[name] = row.querySelector(".env-var-val").value;
  }
  environments[activeEnv] = vars;
  persistEnvironments();
  updateReqTabIndicators(); // {{token}} in the auth box may now resolve/stop resolving
  refreshUrlHighlight();    // a URL {{var}} may have just become defined/undefined
}

function makeEnvVarRow(name = "", value = "") {
  const row = el("div", "env-var-row");
  const mk = (cls, ph, val) => {
    const inp = el("input", cls);
    inp.type = "text";
    inp.placeholder = ph;
    inp.spellcheck = false;
    inp.value = val;
    return inp;
  };
  const rm = el("button", "ep-remove", "✕");
  rm.type = "button";
  rm.title = "Remove variable";
  rm.addEventListener("click", () => { row.remove(); collectEnvVars(); ensureEnvTrailingRow(); });
  row.append(mk("env-var-name", "variable", name), mk("env-var-val", "value", value), rm);
  return row;
}
function ensureEnvTrailingRow() {
  const body = els.envPanel.querySelector(".env-vars");
  if (!body) return;
  const rows = [...body.querySelectorAll(".env-var-row")];
  const last = rows[rows.length - 1];
  if (!last || last.querySelector(".env-var-name").value !== "" || last.querySelector(".env-var-val").value !== "") {
    body.appendChild(makeEnvVarRow());
  }
}

function renderEnvPanel() {
  const panel = els.envPanel;
  panel.innerHTML = "";
  panel.appendChild(el("div", "pop-title", "Environments"));

  // Environment chooser: "No Environment" + each env, with rename/delete.
  const list = el("div", "env-list");
  const addEnvRow = (label, name) => {
    const active = activeEnv === name;
    const row = el("div", "env-row" + (active ? " active" : ""));
    row.append(el("span", "env-radio", active ? "●" : "○"), el("span", "env-name", label));
    if (name) {
      const ren = el("button", "tree-rename", "✎");
      ren.title = "Rename environment";
      ren.addEventListener("click", (e) => { e.stopPropagation(); renameEnv(name); });
      const del = el("button", "tree-del", "🗑");
      del.title = "Delete environment";
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteEnv(name); });
      row.append(ren, del);
    }
    row.addEventListener("click", () => setActiveEnv(name));
    list.appendChild(row);
  };
  addEnvRow("No Environment", "");
  for (const name of Object.keys(environments).sort()) addEnvRow(name, name);
  panel.appendChild(list);

  // New environment.
  const addWrap = el("div", "env-add");
  const input = el("input", "env-new");
  input.type = "text";
  input.placeholder = "New environment name";
  input.spellcheck = false;
  const addBtn = el("button", "linkbtn", "Create");
  const create = () => {
    const name = input.value.trim();
    if (!name) return;
    if (environments[name]) { flashEnc(`Environment “${name}” already exists.`, true); return; }
    environments[name] = {};
    activeEnv = name;
    updateEnvLabel();
    persistEnvironments();
    renderEnvPanel();
  };
  addBtn.addEventListener("click", create);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
  addWrap.append(input, addBtn);
  panel.appendChild(addWrap);

  // Variables editor for the active environment.
  panel.appendChild(el("div", "menu-sep"));
  if (!activeEnv) {
    panel.appendChild(el("div", "muted-block", "Select or create an environment to add {{variables}}."));
    return;
  }
  panel.appendChild(el("div", "env-vars-title muted", `Variables for “${activeEnv}” — reference as {{name}}`));
  const vars = el("div", "env-vars");
  const entries = Object.entries(environments[activeEnv] || {});
  for (const [k, v] of entries) vars.appendChild(makeEnvVarRow(k, v));
  vars.appendChild(makeEnvVarRow()); // trailing add row
  vars.addEventListener("input", () => { collectEnvVars(); ensureEnvTrailingRow(); });
  panel.appendChild(vars);
}

function renameEnv(name) {
  const next = (prompt("Rename environment:", name) || "").trim();
  if (!next || next === name) return;
  if (environments[next]) { flashEnc(`Environment “${next}” already exists.`, true); return; }
  environments[next] = environments[name];
  delete environments[name];
  if (activeEnv === name) activeEnv = next;
  updateEnvLabel();
  persistEnvironments();
  renderEnvPanel();
}
function deleteEnv(name) {
  delete environments[name];
  if (activeEnv === name) activeEnv = "";
  updateEnvLabel();
  persistEnvironments();
  renderEnvPanel();
}

/* ---- URL field: {{var}} colour highlight + autocomplete ---- */
// A backdrop <div> mirrors the URL text with {{name}} wrapped in coloured spans
// (blue when defined in the active env, red when not); the real input sits on top
// with transparent text so only its caret shows.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function highlightVarsHtml(text) {
  const vars = (activeEnv && environments[activeEnv]) || {};
  const re = /\{\{\s*([\w.$-]+)\s*\}\}/g;
  let out = "", last = 0, m;
  while ((m = re.exec(text))) {
    out += escapeHtml(text.slice(last, m.index));
    const known = Object.prototype.hasOwnProperty.call(vars, m[1]);
    out += `<span class="var-token${known ? "" : " unknown"}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}
function refreshUrlHighlight() {
  els.encUrlHl.innerHTML = highlightVarsHtml(els.encUrl.value);
  els.encUrlHl.scrollLeft = els.encUrl.scrollLeft;
}

// Autocomplete: while the caret sits just after an unclosed {{prefix, offer the
// active environment's matching variable names.
let suggestItems = [];
let suggestIndex = 0;
let suggestCtx = null;
function varPrefixAtCaret() {
  const caret = els.encUrl.selectionStart;
  if (caret == null) return null;
  const before = els.encUrl.value.slice(0, caret);
  const m = before.match(/\{\{\s*([\w.$-]*)$/);
  return m ? { prefix: m[1], start: caret - m[0].length, caret } : null;
}
function showVarSuggest() {
  const ctx = varPrefixAtCaret();
  const names = (activeEnv && environments[activeEnv]) ? Object.keys(environments[activeEnv]) : [];
  if (!ctx || !names.length) return hideVarSuggest();
  const matches = names.filter((n) => n.toLowerCase().startsWith(ctx.prefix.toLowerCase())).sort();
  if (!matches.length) return hideVarSuggest();
  suggestItems = matches;
  suggestIndex = 0;
  suggestCtx = ctx;
  renderVarSuggest();
  els.varSuggest.hidden = false;
}
function renderVarSuggest() {
  els.varSuggest.innerHTML = "";
  const vars = environments[activeEnv] || {};
  suggestItems.forEach((name, i) => {
    const it = el("div", "var-suggest-item" + (i === suggestIndex ? " active" : ""));
    it.append(el("span", "vs-name", `{{${name}}}`), el("span", "vs-val", String(vars[name] ?? "")));
    // mousedown (not click) so the input doesn't blur before we insert.
    it.addEventListener("mousedown", (e) => { e.preventDefault(); insertVar(name); });
    els.varSuggest.appendChild(it);
  });
}
function hideVarSuggest() { els.varSuggest.hidden = true; suggestItems = []; suggestCtx = null; }
function insertVar(name) {
  const ctx = suggestCtx || varPrefixAtCaret();
  if (!ctx) return hideVarSuggest();
  const insert = `{{${name}}}`;
  els.encUrl.value = els.encUrl.value.slice(0, ctx.start) + insert + els.encUrl.value.slice(ctx.caret);
  const pos = ctx.start + insert.length;
  els.encUrl.setSelectionRange(pos, pos);
  hideVarSuggest();
  renderParamsFromUrl(); // URL changed → rebuild the params table + highlight
  refreshUrlHighlight();
  checkDirty();
  els.encUrl.focus();
}
els.encUrl.addEventListener("input", () => { refreshUrlHighlight(); showVarSuggest(); });
els.encUrl.addEventListener("scroll", () => { els.encUrlHl.scrollLeft = els.encUrl.scrollLeft; });
els.encUrl.addEventListener("click", showVarSuggest);
els.encUrl.addEventListener("blur", () => setTimeout(hideVarSuggest, 120));
els.encUrl.addEventListener("keydown", (e) => {
  if (els.varSuggest.hidden || !suggestItems.length) return;
  if (e.key === "ArrowDown") { e.preventDefault(); suggestIndex = (suggestIndex + 1) % suggestItems.length; renderVarSuggest(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length; renderVarSuggest(); }
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertVar(suggestItems[suggestIndex]); }
  else if (e.key === "Escape") { e.preventDefault(); hideVarSuggest(); }
});

// The full request state a collection entry / history load round-trips through.
function snapshot() {
  return {
    url: els.encUrl.value,
    method: els.encMethod.value,
    body: els.encBody.value,
    token: els.encToken.value,
    authType: els.authType.value,
    headers: getHeaders(),
  };
}
function sameSnapshot(a, b) {
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}
// Load a saved/blank request into every field, tolerating pre-2.17 entries that
// only stored { url, body, token } (method/auth/headers are then derived).
function setReq(r) {
  r = r || {};
  els.encUrl.value = r.url || "";
  els.encBody.value = r.body || "";
  els.encToken.value = r.token || "";
  els.encMethod.value = VALID_METHODS.has(r.method) ? r.method : ((r.body || "").trim() ? "POST" : "GET");
  els.authType.value = r.authType || (r.token ? "bearer" : "none");
  setHeaders(r.headers || []);
  renderParamsFromUrl();
  syncAuthUi();
  updateReqTabIndicators();
}
const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
// Show 💾 Save only when a saved request is loaded AND has been modified.
function checkDirty() {
  els.saveReqBtn.hidden = !(currentRef && !sameSnapshot(snapshot(), currentSnapshot));
}
els.encUrl.addEventListener("input", checkDirty);

function closePanels() {
  els.addPanel.hidden = true;
  els.collectionPanel.hidden = true;
  els.historyPanel.hidden = true;
  els.backupMenu.hidden = true;
  els.envPanel.hidden = true;
  els.savedPanel.hidden = true;
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
  applyOpenBulk(); // fold any open Bulk Edit box back into the tables first
  const folder = els.addNewFolder.value.trim() || els.addFolder.value || "Default";
  if (!collections[folder]) collections[folder] = {};
  collections[folder][name] = withMeta(snapshot(), collections[folder][name]);
  persistCollections((err) => flashEnc(err ? `Save failed: ${err}` : `Saved “${name}” to “${folder}” ✓`, !!err));
  currentRef = { folder, name };
  currentSnapshot = snapshot();
  els.addPanel.hidden = true;
  checkDirty();
});

/* ---- 💾 Save: update the currently-loaded request in place ---- */
els.saveReqBtn.addEventListener("click", () => {
  if (!currentRef) return;
  applyOpenBulk();
  if (!collections[currentRef.folder]) collections[currentRef.folder] = {};
  collections[currentRef.folder][currentRef.name] = withMeta(snapshot(), collections[currentRef.folder][currentRef.name]);
  persistCollections((err) => flashEnc(err ? `Save failed: ${err}` : `Updated “${currentRef.name}” ✓`, !!err));
  currentSnapshot = snapshot();
  checkDirty();
});

/* ---- Saved-request metadata: favorite ★ / color / tags / note ---- */
// These live inside the collection entry alongside the request fields, so they
// persist in sync AND ride along in the backup file with no extra plumbing.
const REQ_COLORS = ["", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];

// Merge the request state with any existing metadata so a re-save (Add / 💾 Save)
// never wipes a request's favorite / color / tags / note.
function withMeta(reqState, prev) {
  const out = { ...reqState };
  if (prev) for (const k of ["fav", "color", "tags", "note"]) if (prev[k] != null) out[k] = prev[k];
  return out;
}
function reqAt(folder, name) { return collections[folder] && collections[folder][name]; }
function toggleFav(folder, name) {
  const r = reqAt(folder, name); if (!r) return;
  r.fav = !r.fav;
  persistCollections();
  renderCollectionTree();
}
function cycleColor(folder, name) {
  const r = reqAt(folder, name); if (!r) return;
  r.color = REQ_COLORS[(REQ_COLORS.indexOf(r.color || "") + 1) % REQ_COLORS.length];
  persistCollections();
  renderCollectionTree();
}
function editTags(folder, name) {
  const r = reqAt(folder, name); if (!r) return;
  const cur = (r.tags || []).join(", ");
  const next = prompt("Tags (comma-separated):", cur);
  if (next == null) return;
  r.tags = next.split(",").map((t) => t.trim()).filter(Boolean);
  persistCollections();
  renderCollectionTree();
}
function editNote(folder, name) {
  const r = reqAt(folder, name); if (!r) return;
  const next = prompt("Note:", r.note || "");
  if (next == null) return;
  r.note = next.trim();
  if (!r.note) delete r.note;
  persistCollections();
  renderCollectionTree();
}

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

    // Favorites float to the top of their folder, then alphabetical.
    const apis = Object.keys(collections[folder]).sort((a, b) => {
      const fa = collections[folder][a].fav ? 0 : 1, fb = collections[folder][b].fav ? 0 : 1;
      return fa - fb || a.localeCompare(b);
    });
    if (!apis.length) panel.appendChild(el("div", "tree-empty", "(empty)"));
    for (const name of apis) {
      const req = collections[folder][name];
      const aRow = el("div", "tree-api" + (currentRef && currentRef.folder === folder && currentRef.name === name ? " active" : ""));
      if (req.color) aRow.style.borderLeft = `3px solid ${req.color}`;
      if (req.note) aRow.title = req.note;

      const star = el("button", "tree-star" + (req.fav ? " on" : ""), req.fav ? "★" : "☆");
      star.title = req.fav ? "Unfavorite" : "Favorite";
      star.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(folder, name); });

      const swatch = el("button", "tree-swatch");
      swatch.style.background = req.color || "transparent";
      swatch.title = "Cycle colour";
      swatch.addEventListener("click", (e) => { e.stopPropagation(); cycleColor(folder, name); });

      aRow.append(star, swatch, el("span", "tree-ic", "•"), el("span", "tree-name", name));

      if (req.tags && req.tags.length) {
        const tags = el("span", "tree-tags");
        for (const t of req.tags) tags.appendChild(el("span", "tag-chip", t));
        aRow.appendChild(tags);
      }

      const aTag = el("button", "tree-rename", "🏷");
      aTag.title = "Edit tags";
      aTag.addEventListener("click", (e) => { e.stopPropagation(); editTags(folder, name); });
      const aNote = el("button", "tree-rename" + (req.note ? " has-note" : ""), "📝");
      aNote.title = req.note ? "Edit note" : "Add a note";
      aNote.addEventListener("click", (e) => { e.stopPropagation(); editNote(folder, name); });
      const aRen = el("button", "tree-rename", "✎");
      aRen.title = "Rename request";
      aRen.addEventListener("click", (e) => { e.stopPropagation(); renameApi(folder, name); });
      const aDel = el("button", "tree-del", "🗑");
      aDel.title = "Delete request";
      aDel.addEventListener("click", (e) => { e.stopPropagation(); delApi(folder, name); });
      aRow.append(aTag, aNote, aRen, aDel);
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

// 🗂 Saved responses: full response bodies the user explicitly kept, in
// chrome.storage.local (too big for sync). Newest-first.
let savedResponses = [];

// Persist one sent request (request + response summary, no response body —
// see services/storage.js) and mirror it into the in-memory list.
function saveHistoryEntry(histEntry) {
  addHistoryEntry(histEntry).then(({ ok, key }) => {
    if (!ok) return;
    history.unshift({ ...histEntry, _key: key });
    if (history.length > 100) history.length = 100;
    scheduleBackup();
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

  const envRes = await getEnvironments();
  environments = envRes.environments;
  activeEnv = environments[envRes.activeEnv] ? envRes.activeEnv : "";
  updateEnvLabel();

  savedResponses = await loadSavedResponses();

  // Fold the linked backup file in on top of the local stores — this is what
  // brings collections, history, environments AND saved responses back after a
  // remove/re-add, with no interaction beyond re-linking the file once.
  const res = await backup.pullOnLoad(collections, history, environments, savedResponses);
  if (res.pulled) {
    collections = res.collections;
    history = res.history;
    environments = res.environments;
    if (activeEnv && !environments[activeEnv]) activeEnv = "";
    savedResponses = res.savedResponses;
    updateEnvLabel();
  }
  renderOpenPanels();
  refreshBackupState();
}
function renderOpenPanels() {
  if (!els.historyPanel.hidden) renderHistoryPanel();
  if (!els.collectionPanel.hidden) renderCollectionTree();
  if (!els.envPanel.hidden) renderEnvPanel();
  if (!els.savedPanel.hidden) renderSavedPanel();
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
    scheduleBackup();
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
      scheduleBackup();
      renderHistoryPanel();
    });
    row.appendChild(del);
    row.addEventListener("click", () => {
      // History is a lightweight log (no saved headers), so load what it has.
      setReq({ url: h.url, method: h.method, body: h.body, token: h.token });
      currentRef = null; // loading history doesn't attach it to a saved collection entry
      currentSnapshot = null;
      checkDirty();
      closePanels();
      flashEnc("Loaded from history");
    });
    panel.appendChild(row);
  }
}

/* ---- 🗂 Saved responses: keep a full response body to revisit later ---- */
els.savedBtn.addEventListener("click", () => {
  const willOpen = els.savedPanel.hidden;
  closePanels();
  if (!willOpen) return;
  renderSavedPanel();
  els.savedPanel.hidden = false;
});

// Persist the currently-shown response (full body + the request that made it) to
// chrome.storage.local. The DECRYPTED text is deliberately not stored — only the
// raw body — so it's re-decrypted with the current key on view (PRD §24).
async function saveCurrentResponse(entry) {
  let path = entry.url;
  try { path = new URL(entry.url).pathname; } catch { /* relative URL — keep as-is */ }
  const name = (prompt("Save response as:", `${entry.method} ${path}`) || "").trim();
  if (!name) return;
  const saved = {
    id: "sr_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    name,
    method: entry.method,
    url: entry.url,
    reqBody: entry.reqBody || "",
    reqHeaders: entry.reqHeaders || {},
    status: entry.status,
    statusText: entry.statusText,
    timeMs: entry.timeMs,
    size: entry.size,
    body: entry.body,
    headers: entry.headers || [],
    at: (entry.at instanceof Date ? entry.at : new Date()).toISOString(),
  };
  const res = await addSavedResponse(saved);
  if (!res.ok) { flashEnc("Response is too large to save (over the ~4 MB budget).", true); return; }
  savedResponses = res.list;
  scheduleBackup();
  flashEnc(`Saved response “${name}” ✓${res.evicted ? ` — evicted ${res.evicted} oldest` : ""}`);
  if (!els.savedPanel.hidden) renderSavedPanel();
}

// Re-decrypt the stored raw body with the current key and show it in the viewer.
async function viewSavedResponse(saved) {
  const candidates = [saved.body, saved.body.trim(), stripQuotes(saved.body), safeDecode(saved.body)];
  const decRes = saved.body ? await CipherNetCrypto.tryDecryptAuto(candidates, state.key, state.iv) : null;
  const entry = { ...saved, decRes, at: new Date(saved.at), _savedId: saved.id };
  respTab = "body";
  renderResponseView(entry);
  closePanels();
  flashEnc(`Viewing saved “${saved.name}”`);
}

function renameSaved(saved) {
  const next = (prompt("Rename saved response:", saved.name) || "").trim();
  if (!next || next === saved.name) return;
  saved.name = next;
  updateSavedResponses(savedResponses);
  scheduleBackup();
  renderSavedPanel();
}
function deleteSaved(saved) {
  savedResponses = savedResponses.filter((s) => s !== saved);
  updateSavedResponses(savedResponses);
  scheduleBackup();
  renderSavedPanel();
}

function renderSavedPanel() {
  const panel = els.savedPanel;
  panel.innerHTML = "";
  const actions = el("div", "hist-actions");
  actions.appendChild(el("span", "muted", `Saved Responses (${savedResponses.length})`));
  panel.appendChild(actions);

  if (!savedResponses.length) {
    panel.appendChild(el("div", "muted-block", "No saved responses yet — send a request, then click 📌 Save on the response."));
    return;
  }
  for (const s of savedResponses) {
    const ok = s.status >= 200 && s.status < 400;
    const row = el("div", "hist-row");
    row.append(
      el("span", "rhist-method", s.method),
      el("span", "rhist-status " + (ok ? "ok" : "bad"), String(s.status || "—")),
      el("span", "rhist-url", s.name),
      el("span", "rhist-time", fmtSize(s.size))
    );
    const ren = el("button", "tree-rename", "✎");
    ren.title = "Rename";
    ren.addEventListener("click", (e) => { e.stopPropagation(); renameSaved(s); });
    const del = el("button", "tree-del", "🗑");
    del.title = "Delete saved response";
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteSaved(s); });
    row.append(ren, del);
    row.addEventListener("click", () => viewSavedResponse(s));
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
  const blob = new Blob([backup.serialize(collections, history, environments, savedResponses)], { type: "application/json" });
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
    environments = res.environments;
    if (activeEnv && !environments[activeEnv]) activeEnv = "";
    savedResponses = res.savedResponses;
    currentRef = null;
    currentSnapshot = null;
    updateEnvLabel();
    renderOpenPanels();
    checkDirty();
    flashEnc(`Restored ${res.requests} request(s) in ${res.folders} folder(s), ${res.history.length} history, ${Object.keys(res.environments).length} env(s), ${res.savedResponses.length} saved response(s) ✓`);
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
  setReq(r);
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
// One editable row: [enable] Key | Value | Description | [remove]. Shared by the
// Query Params and Request Headers tables (they differ only in what an edit does).
function makeKvRow(key, value, desc, enabled, onRemove) {
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
  rm.title = "Remove";
  rm.addEventListener("click", () => onRemove(row));
  actWrap.appendChild(rm);
  row.append(enWrap, mk("ep-key", "Key", key), mk("ep-value", "Value", value), mk("ep-desc", "Description", desc), actWrap);
  return row;
}
function makeParamRow(key = "", value = "", enabled = true) {
  return makeKvRow(key, value, "", enabled, (row) => { row.remove(); syncUrlFromParams(); });
}
function makeHeaderRow(key = "", value = "", enabled = true) {
  return makeKvRow(key, value, "", enabled, (row) => { row.remove(); onHeadersChanged(); });
}
// Keep one empty trailing row (Postman-style) so there's always somewhere to type.
function ensureTrailing(bodyEl, makeRow) {
  const rows = [...bodyEl.querySelectorAll(".ep-row")];
  const last = rows[rows.length - 1];
  if (!last) { bodyEl.appendChild(makeRow()); return; }
  const used = last.querySelector(".ep-key").value !== "" || last.querySelector(".ep-value").value !== "";
  if (used) bodyEl.appendChild(makeRow());
}

// Rebuild the params table from the URL's query (URL is the source of truth when
// the user edits the URL text directly).
function renderParamsFromUrl() {
  els.encParamsBody.innerHTML = "";
  for (const p of parseQueryPairs(urlBaseQuery(els.encUrl.value).query)) {
    els.encParamsBody.appendChild(makeParamRow(p.key, p.value, true));
  }
  els.encParamsBody.appendChild(makeParamRow()); // trailing "add" row
  updateReqTabIndicators();
  refreshUrlHighlight();
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
  ensureTrailing(els.encParamsBody, () => makeParamRow());
  checkDirty(); // editing params changes the URL → maybe mark the request dirty
  updateReqTabIndicators();
  refreshUrlHighlight();
}
els.encParamsBody.addEventListener("input", syncUrlFromParams);
els.encParamsBody.addEventListener("change", syncUrlFromParams);

/* ---- Request Headers table (Postman-style key/value editor) ---- */
// The enabled, keyed rows are merged into the outgoing request's headers.
function getHeaders() {
  return [...els.encHeadersBody.querySelectorAll(".ep-row")]
    .map((r) => ({
      key: r.querySelector(".ep-key").value,
      value: r.querySelector(".ep-value").value,
      enabled: r.querySelector(".ep-enable").checked,
    }))
    .filter((h) => h.key !== "" || h.value !== ""); // drop the empty trailing row
}
function setHeaders(list) {
  els.encHeadersBody.innerHTML = "";
  for (const h of list) els.encHeadersBody.appendChild(makeHeaderRow(h.key, h.value, h.enabled !== false));
  els.encHeadersBody.appendChild(makeHeaderRow()); // trailing "add" row
}
function onHeadersChanged() {
  ensureTrailing(els.encHeadersBody, () => makeHeaderRow());
  checkDirty();
  updateReqTabIndicators();
}
els.encHeadersBody.addEventListener("input", onHeadersChanged);
els.encHeadersBody.addEventListener("change", onHeadersChanged);

/* ---- Tab indicators: green dots / a header count, like Postman ---- */
function updateReqTabIndicators() {
  const setDot = (name, on) => {
    const d = els.reqTabs.querySelector(`[data-dot="${name}"]`);
    if (d) d.hidden = !on;
  };
  setDot("params", [...els.encParamsBody.querySelectorAll(".ep-row")]
    .some((r) => r.querySelector(".ep-enable").checked && r.querySelector(".ep-key").value.trim() !== ""));
  setDot("auth", els.authType.value === "bearer" && els.encToken.value.trim() !== "");
  setDot("body", els.encBody.value.trim() !== "");
  const n = getHeaders().filter((h) => h.enabled && h.key.trim() !== "").length;
  const cnt = els.reqTabs.querySelector('[data-count="headers"]');
  if (cnt) { cnt.hidden = n === 0; cnt.textContent = String(n); }
}

/* ---- Bulk Edit: swap either table for a key:value-per-line textarea ---- */
// A "//" prefix on a line marks it disabled — matching Postman's bulk editor.
function rowsToBulk(bodyEl) {
  return [...bodyEl.querySelectorAll(".ep-row")]
    .map((r) => ({ on: r.querySelector(".ep-enable").checked, key: r.querySelector(".ep-key").value, value: r.querySelector(".ep-value").value }))
    .filter((p) => p.key !== "" || p.value !== "")
    .map((p) => (p.on ? "" : "//") + p.key + ":" + p.value)
    .join("\n");
}
function bulkToRows(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (line === "") continue;
    let on = true;
    if (line.startsWith("//")) { on = false; line = line.slice(2).trim(); }
    const i = line.indexOf(":");
    const key = (i === -1 ? line : line.slice(0, i)).trim();
    const value = (i === -1 ? "" : line.slice(i + 1)).trim();
    if (key === "" && value === "") continue;
    out.push({ key, value, on });
  }
  return out;
}
function toggleBulk(name, btn) {
  const isParams = name === "params";
  const grid = isParams ? els.encParams : els.encHeaders;
  const area = isParams ? els.paramsBulk : els.headersBulk;
  const bodyEl = isParams ? els.encParamsBody : els.encHeadersBody;
  const makeRow = isParams
    ? (r) => makeParamRow(r ? r.key : "", r ? r.value : "", r ? r.on : true)
    : (r) => makeHeaderRow(r ? r.key : "", r ? r.value : "", r ? r.on : true);
  if (area.hidden) {
    area.value = rowsToBulk(bodyEl);
    grid.hidden = true;
    area.hidden = false;
    btn.textContent = "Key-Value Edit";
  } else {
    bodyEl.innerHTML = "";
    for (const r of bulkToRows(area.value)) bodyEl.appendChild(makeRow(r));
    bodyEl.appendChild(makeRow());
    area.hidden = true;
    grid.hidden = false;
    btn.textContent = "Bulk Edit";
    if (isParams) syncUrlFromParams(); else onHeadersChanged();
  }
}
// Fold any open Bulk Edit box back into its table (called before send/save so the
// tables — the source of truth — reflect what's on screen).
function applyOpenBulk() {
  for (const btn of els.reqPanels.querySelectorAll(".bulk-toggle")) {
    const area = btn.dataset.bulk === "params" ? els.paramsBulk : els.headersBulk;
    if (!area.hidden) toggleBulk(btn.dataset.bulk, btn);
  }
}

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
// The chosen HTTP method, custom Headers and Bearer Token are all applied as-is.
async function sendRequest(mode) {
  applyOpenBulk(); // fold any open Bulk Edit box back into the tables first
  // Substitute {{env vars}} first (the editors keep the {{name}} literal).
  const rawUrl = resolveVars(els.encUrl.value).trim();
  const rawBody = resolveVars(els.encBody.value);
  const token = resolveVars(els.encToken.value).trim();
  const method = els.encMethod.value;
  els.encResponse.hidden = true;
  els.encResponse.innerHTML = "";

  if (!rawUrl) { flashEnc("Enter a URL to send.", true); return; }

  // GET/HEAD requests can't carry a body (fetch throws), so drop it there.
  const methodAllowsBody = method !== "GET" && method !== "HEAD";
  const { base, query } = splitUrlForEncrypt(rawUrl);
  const willEncryptQuery = base != null && query.trim() !== "";
  const willSendBody = methodAllowsBody && rawBody.trim() !== "";
  if (mode === "encrypt" && (willEncryptQuery || willSendBody) && !state.key) {
    flashEnc("Set the AES key in 🔑 Key first.", true);
    return;
  }

  let url = rawUrl;
  let body = rawBody;
  try {
    if (mode === "encrypt") {
      if (willEncryptQuery) url = base + "?" + (await CipherNetCrypto.encrypt(query, state.key, state.iv));
      if (willSendBody) body = await CipherNetCrypto.encrypt(rawBody, state.key, state.iv);
    }
  } catch (e) {
    flashEnc(e.message || "Encryption failed.", true);
    return;
  }

  // Custom headers first, then auth + Content-Type (unless the user set their own).
  const headers = {};
  for (const h of getHeaders()) if (h.enabled && h.key.trim() !== "") headers[resolveVars(h.key).trim()] = resolveVars(h.value);
  if (els.authType.value === "bearer" && token) {
    headers["Authorization"] = /^bearer\s/i.test(token) ? token : "Bearer " + token;
  }
  if (willSendBody && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  flashEnc("Sending…");
  const started = performance.now();
  try {
    const resp = await fetch(url, { method, headers, body: willSendBody ? body : undefined });
    const text = await resp.text();
    // Decrypt the response body up front (auto-lenient on failure) so switching
    // response tabs / history is instant.
    const candidates = [text, text.trim(), stripQuotes(text), safeDecode(text)];
    const decRes = text ? await CipherNetCrypto.tryDecryptAuto(candidates, state.key, state.iv) : null;
    const entry = {
      method, url,
      // What was actually sent (encrypted, when Send Encrypted) — for the Copy menu.
      reqBody: willSendBody ? body : "",
      reqHeaders: headers,
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
    // Heads-up if any {{vars}} weren't defined in the active environment.
    const missing = unresolvedVars([rawUrl, rawBody, token, ...Object.keys(headers), ...Object.values(headers)]);
    flashEnc(missing.length ? `Sent — unresolved ${missing.join(" ")} (no ${activeEnv ? "such var" : "environment"})` : "");
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
  meta.appendChild(respActions(entry)); // 📌 Save (unless already saved) + 📋 Copy
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

/* ---- 📋 Copy: grab what was actually sent (encrypted, on Send Encrypted) ---- */
function reqHeadersToText(h) {
  h = h || {};
  return Object.keys(h).map((k) => `${k}: ${h[k]}`).join("\n");
}
function curlText(entry) {
  const parts = [`curl -X ${entry.method} '${entry.url}'`];
  const h = entry.reqHeaders || {};
  for (const k of Object.keys(h)) parts.push(`-H '${k}: ${h[k]}'`);
  if (entry.reqBody) parts.push(`--data '${entry.reqBody}'`);
  return parts.join(" \\\n  ");
}
// Right-aligned action cluster on the response meta line: 📌 Save (unless the
// response is already a saved one) + the 📋 Copy dropdown.
function respActions(entry) {
  const wrap = el("div", "resp-actions");
  if (!entry._savedId) {
    const save = el("button", "resp-copy resp-save", "📌 Save");
    save.type = "button";
    save.title = "Save this response (full body) to disk to revisit later";
    save.addEventListener("click", (e) => { e.stopPropagation(); saveCurrentResponse(entry); });
    wrap.appendChild(save);
  } else {
    wrap.appendChild(el("span", "resp-saved-tag", "🗂 saved"));
  }
  wrap.appendChild(respCopyControl(entry));
  return wrap;
}

// A "📋 Copy ▾" dropdown for the response meta line: URL / Body / Headers / cURL /
// Response. Each item copies the sent request (encrypted when Send Encrypted was used).
function respCopyControl(entry) {
  const wrap = el("div", "menu-wrap resp-copy-wrap");
  const btn = el("button", "resp-copy", "📋 Copy ▾");
  btn.type = "button";
  btn.title = "Copy the sent request (encrypted, when Send Encrypted)";
  const menu = el("div", "menu resp-copy-menu");
  menu.hidden = true;
  const items = [
    ["URL", () => entry.url],
    ["Body", () => entry.reqBody],
    ["Headers", () => reqHeadersToText(entry.reqHeaders)],
    ["as cURL", () => curlText(entry)],
    ["Response", () => entry.body],
  ];
  for (const [label, get] of items) {
    const item = el("button", null, "Copy " + label);
    item.type = "button";
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = true;
      const text = get() || "";
      if (!text) { flashEnc(`Nothing to copy for ${label}.`, true); return; }
      navigator.clipboard.writeText(text)
        .then(() => flashEnc(`Copied ${label} ✓`))
        .catch(() => flashEnc("Copy failed.", true));
    });
    menu.appendChild(item);
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    els.encResponse.querySelectorAll(".resp-copy-menu").forEach((m) => { if (m !== menu) m.hidden = true; });
    menu.hidden = !menu.hidden;
  });
  wrap.append(btn, menu);
  return wrap;
}
// Close any open Copy menu when clicking elsewhere.
document.addEventListener("click", (e) => {
  if (e.target.closest && e.target.closest(".resp-copy-wrap")) return;
  els.encResponse.querySelectorAll(".resp-copy-menu").forEach((m) => (m.hidden = true));
});

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

/* --------------------------- initialise the tester --------------------------- */
// Seed both tables' trailing rows / the auth UI so the panel is ready before
// it's ever opened.
setReq({});
