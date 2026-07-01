// panel.js — a Network-tab-style panel: request list + Headers / Payload / Response
// sub-tabs, with the CipherNet encrypted bodies decrypted in place.

// No key is baked in — enter it in the 🔑 Key box (persisted via chrome.storage).
const DEFAULT_KEY = "";
const DEFAULT_IV = "";

const state = {
  key: DEFAULT_KEY,
  iv: DEFAULT_IV,
  filter: "",
  filterTerms: [],
  onlyEncrypted: false,
  // §ImageRequest — Chrome-style resource-type pills + "More filters" toggles.
  typeFilters: new Set(), // selected pill ids; empty == "All"
  moreFilters: { hideData: false, hideExt: false, blockedCookies: false, blockedReq: false, thirdParty: false },
  pageHost: "",
  paused: false,
  entries: [],
  byId: new Map(),
  selectedId: null,
  activeTab: "headers",
  nextId: 1,
  search: {
    active: false,
    regex: null,
    ids: [],          // ordered ids of matching entries (for prev/next)
    matchIds: null,   // Set of matching ids, or null when no search
    total: 0,
    idx: 0,
    opts: { regex: false, caseSensitive: false, wholeWord: false },
  },
  // §26 layout (persisted): list-pane width + per-column order/widths/visibility.
  layout: { listWidth: 0 },
  columns: { order: [], widths: {}, visible: {} },
  sort: { col: null, dir: 0 }, // dir: 1 asc, -1 desc, 0 none (capture order)
  // §27 network controls (persisted).
  preserveLog: false,
  disableCache: false,
  throttle: "none",
};

const DEFAULT_LIST_WIDTH = 320;

/* -------------------------------- theme -------------------------------- */
// Follow the host theme: dark when DevTools (or the browser) is dark, light
// otherwise. CSS defaults to dark; we only flip <html data-theme> for light.
function setTheme(name) {
  document.documentElement.setAttribute("data-theme", name === "dark" ? "dark" : "light");
}

function detectTheme() {
  // chrome.devtools.panels.themeName ("dark" | "default") is the authoritative
  // DevTools theme; fall back to the OS/browser preference when unavailable.
  const t = chrome.devtools && chrome.devtools.panels && chrome.devtools.panels.themeName;
  if (t === "dark") return "dark";
  if (t === "default") return "light";
  if (window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

function initTheme() {
  setTheme(detectTheme());
  // Live-update when the user flips the DevTools/browser theme — no reload.
  // (themeName isn't re-read on change, so trust the media query here.)
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setTheme(e.matches ? "dark" : "light");
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange); // older Chrome
  }
}

// Run immediately (before the rest of the panel paints) to avoid a theme flash.
initTheme();

const els = {
  reqBody: document.getElementById("reqBody"),
  empty: document.getElementById("empty"),
  count: document.getElementById("count"),
  main: document.getElementById("main"),
  filter: document.getElementById("filter"),
  onlyApi: document.getElementById("onlyApi"),
  clearBtn: document.getElementById("clearBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  keysToggle: document.getElementById("keysToggle"),
  keysRow: document.getElementById("keysRow"),
  keyInput: document.getElementById("keyInput"),
  ivInput: document.getElementById("ivInput"),
  saveKey: document.getElementById("saveKey"),
  resetKey: document.getElementById("resetKey"),
  keyStatus: document.getElementById("keyStatus"),
  // encrypt-url tool
  encryptToggle: document.getElementById("encryptToggle"),
  encryptRow: document.getElementById("encryptRow"),
  encUrl: document.getElementById("encUrl"),
  encBody: document.getElementById("encBody"),
  encryptBtn: document.getElementById("encryptBtn"),
  encryptClear: document.getElementById("encryptClear"),
  encStatus: document.getElementById("encStatus"),
  encOutput: document.getElementById("encOutput"),
  detailPane: document.getElementById("detailPane"),
  detailTabs: document.getElementById("detailTabs"),
  detailContent: document.getElementById("detailContent"),
  closeDetail: document.getElementById("closeDetail"),
  // search
  searchToggle: document.getElementById("searchToggle"),
  searchRow: document.getElementById("searchRow"),
  searchInput: document.getElementById("searchInput"),
  searchPrev: document.getElementById("searchPrev"),
  searchNext: document.getElementById("searchNext"),
  searchClose: document.getElementById("searchClose"),
  searchStatus: document.getElementById("searchStatus"),
  optRegex: document.getElementById("optRegex"),
  optCase: document.getElementById("optCase"),
  optWord: document.getElementById("optWord"),
  // export
  exportBtn: document.getElementById("exportBtn"),
  exportMenu: document.getElementById("exportMenu"),
  // §26 layout
  listPane: document.getElementById("listPane"),
  splitter: document.getElementById("splitter"),
  reqTable: document.getElementById("reqTable"),
  reqCols: document.getElementById("reqCols"),
  reqHead: document.getElementById("reqHead"),
  // §27 network controls
  preserveLog: document.getElementById("preserveLog"),
  disableCache: document.getElementById("disableCache"),
  throttle: document.getElementById("throttle"),
  throttleNote: document.getElementById("throttleNote"),
  // resource-type filters + "more filters"
  filtersRow: document.getElementById("filtersRow"),
  typeFiltersBar: document.getElementById("typeFilters"),
  moreFiltersBtn: document.getElementById("moreFiltersBtn"),
  moreFiltersMenu: document.getElementById("moreFiltersMenu"),
};

/* ------------------------------ settings ------------------------------ */
function loadSettings() {
  chrome.storage.local.get(
    ["key", "iv", "columns", "layout", "sort", "preserveLog", "disableCache", "throttle", "typeFilters", "moreFilters"],
    (saved) => {
      state.key = saved.key || DEFAULT_KEY;
      state.iv = saved.iv || DEFAULT_IV;
      els.keyInput.value = state.key;
      els.ivInput.value = state.iv;
      // Nudge the user to set a key on first run (nothing is baked in).
      if (!state.key) els.keysRow.classList.add("open");

      // §26 layout
      state.columns = normalizeColumns(saved.columns);
      state.layout = saved.layout && saved.layout.listWidth ? saved.layout : { listWidth: DEFAULT_LIST_WIDTH };
      if (saved.sort && COLUMN_MAP[saved.sort.col]) state.sort = saved.sort;
      rebuildTable();

      // §27 network controls
      state.preserveLog = !!saved.preserveLog;
      state.disableCache = !!saved.disableCache;
      state.throttle = saved.throttle || "none";
      els.preserveLog.checked = state.preserveLog;
      els.disableCache.checked = state.disableCache;
      els.throttle.value = state.throttle;
      applyThrottleNote();
      applyDisableCache();
      applyThrottle();

      // resource-type + more filters
      state.typeFilters = new Set(Array.isArray(saved.typeFilters) ? saved.typeFilters : []);
      Object.assign(state.moreFilters, saved.moreFilters || {});
      renderTypePills();
      syncMoreFilterChecks();
      updateMoreFiltersBtn();
      applyFilter();
    }
  );
}
els.saveKey.addEventListener("click", () => {
  state.key = els.keyInput.value || DEFAULT_KEY;
  state.iv = els.ivInput.value || DEFAULT_IV;
  chrome.storage.local.set({ key: state.key, iv: state.iv }, () => flashKey("Saved ✓"));
  onKeyChanged();
});
els.resetKey.addEventListener("click", () => {
  state.key = DEFAULT_KEY;
  state.iv = DEFAULT_IV;
  els.keyInput.value = DEFAULT_KEY;
  els.ivInput.value = DEFAULT_IV;
  chrome.storage.local.set({ key: state.key, iv: state.iv }, () => flashKey("Cleared ✓"));
  els.keysRow.classList.add("open");
  onKeyChanged();
});

// Decryption results depend on the key, so drop derived caches when it changes.
function onKeyChanged() {
  for (const e of state.entries) { e._searchReady = false; e.decrypted = false; }
  if (state.search.active) runSearch();
  if (state.selectedId != null) renderDetail();
}
function flashKey(msg) {
  els.keyStatus.textContent = msg;
  setTimeout(() => (els.keyStatus.textContent = ""), 1500);
}
els.keysToggle.addEventListener("click", () => els.keysRow.classList.toggle("open"));

/* --------------------------- encrypt-url tool -------------------------- */
// Encrypt a plaintext URL/payload with the saved key the same way the CipherNet
// backend does (AES-128-CBC -> Base64), so the output round-trips with the
// decrypt path. The URL's query string is what gets encrypted; a bare value
// (no "?") is encrypted whole.
els.encryptToggle.addEventListener("click", () => {
  const open = els.encryptRow.classList.toggle("open");
  // Focus the encryptor: hide the network request list / detail view and the
  // resource-type filter row while the Encrypt URL tool is open, and restore
  // them when the tool is toggled off.
  els.main.hidden = open;
  els.filtersRow.hidden = open;
  els.encryptToggle.classList.toggle("active", open);
});
els.encryptBtn.addEventListener("click", runEncrypt);
els.encUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runEncrypt(); }
});
els.encryptClear.addEventListener("click", () => {
  els.encUrl.value = "";
  els.encBody.value = "";
  els.encOutput.hidden = true;
  els.encOutput.innerHTML = "";
  flashEnc("");
});

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

  flashEnc("Encrypting…");
  try {
    const out = el("div");
    if (url) {
      const { base, query } = splitUrlForEncrypt(url);
      const cipher = await CipherNetCrypto.encrypt(query, state.key, state.iv);
      if (base != null) {
        out.appendChild(encOutRow("Encrypted URL", base + "?" + cipher));
        out.appendChild(encOutRow("Encrypted query", cipher));
      } else {
        out.appendChild(encOutRow("Encrypted", cipher));
      }
    }
    if (body.trim()) {
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

/* ------------------------------ toolbar ------------------------------- */
els.filter.addEventListener("input", () => {
  state.filter = els.filter.value.trim();
  state.filterTerms = parseFilter(state.filter);
  applyFilter();
});
els.onlyApi.addEventListener("change", () => {
  state.onlyEncrypted = els.onlyApi.checked;
  applyFilter();
});
function clearRequests() {
  state.entries = [];
  state.byId.clear();
  els.reqBody.innerHTML = "";
  state.search.ids = [];
  state.search.matchIds = null;
  state.search.total = 0;
  if (state.search.active) els.searchStatus.textContent = "";
  closeDetail();
  updateCount();
}
els.clearBtn.addEventListener("click", clearRequests);
els.pauseBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  els.pauseBtn.classList.toggle("recording", !state.paused);
  els.pauseBtn.title = state.paused ? "Resume capturing" : "Stop capturing";
});
els.closeDetail.addEventListener("click", closeDetail);

