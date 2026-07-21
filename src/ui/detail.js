// ui/detail.js — the request detail pane: the Headers / Payload / Preview /
// Response / Timing / Cookies / Initiator tabs, with CipherNet bodies decrypted in place.

import { state, DEFAULT_KV_KEY_WIDTH } from "../core/state.js";
import { els } from "../core/els.js";
import { el, copyBtn } from "../core/dom.js";
import { CipherNetCrypto } from "../core/crypto.js";
import { formatBody, prettyText, escapeHtml, safeDecode, fmtTime } from "../core/format.js";
import { fetchContent } from "../services/capture.js";
import { maybeHighlight } from "../services/search.js";
import { saveSettings } from "../services/storage.js";
import { jsonTableView, jsonTreeView, jsonCodeView } from "./jsonTable.js";

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
// Tabs that render a `.kv` label/value grid — only these show the kv splitter.
const KV_TABS = new Set(["headers", "payload", "initiator"]);
export function renderDetail() {
  const entry = state.byId.get(state.selectedId);
  if (!entry) return;
  const seq = ++renderSeq;
  els.detailContent.innerHTML = "";
  els.kvSplitter.hidden = !KV_TABS.has(state.activeTab);
  const fn = TAB_RENDERERS[state.activeTab] || renderHeaders;
  // fn may be sync or async; highlight once its (awaited) body has run.
  Promise.resolve(fn(entry, seq)).then(() => { if (!stale(seq)) maybeHighlight(); });
}

/* --- draggable kv label-column width (Request URL row and other kv grids) --- */
const KV_MIN = 80, KV_MAX = 480;
const KV_PAD_LEFT = 12; // #detailContent's left padding (panel.css)
const KV_GAP = 12;      // .kv column gap (panel.css)
function currentKvWidth() {
  return state.layout.kvKeyWidth || DEFAULT_KV_KEY_WIDTH;
}
function positionKvSplitter() {
  els.kvSplitter.style.left = KV_PAD_LEFT + currentKvWidth() + KV_GAP / 2 + "px";
}
export function applyKvKeyWidth() {
  document.documentElement.style.setProperty("--kv-key-w", currentKvWidth() + "px");
  positionKvSplitter();
}
function setKvKeyWidth(w) {
  state.layout.kvKeyWidth = Math.max(KV_MIN, Math.min(KV_MAX, w));
  applyKvKeyWidth();
}
let kvDrag = null;
els.kvSplitter.addEventListener("mousedown", (e) => {
  e.preventDefault();
  kvDrag = { startX: e.clientX, startW: currentKvWidth() };
  els.kvSplitter.classList.add("dragging");
  document.body.classList.add("col-resizing");
});
els.kvSplitter.addEventListener("dblclick", () => {
  setKvKeyWidth(DEFAULT_KV_KEY_WIDTH);
  saveSettings({ layout: state.layout });
});
document.addEventListener("mousemove", (e) => {
  if (!kvDrag) return;
  setKvKeyWidth(kvDrag.startW + (e.clientX - kvDrag.startX));
});
document.addEventListener("mouseup", () => {
  if (!kvDrag) return;
  kvDrag = null;
  els.kvSplitter.classList.remove("dragging");
  document.body.classList.remove("col-resizing");
  saveSettings({ layout: state.layout });
});

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

