// services/search.js — global full-text search across URL, headers, cookies and
// the (decrypted) bodies, with prev/next navigation and in-pane highlighting.

import { state } from "../core/state.js";
import { els } from "../core/els.js";
import { debounce } from "../core/dom.js";
import { applyFilter } from "./filters.js";
import { gatherDecrypted } from "./capture.js";
import { renderDetail, cookiesOf } from "../ui/detail.js";
import { selectEntry } from "../ui/table.js";

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
export async function runSearch() {
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
export const searchDebounced = debounce(runSearch, 200);

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
export function maybeHighlight() {
  if (state.search.active && state.search.regex) highlightDetail();
}

/* ------------------------------- wiring ------------------------------- */
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