els.detailTabs.querySelectorAll(".dtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.activeTab = btn.dataset.tab;
    els.detailTabs.querySelectorAll(".dtab").forEach((b) => b.classList.toggle("active", b === btn));
    renderDetail();
  });
});

/* ------------------------------- search ------------------------------- */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function openSearch() {
  state.search.active = true;
  els.searchRow.classList.add("open");
  els.searchInput.focus();
  els.searchInput.select();
  if (els.searchInput.value) runSearch();
}
function closeSearch() {
  state.search.active = false;
  els.searchRow.classList.remove("open");
  state.search.regex = null;
  state.search.matchIds = null;
  state.search.ids = [];
  state.search.total = 0;
  els.searchStatus.textContent = "";
  applyFilter();
  if (state.selectedId != null) renderDetail();
}

function buildMatcher(query, opts) {
  if (!query) return null;
  let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.wholeWord) src = `\\b(?:${src})\\b`;
  try { return new RegExp(src, "g" + (opts.caseSensitive ? "" : "i")); }
  catch { return null; }
}

// Build (or reuse) a searchable text blob per entry, including decrypted bodies.
async function ensureSearchable(entry) {
  if (entry._searchReady) return;
  const parts = [entry.url, entry.method, String(entry.status), entry.statusText, entry.mime];
  for (const h of entry.reqHeaders) parts.push(h.name, h.value);
  for (const h of entry.respHeaders) parts.push(h.name, h.value);
  for (const c of cookiesOf(entry, "request")) parts.push(c.name, c.value);
  for (const c of cookiesOf(entry, "response")) parts.push(c.name, c.value);
  const d = await gatherDecrypted(entry);
  parts.push(d.query, d.payload, d.response, d.queryDecrypted, d.payloadDecrypted, d.responseDecrypted);
  entry._searchText = parts.filter(Boolean).join("\n");
  entry._searchReady = true;
}

let searchSeq = 0;
async function runSearch() {
  const opts = state.search.opts;
  const query = els.searchInput.value;
  const re = buildMatcher(query, opts);
  state.search.regex = re;
  if (!re) {
    state.search.matchIds = null;
    state.search.ids = [];
    state.search.total = 0;
    els.searchStatus.textContent = query ? "invalid regex" : "";
    applyFilter();
    if (state.selectedId != null) renderDetail();
    return;
  }
  const seq = ++searchSeq;
  els.searchStatus.textContent = "searching…";
  const snapshot = state.entries.slice();
  await Promise.all(snapshot.map(ensureSearchable));
  if (seq !== searchSeq) return; // superseded by a newer keystroke

  const ids = [];
  const set = new Set();
  let total = 0;
  for (const e of snapshot) {
    re.lastIndex = 0;
    const m = e._searchText.match(re);
    if (m && m.length) { ids.push(e.id); set.add(e.id); total += m.length; }
  }
  state.search.ids = ids;
  state.search.matchIds = set;
  state.search.total = total;
  state.search.idx = Math.min(state.search.idx, Math.max(0, ids.length - 1));
  applyFilter();
  els.searchStatus.textContent = total
    ? `${total} match${total === 1 ? "" : "es"} in ${ids.length} request${ids.length === 1 ? "" : "s"}`
    : "no matches";
  if (state.selectedId != null) renderDetail();
}
const searchDebounced = debounce(runSearch, 200);

function navSearch(dir) {
  const ids = state.search.ids;
  if (!ids.length) return;
  state.search.idx = (state.search.idx + dir + ids.length) % ids.length;
  const id = ids[state.search.idx];
  selectEntry(id);
  const e = state.byId.get(id);
  if (e && e.row) e.row.scrollIntoView({ block: "nearest" });
}

// Wrap search matches in <mark> inside the open detail pane.
function highlightDetail() {
  const re = state.search.regex;
  if (!re) return;
  const walker = document.createTreeWalker(els.detailContent, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const tag = node.parentNode && node.parentNode.nodeName;
      if (tag === "MARK" || tag === "BUTTON") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    const text = node.nodeValue;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.className = "hl";
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0] === "") re.lastIndex++; // guard against zero-length matches
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}
function maybeHighlight() {
  if (state.search.active && state.search.regex) highlightDetail();
}

els.searchToggle.addEventListener("click", () => {
  if (els.searchRow.classList.contains("open")) closeSearch();
  else openSearch();
});
els.searchClose.addEventListener("click", closeSearch);
els.searchInput.addEventListener("input", searchDebounced);
els.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); navSearch(e.shiftKey ? -1 : 1); }
  else if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
});
els.searchPrev.addEventListener("click", () => navSearch(-1));
els.searchNext.addEventListener("click", () => navSearch(1));
[[els.optRegex, "regex"], [els.optCase, "caseSensitive"], [els.optWord, "wholeWord"]].forEach(
  ([cb, opt]) => cb.addEventListener("change", () => { state.search.opts[opt] = cb.checked; runSearch(); })
);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    openSearch();
  }
});

/* ------------------------------- export ------------------------------- */
// Export whatever is currently shown (after filter/search); if nothing is
// filtered, that's the whole capture.
function exportList() {
  const vis = state.entries.filter((e) => e.row && e.row.style.display !== "none");
  return vis.length ? vis : state.entries;
}
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function tsName(ext) {
  const d = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `ciphernet-${d}.${ext}`;
}
function flashExport(msg) {
  els.exportBtn.textContent = msg ? "⬇ " + msg : "⬇ Export ▾";
}

function exportHar() {
  const har = {
    log: {
      version: "1.2",
      creator: { name: "CipherNet", version: "1.0.0" },
      entries: exportList().map((e) => e.har),
    },
  };
  download(tsName("har"), JSON.stringify(har, null, 2), "application/json");
}
function exportJson() {
  const data = exportList().map((e) => ({
    url: e.url,
    method: e.method,
    status: e.status,
    statusText: e.statusText,
    type: typeOf(e.mime),
    mimeType: e.mime,
    size: e.size,
    timeMs: e.time,
    remoteAddress: e.serverIP,
    encrypted: e.maybeEncrypted,
    requestHeaders: e.reqHeaders,
    responseHeaders: e.respHeaders,
  }));
  download(tsName("json"), JSON.stringify(data, null, 2), "application/json");
}
function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCsv() {
  const rows = [["Name", "Method", "Status", "Type", "Size", "Time(ms)", "Encrypted", "URL"]];
  for (const e of exportList())
    rows.push([nameOf(e.url), e.method, e.status, typeOf(e.mime), e.size, Math.round(e.time), e.maybeEncrypted, e.url]);
  download(tsName("csv"), rows.map((r) => r.map(csvCell).join(",")).join("\r\n"), "text/csv");
}
async function exportDecrypted() {
  flashExport("decrypting…");
  try {
    const out = [];
    for (const e of exportList()) {
      const d = await gatherDecrypted(e);
      out.push({
        url: e.url,
        method: e.method,
        status: e.status,
        mimeType: e.mime,
        requestHeaders: e.reqHeaders,
        responseHeaders: e.respHeaders,
        query: { raw: d.query, decrypted: d.queryDecrypted },
        requestBody: { raw: d.payload, decrypted: d.payloadDecrypted },
        response: { raw: d.response, decrypted: d.responseDecrypted },
      });
    }
    const session = { tool: "CipherNet", version: "1.0.0", exportedAt: new Date().toISOString(), entries: out };
    download(tsName("decrypted.json"), JSON.stringify(session, null, 2), "application/json");
  } finally {
    flashExport("");
  }
}