// Pull the raw Bearer token out of the Authorization request header, if present.
function bearerTokenOf(entry) {
  const h = (entry.reqHeaders || []).find((x) => /^authorization$/i.test(x.name));
  if (!h || !h.value) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.value.trim());
  return m ? m[1].trim() : null;
}
function maskToken(t) {
  return t.length <= 20 ? t : t.slice(0, 12) + "…" + t.slice(-6);
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
  const statusLabel = entry.failed
    ? `(failed) ${entry.statusText}`.trim()
    : entry.pending && !entry.status
      ? "(pending)"
      : `${entry.status} ${entry.statusText}`.trim();
  grid.appendChild(el("div", "v", statusLabel));
  grid.appendChild(el("div", "k", "Remote Address"));
  grid.appendChild(el("div", "v", entry.serverIP || "—"));

  // Copy the Authorization Bearer token (masked here; the button copies it whole).
  const bearer = bearerTokenOf(entry);
  if (bearer) {
    grid.appendChild(el("div", "k", "Bearer Token"));
    const bv = el("div", "v has-copy");
    bv.appendChild(el("span", "url-text", maskToken(bearer)));
    bv.appendChild(copyBtn(() => bearer));
    grid.appendChild(bv);
  }
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

/* A <pre> body view with a decrypted/raw toggle, a JSON table Preview, a
   collapsible JSON Tree (fold/unfold + total object/array/value count), + copy. */
export function bodyView(decrypted, raw, res) {
  const container = el("div");
  const bar = el("div", "dsection-title");
  bar.style.border = "none";
  bar.style.marginBottom = "4px";
  const toggle = el("button", "linkbtn");
  bar.appendChild(toggle);

  // Preview / Tree: offer a sortable/filterable table and a collapsible tree
  // beside the raw/decrypted toggle whenever there's JSON to show them for.
  // Falls back to the raw text when there's no decrypted text (e.g. a
  // response that was never encrypted in the first place) so both stay
  // available in that case too.
  const bodyText = decrypted != null ? decrypted : raw;
  const tableNode = jsonTableView(bodyText);
  const treeNode = jsonTreeView(bodyText);
  let preview = null, treeBtn = null;
  if (tableNode) {
    preview = el("button", "linkbtn", "Preview");
    preview.title = "Show as a sortable / filterable table";
    tableNode.hidden = true;
    bar.appendChild(preview);
  }
  if (treeNode) {
    treeBtn = el("button", "linkbtn", "Tree");
    treeBtn.title = "Show as a collapsible tree with object/array counts";
    treeNode.hidden = true;
    bar.appendChild(treeBtn);
  }

  const copy = el("button", "linkbtn", "Copy");
  bar.appendChild(copy);
  container.appendChild(bar);

  const pre = el("pre", "body");
  container.appendChild(pre);
  // The default raw/decrypted display: a line-numbered, per-line-foldable
  // code view when that text is JSON (built fresh per render since raw and
  // decrypted can each independently be JSON or not), falling back to the
  // plain `pre` above for non-JSON text and the decrypt-error case.
  const codeHolder = el("div");
  codeHolder.hidden = true;
  container.appendChild(codeHolder);
  if (tableNode) container.appendChild(tableNode);
  if (treeNode) container.appendChild(treeNode);

  let showingRaw = decrypted == null;
  let showTable = false;
  let showTree = false;
  function render() {
    if (tableNode) {
      tableNode.hidden = !showTable;
      preview.classList.toggle("active", showTable);
    }
    if (treeNode) {
      treeNode.hidden = !showTree;
      treeBtn.classList.toggle("active", showTree);
    }
    // Keep the raw/decrypted toggle visible & correctly labelled even while the
    // Preview table or Tree is shown, so users can jump straight back to raw/decrypted.
    const rawMode = showingRaw || decrypted == null;
    toggle.textContent = rawMode ? "View decrypted" : "View raw";
    if (showTable || showTree) {
      pre.style.display = "none";
      codeHolder.hidden = true;
      return;
    }

    const isErr = rawMode && decrypted == null && res && !res.ok;
    const activeText = rawMode ? raw : decrypted;
    const codeNode = isErr ? null : jsonCodeView(activeText || "");
    if (codeNode) {
      pre.style.display = "none";
      codeHolder.innerHTML = "";
      codeHolder.appendChild(codeNode);
      codeHolder.hidden = false;
      return;
    }
    codeHolder.hidden = true;
    pre.style.display = "";
    if (isErr) {
      pre.classList.add("error");
      pre.innerHTML =
        `<span class="note">[could not decrypt: ${escapeHtml(res.error)}]\nShowing raw bytes:</span>\n\n` +
        formatBody(raw || "(empty)");
    } else {
      pre.classList.remove("error");
      pre.innerHTML = formatBody(activeText || "(empty)");
    }
  }
  render();
  // Clicking the raw/decrypted toggle always leaves the Preview table / Tree view.
  toggle.addEventListener("click", () => { showTable = false; showTree = false; showingRaw = !showingRaw; render(); });
  if (preview) preview.addEventListener("click", () => { showTable = !showTable; showTree = false; render(); });
  if (treeBtn) treeBtn.addEventListener("click", () => { showTree = !showTree; showTable = false; render(); });
  copy.addEventListener("click", () => {
    const text = showingRaw || decrypted == null ? raw || "" : decrypted;
    navigator.clipboard.writeText(prettyText(text)).then(() => {
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
    pre.innerHTML = formatBody(decrypted);
    btn.textContent = open ? "Hide source" : "View decrypted source";
  });
  wrap.appendChild(btn);
  wrap.appendChild(pre);
  return wrap;
}

/* ------------------------------- preview ------------------------------ */
async function renderPreview(entry, seq) {
  const { s, h } = section("Preview");
  const holder = el("div");
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

  const trimmed = text.trim();
  const tree = trimmed && (trimmed[0] === "{" || trimmed[0] === "[") ? jsonTreeView(trimmed) : null;
  if (tree) {
    holder.appendChild(tree);
  } else {
    const pre = el("pre", "body");
    pre.textContent = text;
    holder.appendChild(pre);
  }
}

/* ------------------------------- timing ------------------------------- */
function renderTiming(entry) {
  if (!entry.har) {
    const { s } = section("Timing");
    els.detailContent.appendChild(s);
    s.appendChild(el("div", "muted-block", "Request is still pending — timing appears once it finishes."));
    return;
  }
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
export function cookiesOf(entry, which) {
  if (which === "request") {
    const har = entry.har && entry.har.request.cookies;
    if (har && har.length) return har;
    const h = entry.reqHeaders.find((x) => /^cookie$/i.test(x.name));
    return h ? parseCookiePairs(h.value) : [];
  }
  const har = entry.har && entry.har.response.cookies;
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
  const init = entry.har && entry.har._initiator;
  const { s } = section("Initiator");
  els.detailContent.appendChild(s);
  if (!init) {
    if (entry.initiator) {
      // Pending rows only know the initiating origin (from webRequest).
      const grid = el("div", "kv");
      grid.appendChild(el("div", "k", "Origin"));
      grid.appendChild(el("div", "v code", entry.initiator));
      s.appendChild(grid);
    } else {
      s.appendChild(el("div", "muted-block", "Initiator information not available for this request."));
    }
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

/* ------------------------------- wiring ------------------------------- */
els.detailTabs.querySelectorAll(".dtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.activeTab = btn.dataset.tab;
    els.detailTabs.querySelectorAll(".dtab").forEach((b) => b.classList.toggle("active", b === btn));
    renderDetail();
  });
});