els.exportBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.exportMenu.hidden = !els.exportMenu.hidden;
});
els.exportMenu.addEventListener("click", (e) => e.stopPropagation());
els.exportMenu.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    els.exportMenu.hidden = true;
    if (!state.entries.length) { flashExport("nothing to export"); setTimeout(() => flashExport(""), 1200); return; }
    const fmt = b.dataset.fmt;
    if (fmt === "har") exportHar();
    else if (fmt === "json") exportJson();
    else if (fmt === "csv") exportCsv();
    else if (fmt === "decrypted") exportDecrypted();
  });
});
document.addEventListener("click", () => { els.exportMenu.hidden = true; });

function updateCount() {
  const n = state.entries.length;
  els.count.textContent = `${n} request${n === 1 ? "" : "s"}`;
  els.empty.style.display = n ? "none" : "block";
}

/* ----------------------------- filter engine -------------------------- */
// Recognized `key:value` filters (PRD §5). Anything else is a plain
// substring match against the URL. A leading `-` negates a term.
const FILTER_KEYS = new Set([
  "method", "status-code", "status", "domain", "host", "scheme", "protocol",
  "mime-type", "mimetype", "larger-than", "smaller-than", "has-response-header",
  "has-request-header", "is", "encrypted", "decrypted", "api", "tag", "hash",
]);

function parseFilter(text) {
  if (!text) return [];
  const terms = [];
  // Split on whitespace but keep quoted phrases together.
  const tokens = text.match(/"[^"]*"|\S+/g) || [];
  for (let tok of tokens) {
    let negate = false;
    if (tok[0] === "-") { negate = true; tok = tok.slice(1); }
    tok = tok.replace(/^"|"$/g, "");
    if (!tok) continue;
    const ci = tok.indexOf(":");
    if (ci > 0) {
      const key = tok.slice(0, ci).toLowerCase();
      if (FILTER_KEYS.has(key)) {
        terms.push({ negate, key, value: tok.slice(ci + 1) });
        continue;
      }
    }
    terms.push({ negate, key: "text", value: tok });
  }
  return terms;
}

// Parse sizes like "100k", "1.5m", "2g", "512" -> bytes.
function parseSize(s) {
  const m = /^([\d.]+)\s*([kmg]?)b?$/i.exec(String(s).trim());
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const mult = { "": 1, k: 1024, m: 1048576, g: 1073741824 }[m[2].toLowerCase()];
  return n * mult;
}

function headerNames(headers) {
  return (headers || []).map((h) => (h.name || "").toLowerCase());
}

function matchTerm(entry, term) {
  const v = term.value.toLowerCase();
  switch (term.key) {
    case "text":
      return entry.url.toLowerCase().includes(v);
    case "method":
      return entry.method.toLowerCase() === v;
    case "status-code":
    case "status":
      return String(entry.status) === term.value;
    case "domain":
    case "host":
      return (hostOf(entry.url) || "").toLowerCase().includes(v);
    case "scheme":
      return (schemeOf(entry.url) || "").toLowerCase() === v;
    case "protocol":
      return (entry.har.response.httpVersion || "").toLowerCase().includes(v);
    case "mime-type":
    case "mimetype":
      return (entry.mime || "").toLowerCase().includes(v);
    case "larger-than": {
      const n = parseSize(term.value);
      return !isNaN(n) && entry.size >= n;
    }
    case "smaller-than": {
      const n = parseSize(term.value);
      return !isNaN(n) && entry.size >= 0 && entry.size <= n;
    }
    case "has-response-header":
      return term.value ? headerNames(entry.respHeaders).includes(v) : entry.respHeaders.length > 0;
    case "has-request-header":
      return term.value ? headerNames(entry.reqHeaders).includes(v) : entry.reqHeaders.length > 0;
    case "is":
      if (v === "running") return !entry.status; // 0 / pending
      if (v === "from-cache") return isFromCache(entry);
      return false;
    case "encrypted":
      return entry.maybeEncrypted === (v !== "false");
    case "decrypted":
      return !!entry.decrypted === (v !== "false");
    case "api":
      return nameOf(entry.url).toLowerCase().includes(v);
    case "tag":
      return (entry.tags || []).some((t) => t.toLowerCase().includes(v));
    case "hash":
      return [entry.reqHash, entry.respHash].some((h) => h && h.toLowerCase().includes(v));
    default:
      return true;
  }
}

function matchesFilter(entry) {
  for (const term of state.filterTerms) {
    const hit = matchTerm(entry, term);
    if (term.negate ? hit : !hit) return false;
  }
  return true;
}

function isFromCache(entry) {
  if (entry.har._fromCache) return true; // Chrome marks cached entries ("memory"/"disk")
  const ts = entry.har.response && entry.har.response._transferSize;
  return ts === 0 && entry.status > 0;
}

function applyFilter() {
  let shown = 0;
  for (const entry of state.entries) {
    if (!entry.row) continue;
    const hide = rowHidden(entry); // single predicate (filter + type pills + more + search)
    entry.row.style.display = hide ? "none" : "";
    if (!hide) shown++;
  }
  return shown;
}

/* ---------------------- resource-type + more filters ------------------ */
// Chrome's resource-type pills. Each maps to one or more Chrome _resourceType
// values; "other" is the catch-all.
const TYPE_FILTERS = [
  { id: "all", label: "All" },
  { id: "fetch", label: "Fetch/XHR" },
  { id: "doc", label: "Doc" },
  { id: "css", label: "CSS" },
  { id: "js", label: "JS" },
  { id: "font", label: "Font" },
  { id: "img", label: "Img" },
  { id: "media", label: "Media" },
  { id: "manifest", label: "Manifest" },
  { id: "socket", label: "Socket" },
  { id: "wasm", label: "Wasm" },
  { id: "other", label: "Other" },
];
const RESOURCE_TYPE_TO_PILL = {
  fetch: "fetch", xhr: "fetch",
  document: "doc",
  stylesheet: "css",
  script: "js",
  font: "font",
  image: "img",
  media: "media",
  manifest: "manifest",
  websocket: "socket",
  wasm: "wasm",
};
function resourceTypeOf(entry) {
  const rt = ((entry.har && entry.har._resourceType) || "").toLowerCase();
  if (rt) return rt;
  // Fallback from MIME when Chrome didn't tag the resource type.
  const t = typeOf(entry.mime);
  if (t === "document") return "document";
  if (t === "script") return "script";
  if (t === "stylesheet") return "stylesheet";
  if (t === "json") return "fetch";
  if (["png", "jpeg", "jpg", "gif", "webp", "svg+xml", "x-icon", "bmp", "avif"].includes(t)) return "image";
  return "other";
}
function pillOf(entry) {
  return RESOURCE_TYPE_TO_PILL[resourceTypeOf(entry)] || "other";
}
// Type-column label, Chrome-style: fetch/xhr/document/script/… by resource type,
// but the concrete subtype (png, woff2, …) for images/fonts/media.
function typeLabel(entry) {
  const rt = resourceTypeOf(entry);
  switch (rt) {
    case "xhr": return "xhr";
    case "fetch": return "fetch";
    case "document": return "document";
    case "stylesheet": return "stylesheet";
    case "script": return "script";
    case "websocket": return "websocket";
    case "eventsource": return "eventsource";
    case "manifest": return "manifest";
    case "wasm": return "wasm";
    case "image":
    case "font":
    case "media":
      return typeOf(entry.mime) || rt;
    default:
      return typeOf(entry.mime) || rt || "";
  }
}
function matchesTypeFilter(entry) {
  return state.typeFilters.size === 0 || state.typeFilters.has(pillOf(entry));
}

function registrableHost(host) {
  const parts = String(host || "").split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}
function isThirdParty(entry) {
  const h = hostOf(entry.url);
  return !!h && registrableHost(h) !== registrableHost(state.pageHost);
}
function isBlockedRequest(entry) {
  if (entry.status === 0) return true; // failed / blocked (incl. our Offline rule)
  const r = entry.har.response;
  return !!(r && (r._error || r.status === 0));
}
function hasBlockedResponseCookies(entry) {
  const r = entry.har.response;
  const list = r && (r._blockedResponseCookies || r._blockedCookies);
  return Array.isArray(list) && list.length > 0;
}
function matchesMoreFilters(entry) {
  const mf = state.moreFilters;
  if (mf.hideData && /^data:/i.test(entry.url)) return false;
  if (mf.hideExt && /^(chrome-extension|moz-extension|extension):\/\//i.test(entry.url)) return false;
  if (mf.blockedReq && !isBlockedRequest(entry)) return false;
  if (mf.blockedCookies && !hasBlockedResponseCookies(entry)) return false;
  if (mf.thirdParty && state.pageHost && !isThirdParty(entry)) return false;
  return true;
}

const persistFilters = debounce(
  () => chrome.storage.local.set({ typeFilters: [...state.typeFilters], moreFilters: state.moreFilters }),
  200
);
function renderTypePills() {
  els.typeFiltersBar.innerHTML = "";
  for (const tf of TYPE_FILTERS) {
    const b = el("button", "type-pill", tf.label);
    b.dataset.tf = tf.id;
    const active = tf.id === "all" ? state.typeFilters.size === 0 : state.typeFilters.has(tf.id);
    if (active) b.classList.add("active");
    b.addEventListener("click", (e) => onTypePill(tf.id, e.ctrlKey || e.metaKey));
    els.typeFiltersBar.appendChild(b);
  }
}
// Plain click selects a single type (or toggles back to All); Ctrl/Cmd-click
// toggles it in a multi-selection — matching Chrome.
function onTypePill(id, additive) {
  const sel = state.typeFilters;
  if (id === "all") {
    sel.clear();
  } else if (additive) {
    sel.has(id) ? sel.delete(id) : sel.add(id);
  } else if (sel.size === 1 && sel.has(id)) {
    sel.clear();
  } else {
    sel.clear();
    sel.add(id);
  }
  persistFilters();
  renderTypePills();
  applyFilter();
}
function updateMoreFiltersBtn() {
  const any = Object.values(state.moreFilters).some(Boolean);
  els.moreFiltersBtn.classList.toggle("has-active", any);
}
function syncMoreFilterChecks() {
  els.moreFiltersMenu.querySelectorAll("input[data-mf]").forEach((cb) => {
    cb.checked = !!state.moreFilters[cb.dataset.mf];
    cb.closest("label").classList.toggle("active", cb.checked);
  });
}
function refreshPageHost() {
  try {
    chrome.devtools.inspectedWindow.eval("location.hostname", (res, err) => {
      if (!err && typeof res === "string") {
        state.pageHost = res;
        if (state.moreFilters.thirdParty) applyFilter();
      }
    });
  } catch { /* ignore */ }
}

els.moreFiltersBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.moreFiltersMenu.hidden = !els.moreFiltersMenu.hidden;
});
els.moreFiltersMenu.addEventListener("click", (e) => e.stopPropagation());
els.moreFiltersMenu.querySelectorAll("input[data-mf]").forEach((cb) => {
  cb.addEventListener("change", () => {
    state.moreFilters[cb.dataset.mf] = cb.checked;
    cb.closest("label").classList.toggle("active", cb.checked);
    persistFilters();
    updateMoreFiltersBtn();
    applyFilter();
  });
});
document.addEventListener("click", () => { els.moreFiltersMenu.hidden = true; });

/* ------------------------------ formatting ---------------------------- */
function nameOf(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return (seg || u.pathname || u.hostname) + (u.search ? u.search : "");
  } catch {
    return url;
  }
}
function rawQuery(url) {
  const i = url.indexOf("?");
  return i >= 0 ? url.slice(i + 1) : "";
}
function hostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }
function schemeOf(url) { try { return new URL(url).protocol.replace(":", ""); } catch { return ""; } }
function typeOf(mime) {
  if (!mime) return "";
  const m = mime.split(";")[0];
  if (m.includes("json")) return "json";
  if (m.includes("html")) return "document";
  if (m.includes("javascript")) return "script";
  if (m.includes("css")) return "stylesheet";
  if (m.startsWith("image/")) return m.slice(6);
  if (m.includes("plain")) return "text";
  return m.split("/")[1] || m;
}
function fmtSize(bytes) {
  if (bytes == null || bytes < 0) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " kB";
  return (bytes / 1048576).toFixed(2) + " MB";
}
function fmtTime(ms) {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000) return Math.round(ms) + " ms";
  return (ms / 1000).toFixed(2) + " s";
}
function looksEncrypted(s) {
  if (!s) return false;
  const t = s.trim();
  // Base64-ish, reasonably long, not obvious JSON/text.
  return t.length >= 16 && /^[A-Za-z0-9+/=\s%]+$/.test(t) && t[0] !== "{" && t[0] !== "[";
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function formatBody(text) {
  let pretty = text, isJson = false;
  const t = text.trim();
  if (t && (t[0] === "{" || t[0] === "[")) {
    try { pretty = JSON.stringify(JSON.parse(t), null, 2); isJson = true; } catch {}
  }
  const esc = escapeHtml(pretty);
  if (!isJson) return esc;
  return esc.replace(
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (m) => {
      let cls = "tok-num";
      if (/^"/.test(m)) cls = /:\s*$/.test(m) ? "tok-key" : "tok-str";
      else if (/^(true|false)$/.test(m)) cls = "tok-bool";
      else if (m === "null") cls = "tok-null";
      return `<span class="${cls}">${m}</span>`;
    }
  );
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return null; } }
function safeAtob(b64) { try { return atob(b64); } catch { return b64; } }

/* ------------------------------- capture ------------------------------ */
chrome.devtools.network.onRequestFinished.addListener((har) => {
  if (state.paused) return;

  const url = har.request.url;
  const postData = har.request.postData ? har.request.postData.text || "" : "";
  const query = rawQuery(url);

  const entry = {
    id: state.nextId++,
    har,
    url,
    method: har.request.method,
    status: har.response.status,
    statusText: har.response.statusText || "",
    mime: (har.response.content && har.response.content.mimeType) || "",
    size: pickSize(har),
    time: har.time,
    serverIP: har.serverIPAddress || "",
    reqHeaders: har.request.headers || [],
    respHeaders: har.response.headers || [],
    postData,
    query,
    responseRaw: null,
    maybeEncrypted: looksEncrypted(postData) || looksEncrypted(query),
    decrypted: false,   // set true once any part decrypts cleanly
    tags: [],
    reqHash: null,
    respHash: null,
  };

  state.entries.push(entry);
  state.byId.set(entry.id, entry);
  addRow(entry);
  updateCount();
  if (state.sort.col && state.sort.dir) applySortDebounced(); // keep sort order live
  if (state.search.active && state.search.regex) searchDebounced(); // index the new request
});

function pickSize(har) {
  const c = har.response.content;
  if (c && c.size > 0) return c.size;
  if (har.response.bodySize > 0) return har.response.bodySize;
  return c && c.size === 0 ? 0 : -1;
}

function fetchContent(entry) {
  if (entry._contentPromise) return entry._contentPromise;
  entry._contentPromise = new Promise((resolve) => {
    entry.har.getContent((content, encoding) => {
      entry.responseEncoding = encoding || "";
      entry.responseB64 = encoding === "base64" ? content : null;
      entry.responseRaw = encoding === "base64" ? safeAtob(content) : content || "";
      if (looksEncrypted(entry.responseRaw)) entry.maybeEncrypted = true;
      resolve(entry.responseRaw);
    });
  });
  return entry._contentPromise;
}

// Fetch the response and attempt to decrypt every encrypted part.
// Shared by search indexing and the "Decrypted session" export so the
// decryption logic lives in exactly one place.
async function gatherDecrypted(entry) {
  const raw = await fetchContent(entry);
  const out = {
    query: entry.query || "",
    payload: entry.postData || "",
    response: raw || "",
    queryDecrypted: null,
    payloadDecrypted: null,
    responseDecrypted: null,
  };
  if (entry.query) {
    const r = await CipherNetCrypto.tryDecrypt(
      [entry.query, safeDecode(entry.query), entry.query.replace(/ /g, "+")],
      state.key,
      state.iv
    );
    if (r.ok) { out.queryDecrypted = r.text; entry.maybeEncrypted = entry.decrypted = true; }
  }
  if (entry.postData) {
    const r = await CipherNetCrypto.tryDecrypt(entry.postData, state.key, state.iv);
    if (r.ok) { out.payloadDecrypted = r.text; entry.maybeEncrypted = entry.decrypted = true; }
  }
  if (raw) {
    const r = await CipherNetCrypto.tryDecrypt(raw, state.key, state.iv);
    if (r.ok) { out.responseDecrypted = r.text; entry.maybeEncrypted = entry.decrypted = true; }
  }
  return out;
}

/* -------------------------------- list -------------------------------- */
// §26 column model. `cell` columns build custom DOM; `text` columns return a
// string. Widths/order/visibility are user-controlled and persisted.
const COLUMN_DEFS = [
  { id: "name", label: "Name", width: 240, visible: true, cell: nameCell },
  { id: "method", label: "Method", width: 70, visible: true, cell: methodCell },
  { id: "status", label: "Status", width: 70, visible: true, cell: statusCell },
  { id: "type", label: "Type", width: 90, visible: true, text: (e) => typeLabel(e) },
  { id: "initiator", label: "Initiator", width: 150, visible: false, text: initiatorText },
  { id: "size", label: "Size", width: 80, visible: true, text: (e) => fmtSize(e.size) },
  { id: "time", label: "Time", width: 80, visible: true, text: (e) => fmtTime(e.time) },
  { id: "encryption", label: "Encryption", width: 90, visible: false, text: (e) => (e.maybeEncrypted ? "encrypted" : "") },
  { id: "decryption", label: "Decryption", width: 100, visible: false, text: (e) => (e.decrypted ? "decrypted ✓" : e.maybeEncrypted ? "—" : "") },
];
const COLUMN_MAP = Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c]));
const MIN_COL_WIDTH = 40;

function defaultColumns() {
  return {
    order: COLUMN_DEFS.map((c) => c.id),
    widths: Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.width])),
    visible: Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.visible])),
  };
}
// Merge persisted layout over defaults so newly added columns still appear.
function normalizeColumns(saved) {
  const def = defaultColumns();
  if (!saved) return def;
  const order = (saved.order || []).filter((id) => COLUMN_MAP[id]);
  for (const id of def.order) if (!order.includes(id)) order.push(id);
  return {
    order,
    widths: { ...def.widths, ...(saved.widths || {}) },
    visible: { ...def.visible, ...(saved.visible || {}) },
  };
}
function visibleColumns() {
  return state.columns.order.filter((id) => state.columns.visible[id]).map((id) => COLUMN_MAP[id]);
}
const persistColumns = debounce(() => chrome.storage.local.set({ columns: state.columns }), 250);

function initiatorText(e) {
  const i = e.har._initiator;
  if (!i) return "";
  if (i.url) { try { return new URL(i.url).pathname.split("/").pop() || i.url; } catch { return i.url; } }
  return i.type || "";
}

/* --- cell renderers --- */
function nameCell(entry, td) {
  td.title = entry.url;
  const wrap = el("span", "td-name");
  if (entry.maybeEncrypted) wrap.appendChild(el("span", "lock", "🔒"));
  wrap.appendChild(el("span", null, nameOf(entry.url)));
  td.appendChild(wrap);
}
function methodCell(entry, td) {
  td.className += " method-cell " + entry.method;
  td.textContent = entry.method;
}
function statusCell(entry, td) {
  td.className += " " + (entry.status >= 400 || entry.status === 0 ? "status-bad" : "status-ok");
  td.textContent = entry.status || "(pending)";
}

/* --- table head + colgroup --- */
function renderHead() {
  els.reqCols.innerHTML = "";
  els.reqHead.innerHTML = "";
  let total = 0;
  for (const col of visibleColumns()) {
    const w = state.columns.widths[col.id] || col.width;
    total += w;
    const colEl = document.createElement("col");
    colEl.style.width = w + "px";
    colEl.dataset.col = col.id;
    els.reqCols.appendChild(colEl);

    const th = document.createElement("th");
    th.dataset.col = col.id;
    th.title = "Click to sort · drag to reorder · right-click for columns";
    th.draggable = true;
    th.appendChild(el("span", null, col.label));
    if (state.sort.col === col.id && state.sort.dir) {
      th.classList.add("sorted");
      th.appendChild(el("span", "col-sort-arrow", state.sort.dir > 0 ? " ▲" : " ▼"));
    }
    const grip = el("div", "col-grip");
    grip.dataset.col = col.id;
    th.appendChild(grip);
    els.reqHead.appendChild(th);
  }
  els.reqTable.style.width = total + "px";
}

/* --- rows --- */
function rowHidden(entry) {
  return (
    !matchesFilter(entry) ||
    !matchesTypeFilter(entry) ||
    !matchesMoreFilters(entry) ||
    (state.onlyEncrypted && !entry.maybeEncrypted) ||
    (state.search.matchIds && !state.search.matchIds.has(entry.id))
  );
}
function makeRow(entry) {
  const tr = document.createElement("tr");
  tr.dataset.id = String(entry.id);
  for (const col of visibleColumns()) {
    const td = document.createElement("td");
    td.className = "col-" + col.id;
    if (col.cell) col.cell(entry, td);
    else td.textContent = col.text(entry) || "";
    tr.appendChild(td);
  }
  tr.addEventListener("click", () => selectEntry(entry.id));
  if (entry.id === state.selectedId) tr.classList.add("selected");
  entry.row = tr;
  return tr;
}
function addRow(entry) {
  const tr = makeRow(entry);
  els.reqBody.appendChild(tr);
  if (rowHidden(entry)) tr.style.display = "none";
}
function rebuildBody() {
  els.reqBody.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const entry of sortedEntries()) {
    const tr = makeRow(entry);
    if (rowHidden(entry)) tr.style.display = "none";
    frag.appendChild(tr);
  }
  els.reqBody.appendChild(frag);
}
function rebuildTable() {
  renderHead();
  rebuildBody();
}

/* --- §3 column sorting (click a header to sort; cycles asc → desc → off) --- */
function sortValue(col, entry) {
  switch (col.id) {
    case "status": return entry.status || 0;
    case "size": return entry.size < 0 ? -1 : entry.size;
    case "time": return entry.time < 0 ? -1 : entry.time;
    case "encryption": return entry.maybeEncrypted ? 1 : 0;
    case "decryption": return entry.decrypted ? 1 : 0;
    case "name": return nameOf(entry.url).toLowerCase();
    case "method": return entry.method;
    case "type": return typeLabel(entry);
    case "initiator": return initiatorText(entry).toLowerCase();
    default: return col.text ? String(col.text(entry)) : "";
  }
}
function cmp(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
// Returns entries in current sort order (capture order when no sort is active).
function sortedEntries() {
  const col = COLUMN_MAP[state.sort.col];
  if (!col || !state.sort.dir) return state.entries;
  return state.entries.slice().sort((a, b) => cmp(sortValue(col, a), sortValue(col, b)) * state.sort.dir);
}
// Reorder existing DOM rows in place (used when a request arrives while sorted).
function applySort() {
  if (!state.sort.col || !state.sort.dir) return;
  const frag = document.createDocumentFragment();
  for (const e of sortedEntries()) if (e.row) frag.appendChild(e.row);
  els.reqBody.appendChild(frag);
}
const applySortDebounced = debounce(applySort, 120);
function toggleSort(colId) {
  const s = state.sort;
  if (s.col !== colId) { s.col = colId; s.dir = 1; }      // new column → ascending
  else if (s.dir === 1) s.dir = -1;                       // asc → desc
  else { s.col = null; s.dir = 0; }                       // desc → off
  chrome.storage.local.set({ sort: s });
  rebuildTable();
}

/* --- column resize (drag the right border; double-click to auto-fit) --- */
let colResize = null;
let suppressColDrag = false;
function setColWidth(id, w) {
  state.columns.widths[id] = w;
  const colEl = els.reqCols.querySelector(`col[data-col="${id}"]`);
  if (colEl) colEl.style.width = w + "px";
  let total = 0;
  for (const c of visibleColumns()) total += state.columns.widths[c.id] || c.width;
  els.reqTable.style.width = total + "px";
}
function autoFitColumn(id) {
  const idx = visibleColumns().findIndex((c) => c.id === id);
  if (idx < 0) return;
  const th = els.reqHead.children[idx];
  let max = th ? th.scrollWidth : MIN_COL_WIDTH;
  for (const e of state.entries) {
    if (!e.row || e.row.style.display === "none") continue;
    const td = e.row.children[idx];
    if (td) max = Math.max(max, td.scrollWidth);
  }
  setColWidth(id, Math.max(MIN_COL_WIDTH, Math.min(max + 6, 800)));
  persistColumns();
}
els.reqHead.addEventListener("mousedown", (e) => {
  const grip = e.target.closest(".col-grip");
  if (!grip) return;
  e.preventDefault();
  e.stopPropagation();
  suppressColDrag = true; // don't let the header start a reorder drag
  const id = grip.dataset.col;
  colResize = { id, startX: e.clientX, startW: state.columns.widths[id] || COLUMN_MAP[id].width };
  document.body.classList.add("col-resizing");
});
els.reqHead.addEventListener("dblclick", (e) => {
  const grip = e.target.closest(".col-grip");
  if (grip) autoFitColumn(grip.dataset.col);
});
els.reqHead.addEventListener("click", (e) => {
  if (e.target.closest(".col-grip")) return; // resizing, not sorting
  const th = e.target.closest("th");
  if (th) toggleSort(th.dataset.col);
});

/* --- column reorder (drag headers) --- */
let dragCol = null;
function moveColumn(fromId, toId) {
  if (fromId === toId) return;
  const order = state.columns.order.slice();
  order.splice(order.indexOf(fromId), 1);
  order.splice(order.indexOf(toId), 0, fromId); // drop before the target
  state.columns.order = order;
  persistColumns();
  rebuildTable();
}
els.reqHead.addEventListener("dragstart", (e) => {
  if (suppressColDrag) { e.preventDefault(); return; }
  const th = e.target.closest("th");
  if (!th) return;
  dragCol = th.dataset.col;
  th.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", dragCol); } catch {}
});
els.reqHead.addEventListener("dragover", (e) => {
  if (!dragCol) return;
  const th = e.target.closest("th");
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  for (const t of els.reqHead.children)
    t.classList.toggle("drag-over", t === th && t.dataset.col !== dragCol);
});
els.reqHead.addEventListener("drop", (e) => {
  e.preventDefault();
  const th = e.target.closest("th");
  if (th && dragCol) moveColumn(dragCol, th.dataset.col);
});
els.reqHead.addEventListener("dragend", () => {
  dragCol = null;
  for (const t of els.reqHead.children) t.classList.remove("drag-over", "dragging");
});

/* --- column show/hide context menu --- */
const colMenu = document.createElement("div");
colMenu.className = "col-menu";
colMenu.hidden = true;
document.body.appendChild(colMenu);
function openColumnMenu(x, y) {
  colMenu.innerHTML = "";
  for (const id of state.columns.order) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!state.columns.visible[id];
    cb.addEventListener("change", () => {
      const shown = state.columns.order.filter((c) => state.columns.visible[c]).length;
      if (!cb.checked && shown <= 1) { cb.checked = true; return; } // keep at least one column
      state.columns.visible[id] = cb.checked;
      persistColumns();
      rebuildTable();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + COLUMN_MAP[id].label));
    colMenu.appendChild(label);
  }
  const reset = document.createElement("button");
  reset.className = "reset";
  reset.textContent = "Reset columns";
  reset.addEventListener("click", () => {
    state.columns = defaultColumns();
    persistColumns();
    rebuildTable();
    colMenu.hidden = true;
  });
  colMenu.appendChild(reset);
  colMenu.style.left = Math.min(x, window.innerWidth - 170) + "px";
  colMenu.style.top = Math.min(y, window.innerHeight - 40) + "px";
  colMenu.hidden = false;
}
els.reqHead.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openColumnMenu(e.clientX, e.clientY);
});
document.addEventListener("click", (e) => {
  if (!colMenu.hidden && !colMenu.contains(e.target)) colMenu.hidden = true;
});

/* --- shared drag handling for column resize + pane splitter --- */
let paneDrag = null;
document.addEventListener("mousemove", (e) => {
  if (colResize) {
    const w = Math.max(MIN_COL_WIDTH, colResize.startW + (e.clientX - colResize.startX));
    setColWidth(colResize.id, w);
  } else if (paneDrag) {
    const mainW = els.main.getBoundingClientRect().width;
    let w = paneDrag.startW + (e.clientX - paneDrag.startX);
    w = Math.max(150, Math.min(w, mainW - 200));
    state.layout.listWidth = w;
    els.listPane.style.flex = "0 0 " + w + "px";
  }
});
document.addEventListener("mouseup", () => {
  suppressColDrag = false;
  if (colResize) { colResize = null; document.body.classList.remove("col-resizing"); persistColumns(); }
  if (paneDrag) {
    paneDrag = null;
    els.splitter.classList.remove("dragging");
    document.body.classList.remove("col-resizing");
    chrome.storage.local.set({ layout: state.layout });
  }
});

/* --- §26 resizable panes (list ↔ detail) --- */
function applyListWidth() {
  els.listPane.style.flex = "0 0 " + (state.layout.listWidth || DEFAULT_LIST_WIDTH) + "px";
}
els.splitter.addEventListener("mousedown", (e) => {
  e.preventDefault();
  paneDrag = { startX: e.clientX, startW: state.layout.listWidth || els.listPane.getBoundingClientRect().width };
  els.splitter.classList.add("dragging");
  document.body.classList.add("col-resizing");
});
els.splitter.addEventListener("dblclick", () => {
  state.layout.listWidth = DEFAULT_LIST_WIDTH;
  applyListWidth();
  chrome.storage.local.set({ layout: state.layout });
});

function selectEntry(id) {
  state.selectedId = id;
  for (const e of state.entries) if (e.row) e.row.classList.toggle("selected", e.id === id);
  els.main.classList.add("split");
  els.detailPane.hidden = false;
  els.splitter.hidden = false;
  applyListWidth();
  renderDetail();
}
function closeDetail() {
  state.selectedId = null;
  els.main.classList.remove("split");
  els.detailPane.hidden = true;
  els.splitter.hidden = true;
  els.listPane.style.flex = ""; // back to flex: 1 1 auto (full width)
  for (const e of state.entries) if (e.row) e.row.classList.remove("selected");
}

/* ------------------------------- detail ------------------------------- */
let renderSeq = 0;
function stale(seq) {
  return seq !== renderSeq;
}
const TAB_RENDERERS = {
  headers: renderHeaders,
  payload: renderPayload,
  preview: renderPreview,
  response: renderResponse,
  timing: renderTiming,
  cookies: renderCookies,
  initiator: renderInitiator,
};
function renderDetail() {
  const entry = state.byId.get(state.selectedId);
  if (!entry) return;
  const seq = ++renderSeq;
  els.detailContent.innerHTML = "";
  const fn = TAB_RENDERERS[state.activeTab] || renderHeaders;
  // fn may be sync or async; highlight once its (awaited) body has run.
  Promise.resolve(fn(entry, seq)).then(() => { if (!stale(seq)) maybeHighlight(); });
}

// A small inline "Copy" button bound to a text getter.
function copyBtn(getText) {
  const b = el("button", "linkbtn copy-inline", "Copy");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(getText()).then(() => {
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy"), 1200);
    });
  });
  return b;
}

// A grid value cell that shows `text` plus a copy button.
function valueWithCopy(text) {
  const v = el("div", "v code has-copy");
  v.appendChild(el("span", "url-text", text));
  v.appendChild(copyBtn(() => text));
  return v;
}

// Returns the request URL with its (encrypted) query string decrypted, when possible.
async function buildDecryptedUrl(entry) {
  if (!entry.query) return { url: entry.url, decrypted: false };
  const candidates = [entry.query, safeDecode(entry.query), entry.query.replace(/ /g, "+")];
  const res = await CipherNetCrypto.tryDecrypt(candidates, state.key, state.iv);
  if (!res.ok) return { url: entry.url, decrypted: false };
  entry.maybeEncrypted = entry.decrypted = true;
  return { url: entry.url.split("?")[0] + "?" + res.text, decrypted: true };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function section(title, subtitle) {
  const s = el("div", "dsection");
  const h = el("div", "dsection-title");
  h.appendChild(el("span", null, title));
  if (subtitle) h.appendChild(el("span", "sub", subtitle));
  s.appendChild(h);
  return { s, h };
}
function kvList(pairs) {
  const grid = el("div", "kv");
  for (const [k, v, codeClass] of pairs) {
    grid.appendChild(el("div", "k", k));
    grid.appendChild(el("div", "v" + (codeClass ? " code" : ""), v));
  }
  return grid;
}

async function renderHeaders(entry, seq) {
  // General
  const gen = section("General");
  const grid = el("div", "kv");

  grid.appendChild(el("div", "k", "Request URL"));
  grid.appendChild(valueWithCopy(entry.url));

  const methodK = el("div", "k", "Request Method"); // insertion anchor for decrypted URL
  const methodV = el("div", "v", entry.method);
  grid.append(methodK, methodV);
  grid.appendChild(el("div", "k", "Status Code"));
  grid.appendChild(el("div", "v", `${entry.status} ${entry.statusText}`.trim()));
  grid.appendChild(el("div", "k", "Remote Address"));
  grid.appendChild(el("div", "v", entry.serverIP || "—"));
  gen.s.appendChild(grid);
  els.detailContent.appendChild(gen.s);

  // Response headers
  const resp = section("Response Headers", `${entry.respHeaders.length}`);
  resp.s.appendChild(headerKv(entry.respHeaders));
  els.detailContent.appendChild(resp.s);

  // Request headers
  const req = section("Request Headers", `${entry.reqHeaders.length}`);
  req.s.appendChild(headerKv(entry.reqHeaders));
  els.detailContent.appendChild(req.s);

  // Insert a decrypted Request URL row (with copy) once the query decrypts.
  if (entry.query) {
    const du = await buildDecryptedUrl(entry);
    if (stale(seq) || !du.decrypted) return;
    grid.insertBefore(el("div", "k", "Request URL (decrypted)"), methodK);
    grid.insertBefore(valueWithCopy(du.url), methodK);
  }
}
function headerKv(headers) {
  if (!headers || !headers.length) return el("div", "muted-block", "No headers.");
  return kvList(headers.map((h) => [h.name, h.value]));
}

async function renderPayload(entry, seq) {
  // Request URL (with decrypted query, when present) + copy button — shown first.
  const du = await buildDecryptedUrl(entry);
  if (stale(seq)) return;
  const urlSec = section("Request URL", du.decrypted ? "query decrypted" : null);
  urlSec.s.appendChild(valueWithCopy(du.url));
  els.detailContent.appendChild(urlSec.s);

  let hasBody = false;

  // Encrypted query string -> decrypt -> parse params
  if (entry.query) {
    hasBody = true;
    const { s } = section("Query String Parameters", "decrypted");
    const candidates = [entry.query, safeDecode(entry.query), entry.query.replace(/ /g, "+")];
    const res = await CipherNetCrypto.tryDecrypt(candidates, state.key, state.iv);
    if (stale(seq)) return;
    if (res.ok) {
      entry.maybeEncrypted = entry.decrypted = true;
      const params = [...new URLSearchParams(res.text).entries()];
      s.appendChild(params.length ? kvList(params.map(([k, v]) => [k, v, true])) : bodyView(res.text, entry.query, res));
      s.appendChild(sourceToggle(entry.query, res.text));
    } else {
      s.appendChild(bodyView(null, entry.query, res));
    }
    els.detailContent.appendChild(s);
  }

  // Request payload (POST/PUT/PATCH body)
  if (entry.postData) {
    hasBody = true;
    const { s } = section("Request Payload", "decrypted");
    const res = await CipherNetCrypto.tryDecrypt(entry.postData, state.key, state.iv);
    if (stale(seq)) return;
    if (res.ok) entry.maybeEncrypted = entry.decrypted = true;
    s.appendChild(bodyView(res.ok ? res.text : null, entry.postData, res));
    els.detailContent.appendChild(s);
  }

  if (!hasBody) {
    els.detailContent.appendChild(
      el("div", "muted-block", "No query string or request body — only the Request URL above.")
    );
  }
}

async function renderResponse(entry, seq) {
  const { s } = section("Response", "decrypted");
  const placeholder = el("div", "muted-block", "Loading…");
  s.appendChild(placeholder);
  els.detailContent.appendChild(s);

  const raw = await fetchContent(entry);
  if (stale(seq)) return;
  s.removeChild(placeholder);

  if (!raw) {
    s.appendChild(el("div", "muted-block", "No response body."));
    return;
  }
  const res = await CipherNetCrypto.tryDecrypt(raw, state.key, state.iv);
  if (stale(seq)) return;
  if (res.ok) entry.maybeEncrypted = entry.decrypted = true;
  s.appendChild(bodyView(res.ok ? res.text : null, raw, res));
}

/* A <pre> body view with a decrypted/raw toggle + copy. */
function bodyView(decrypted, raw, res) {
  const container = el("div");
  const bar = el("div", "dsection-title");
  bar.style.border = "none";
  bar.style.marginBottom = "4px";
  const toggle = el("button", "linkbtn");
  const copy = el("button", "linkbtn", "Copy");
  bar.appendChild(toggle);
  bar.appendChild(copy);
  container.appendChild(bar);

  const pre = el("pre", "body");
  container.appendChild(pre);

  let showingRaw = decrypted == null;
  function render() {
    if (showingRaw || decrypted == null) {
      if (decrypted == null && res && !res.ok) {
        pre.classList.add("error");
        pre.innerHTML =
          `<span class="note">[could not decrypt: ${escapeHtml(res.error)}]\nShowing raw bytes:</span>\n\n` +
          escapeHtml(raw || "(empty)");
      } else {
        pre.classList.remove("error");
        pre.textContent = raw || "(empty)";
      }
      toggle.textContent = "View decrypted";
    } else {
      pre.classList.remove("error");
      pre.innerHTML = formatBody(decrypted);
      toggle.textContent = "View raw";
    }
  }
  render();
  toggle.addEventListener("click", () => { showingRaw = !showingRaw; render(); });
  copy.addEventListener("click", () => {
    const text = showingRaw || decrypted == null ? raw || "" : decrypted;
    navigator.clipboard.writeText(text).then(() => {
      copy.textContent = "Copied!";
      setTimeout(() => (copy.textContent = "Copy"), 1200);
    });
  });
  return container;
}

/* "view decrypted source" link for the query params table */
function sourceToggle(raw, decrypted) {
  const wrap = el("div");
  wrap.style.marginTop = "6px";
  const btn = el("button", "linkbtn", "View decrypted source");
  const pre = el("pre", "body");
  pre.style.display = "none";
  pre.style.marginTop = "4px";
  let open = false;
  btn.addEventListener("click", () => {
    open = !open;
    pre.style.display = open ? "" : "none";
    pre.textContent = decrypted;
    btn.textContent = open ? "Hide source" : "View decrypted source";
  });
  wrap.appendChild(btn);
  wrap.appendChild(pre);
  return wrap;
}

/* ------------------------------- preview ------------------------------ */
// JSON tree node with collapse/expand. Branches toggle on click; leaves are
// colored by type.
function buildTree(value, keyLabel) {
  const node = el("div", "jt-node");
  const isObj = value !== null && typeof value === "object";
  if (isObj) {
    const isArr = Array.isArray(value);
    const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
    const row = el("div", "jt-row jt-branch");
    const tri = el("span", "jt-tri", entries.length ? "▾" : "·");
    row.appendChild(tri);
    if (keyLabel != null) row.appendChild(el("span", "jt-key", keyLabel + ":"));
    row.appendChild(el("span", "jt-meta", isArr ? `Array(${entries.length})` : `{${entries.length}}`));
    const children = el("div", "jt-children");
    for (const [k, v] of entries) children.appendChild(buildTree(v, String(k)));
    node._open = true;
    node._apply = () => {
      if (!entries.length) return;
      children.style.display = node._open ? "" : "none";
      tri.textContent = node._open ? "▾" : "▸";
    };
    row.addEventListener("click", (e) => { e.stopPropagation(); node._open = !node._open; node._apply(); });
    node.appendChild(row);
    node.appendChild(children);
  } else {
    const row = el("div", "jt-row");
    row.appendChild(el("span", "jt-tri-spacer"));
    if (keyLabel != null) row.appendChild(el("span", "jt-key", keyLabel + ":"));
    const type = value === null ? "null" : typeof value;
    const cls =
      type === "number" ? "tok-num" : type === "boolean" ? "tok-bool" : type === "null" ? "tok-null" : "tok-str";
    const text = value === null ? "null" : type === "string" ? JSON.stringify(value) : String(value);
    row.appendChild(el("span", cls, text));
    node.appendChild(row);
  }
  return node;
}
function setTreeOpen(root, open) {
  root.querySelectorAll(".jt-node").forEach((n) => { if (n._apply) { n._open = open; n._apply(); } });
}

async function renderPreview(entry, seq) {
  const { s, h } = section("Preview");
  const ctrlBar = el("div", "preview-bar");
  const holder = el("div");
  s.appendChild(ctrlBar);
  s.appendChild(holder);
  els.detailContent.appendChild(s);
  holder.appendChild(el("div", "muted-block", "Loading…"));

  const raw = await fetchContent(entry);
  if (stale(seq)) return;
  holder.innerHTML = "";

  if (entry.mime && entry.mime.startsWith("image/") && entry.responseB64) {
    const img = el("img", "preview-img");
    img.src = `data:${entry.mime};base64,${entry.responseB64}`;
    holder.appendChild(img);
    return;
  }
  if (!raw) { holder.appendChild(el("div", "muted-block", "No response body.")); return; }

  const res = await CipherNetCrypto.tryDecrypt(raw, state.key, state.iv);
  if (stale(seq)) return;
  const text = res.ok ? res.text : raw;
  if (res.ok) { entry.maybeEncrypted = entry.decrypted = true; h.appendChild(el("span", "sub", "decrypted")); }

  let data, isJson = false;
  const trimmed = text.trim();
  if (trimmed && (trimmed[0] === "{" || trimmed[0] === "[")) {
    try { data = JSON.parse(trimmed); isJson = true; } catch {}
  }
  if (isJson) {
    const exp = el("button", "linkbtn", "Expand all");
    const col = el("button", "linkbtn", "Collapse all");
    ctrlBar.appendChild(exp);
    ctrlBar.appendChild(col);
    const tree = el("div", "jt");
    tree.appendChild(buildTree(data, null));
    holder.appendChild(tree);
    exp.addEventListener("click", () => setTreeOpen(tree, true));
    col.addEventListener("click", () => setTreeOpen(tree, false));
  } else {
    const pre = el("pre", "body");
    pre.textContent = text;
    holder.appendChild(pre);
  }
}

/* ------------------------------- timing ------------------------------- */
function renderTiming(entry) {
  const t = entry.har.timings || {};
  const num = (x) => (typeof x === "number" && x >= 0 ? x : -1);
  const v = {
    blocked: num(t.blocked),
    dns: num(t.dns),
    connect: num(t.connect),
    ssl: num(t.ssl),
    send: num(t.send),
    wait: num(t.wait),
    receive: num(t.receive),
  };
  // HAR folds SSL time into `connect`; show them separately without double counting.
  if (v.connect >= 0 && v.ssl >= 0) v.connect = Math.max(v.connect - v.ssl, 0);

  const phases = [
    ["Stalled / Blocked", "blocked"],
    ["DNS Lookup", "dns"],
    ["Initial Connection", "connect"],
    ["SSL", "ssl"],
    ["Request Sent", "send"],
    ["Waiting (TTFB)", "wait"],
    ["Content Download", "receive"],
  ].filter(([, k]) => v[k] >= 0);

  const { s } = section("Timing");
  els.detailContent.appendChild(s);
  if (!phases.length) {
    s.appendChild(el("div", "muted-block", "No timing information available."));
    return;
  }
  const total = phases.reduce((a, [, k]) => a + v[k], 0) || 1;
  const grid = el("div", "timing-grid");
  let offset = 0;
  for (const [label, k] of phases) {
    grid.appendChild(el("div", "t-label", label));
    const track = el("div", "t-track");
    const bar = el("div", "t-bar " + k);
    bar.style.left = (offset / total) * 100 + "%";
    bar.style.width = Math.max((v[k] / total) * 100, 0.5) + "%";
    track.appendChild(bar);
    grid.appendChild(track);
    grid.appendChild(el("div", "t-ms", fmtTime(v[k])));
    offset += v[k];
  }
  grid.appendChild(el("div", "t-label", "Total"));
  grid.appendChild(el("div"));
  grid.appendChild(el("div", "t-ms", fmtTime(entry.time)));
  s.appendChild(grid);
}

/* ------------------------------- cookies ------------------------------ */
function parseCookiePairs(str) {
  return String(str || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return i < 0 ? { name: p, value: "" } : { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim() };
    });
}
function cookiesOf(entry, which) {
  if (which === "request") {
    const har = entry.har.request.cookies;
    if (har && har.length) return har;
    const h = entry.reqHeaders.find((x) => /^cookie$/i.test(x.name));
    return h ? parseCookiePairs(h.value) : [];
  }
  const har = entry.har.response.cookies;
  if (har && har.length) return har;
  return entry.respHeaders
    .filter((x) => /^set-cookie$/i.test(x.name))
    .map((x) => parseCookiePairs(x.value.split(";")[0])[0])
    .filter(Boolean);
}
function cookieTable(cookies) {
  const cols = ["name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite"];
  const labels = ["Name", "Value", "Domain", "Path", "Expires", "HttpOnly", "Secure", "SameSite"];
  const table = el("table", "dtable");
  const thead = document.createElement("thead");
  const htr = el("tr");
  for (const l of labels) htr.appendChild(el("th", null, l));
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const c of cookies) {
    const tr = el("tr");
    for (const k of cols) {
      let val = c[k];
      if (k === "httpOnly" || k === "secure") val = val ? "✓" : "";
      tr.appendChild(el("td", null, val == null || val === "" ? "—" : String(val)));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}
function renderCookies(entry) {
  const req = cookiesOf(entry, "request");
  const resp = cookiesOf(entry, "response");
  if (!req.length && !resp.length) {
    els.detailContent.appendChild(el("div", "muted-block", "This request has no cookies."));
    return;
  }
  if (req.length) {
    const { s } = section("Request Cookies", String(req.length));
    s.appendChild(cookieTable(req));
    els.detailContent.appendChild(s);
  }
  if (resp.length) {
    const { s } = section("Response Cookies", String(resp.length));
    s.appendChild(cookieTable(resp));
    els.detailContent.appendChild(s);
  }
}

/* ------------------------------ initiator ----------------------------- */
function renderInitiator(entry) {
  const init = entry.har._initiator;
  const { s } = section("Initiator");
  els.detailContent.appendChild(s);
  if (!init) {
    s.appendChild(el("div", "muted-block", "Initiator information not available for this request."));
    return;
  }
  const grid = el("div", "kv");
  grid.appendChild(el("div", "k", "Type"));
  grid.appendChild(el("div", "v", init.type || "—"));
  if (init.url) {
    grid.appendChild(el("div", "k", "URL"));
    grid.appendChild(el("div", "v code", init.url + (init.lineNumber != null ? `:${init.lineNumber + 1}` : "")));
  }
  s.appendChild(grid);

  const frames = init.stack && init.stack.callFrames;
  if (frames && frames.length) {
    const cs = section("Call Stack", String(frames.length));
    const list = el("div", "kv");
    for (const f of frames) {
      list.appendChild(el("div", "k", f.functionName || "(anonymous)"));
      list.appendChild(el("div", "v code", `${f.url || ""}:${(f.lineNumber || 0) + 1}:${(f.columnNumber || 0) + 1}`));
    }
    cs.s.appendChild(list);
    els.detailContent.appendChild(cs.s);
  }
}

/* -------------------------- §27 network controls ---------------------- */
// Throttle presets mirror Chrome DevTools (download/upload in bits/s, latency ms).
const THROTTLE_PRESETS = [
  { id: "none", label: "No throttling" },
  { id: "offline", label: "Offline", down: 0, up: 0, latency: 0 },
  { id: "fast5g", label: "Fast 5G", down: 100e6, up: 50e6, latency: 20 },
  { id: "slow5g", label: "Slow 5G", down: 25e6, up: 10e6, latency: 40 },
  { id: "fast4g", label: "Fast 4G", down: 10e6, up: 5e6, latency: 80 },
  { id: "slow4g", label: "Slow 4G", down: 4e6, up: 3e6, latency: 150 },
  { id: "3g", label: "3G", down: 1.5e6, up: 750e3, latency: 300 },
  { id: "slow3g", label: "Slow 3G", down: 400e3, up: 400e3, latency: 2000 },
];
function populateThrottle() {
  els.throttle.innerHTML = "";
  for (const p of THROTTLE_PRESETS) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    els.throttle.appendChild(o);
  }
}
function applyThrottleNote() {
  if (state.throttle === "none") { els.throttleNote.textContent = ""; return; }
  if (state.throttle === "offline") { els.throttleNote.textContent = "⛔ Offline — blocking all requests"; return; }
  const p = THROTTLE_PRESETS.find((x) => x.id === state.throttle);
  // Bandwidth/latency shaping needs CDP (Network.emulateNetworkConditions);
  // Chrome won't let an extension attach the debugger while DevTools is open.
  els.throttleNote.textContent = `▲ ${p ? p.label : ""} — bandwidth shaping needs debugger (inactive while DevTools is open)`;
}
els.throttle.addEventListener("change", () => {
  state.throttle = els.throttle.value;
  chrome.storage.local.set({ throttle: state.throttle });
  applyThrottleNote();
  applyThrottle();
});

els.preserveLog.addEventListener("change", () => {
  state.preserveLog = els.preserveLog.checked;
  chrome.storage.local.set({ preserveLog: state.preserveLog });
});

// All declarativeNetRequest-controllable resource types.
const ALL_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
];
const CACHE_RULE_ID = 1;
const OFFLINE_RULE_ID = 2;

function dnrCtx() {
  const dnr = chrome.declarativeNetRequest;
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!dnr || !dnr.updateSessionRules || typeof tabId !== "number") return null;
  return { dnr, tabId };
}

// §27 Disable cache: inject no-cache request headers for the inspected tab.
function cacheRule(tabId) {
  return {
    id: CACHE_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "Cache-Control", operation: "set", value: "no-cache, no-store, max-age=0" },
        { header: "Pragma", operation: "set", value: "no-cache" },
      ],
    },
    condition: { tabIds: [tabId], resourceTypes: ALL_RESOURCE_TYPES },
  };
}
function applyDisableCache() {
  const ctx = dnrCtx();
  if (!ctx) { els.disableCache.title = "Disable cache is unavailable in this browser"; return; }
  ctx.dnr.updateSessionRules(
    { removeRuleIds: [CACHE_RULE_ID], addRules: state.disableCache ? [cacheRule(ctx.tabId)] : [] },
    () => { void chrome.runtime.lastError; } // swallow unchecked-error warning
  );
}
els.disableCache.addEventListener("change", () => {
  state.disableCache = els.disableCache.checked;
  chrome.storage.local.set({ disableCache: state.disableCache });
  applyDisableCache();
});

// §27 Throttling: "Offline" is enforced for real by blocking every request on
// the inspected tab (works while DevTools is open). Bandwidth presets can't be
// shaped without the debugger, so they remain informational.
function offlineRule(tabId) {
  return {
    id: OFFLINE_RULE_ID,
    priority: 2,
    action: { type: "block" },
    condition: { tabIds: [tabId], resourceTypes: ALL_RESOURCE_TYPES },
  };
}
function applyThrottle() {
  const ctx = dnrCtx();
  if (!ctx) { els.throttle.title = "Offline throttling is unavailable in this browser"; return; }
  const offline = state.throttle === "offline";
  ctx.dnr.updateSessionRules(
    { removeRuleIds: [OFFLINE_RULE_ID], addRules: offline ? [offlineRule(ctx.tabId)] : [] },
    () => { void chrome.runtime.lastError; }
  );
}

// Remove the session rules when the DevTools panel goes away, so a tab is never
// left permanently blocked / no-cache after DevTools closes. They are re-applied
// from persisted state when the panel reopens.
window.addEventListener("pagehide", () => {
  const ctx = dnrCtx();
  if (ctx) ctx.dnr.updateSessionRules({ removeRuleIds: [CACHE_RULE_ID, OFFLINE_RULE_ID] });
});

// §27 Preserve log: clear the list on navigation unless Preserve log is on.
if (chrome.devtools && chrome.devtools.network && chrome.devtools.network.onNavigated) {
  chrome.devtools.network.onNavigated.addListener(() => {
    if (!state.preserveLog) clearRequests();
    refreshPageHost(); // the page origin changed → recompute 3rd-party
  });
}

/* -------------------------------- init -------------------------------- */
state.columns = defaultColumns(); // sync default until chrome.storage loads
populateThrottle();
renderHead();
renderTypePills();
refreshPageHost();
loadSettings();
updateCount();
