// ui/jsonTable.js — render any parsed JSON value as a sortable + per-column-
// filterable table (a lightweight data grid). Returns null only when the text
// isn't valid JSON at all, so callers can fall back to a text/pre view.
//
// Shapes handled:
//   [ {..}, {..} ]  -> columns = union of keys, one row per object
//   [ 1, 2, 3 ]     -> a single "Value" column
//   { a: 1, b: 2 }  -> a two-column Key / Value table
//   [] / {}         -> an empty table (0 rows)
//   "x" / 1 / true  -> a single "Value" column, one row

import { el } from "../core/dom.js";
import { escapeHtml } from "../core/format.js";

function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Normalise any parsed JSON value into { columns, rows }. Always succeeds so
// the Preview table is available for every JSON shape, not just "tabular" ones.
function toTable(value) {
  if (Array.isArray(value)) {
    if (!value.length) return { columns: ["Value"], rows: [] };
    if (value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) {
      const cols = [];
      const seen = new Set();
      for (const obj of value) for (const k of Object.keys(obj)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
      return { columns: cols, rows: value.map((obj) => cols.map((c) => cellText(obj[c]))) };
    }
    return { columns: ["Value"], rows: value.map((v) => [cellText(v)]) };
  }
  if (value !== null && typeof value === "object") {
    return { columns: ["Key", "Value"], rows: Object.entries(value).map(([k, v]) => [k, cellText(v)]) };
  }
  return { columns: ["Value"], rows: [[cellText(value)]] };
}

// Numeric-aware comparison for sorting cell strings.
function cmp(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (a !== "" && b !== "" && !isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

// Build the interactive table element from { columns, rows }.
function buildTable(columns, rows) {
  const wrap = el("div", "jtable-wrap");
  const table = el("table", "jtable");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  const filters = columns.map(() => "");
  let sortCol = -1, sortDir = 0; // dir: 1 asc, -1 desc, 0 none

  const htr = el("tr");
  const arrows = [];
  columns.forEach((col, ci) => {
    const th = el("th");
    const hdr = el("div", "jt-h");
    const arrow = el("span", "jt-h-arrow");
    hdr.append(el("span", "jt-h-label", col), arrow);
    hdr.title = "Sort";
    hdr.addEventListener("click", () => {
      if (sortCol === ci) { sortDir = sortDir === 1 ? -1 : sortDir === -1 ? 0 : 1; if (sortDir === 0) sortCol = -1; }
      else { sortCol = ci; sortDir = 1; }
      update();
    });
    const fin = el("input", "jt-filter");
    fin.type = "text";
    fin.placeholder = "filter";
    fin.spellcheck = false;
    fin.addEventListener("input", () => { filters[ci] = fin.value; update(); });
    th.append(hdr, fin);
    htr.appendChild(th);
    arrows.push(arrow);
  });
  thead.appendChild(htr);
  table.append(thead, tbody);
  wrap.appendChild(table);
  const count = el("div", "jtable-count");
  wrap.appendChild(count);

  function update() {
    let view = rows.map((cells) => cells);
    columns.forEach((_, ci) => {
      const f = filters[ci].trim().toLowerCase();
      if (f) view = view.filter((cells) => cells[ci].toLowerCase().includes(f));
    });
    if (sortCol >= 0 && sortDir !== 0) view = view.slice().sort((a, b) => cmp(a[sortCol], b[sortCol]) * sortDir);
    arrows.forEach((a, ci) => { a.textContent = ci === sortCol ? (sortDir === 1 ? "▲" : "▼") : ""; });
    tbody.innerHTML = "";
    for (const cells of view) {
      const tr = el("tr");
      for (const c of cells) tr.appendChild(el("td", null, c));
      tbody.appendChild(tr);
    }
    count.textContent = view.length === rows.length ? `${rows.length} row(s)` : `${view.length} of ${rows.length} row(s)`;
  }
  update();
  return wrap;
}

// Parse `text` as JSON and return a table element for any JSON shape, or null
// if `text` isn't valid JSON at all.
export function jsonTableView(text) {
  let data;
  try {
    const t = String(text).trim();
    if (!t) return null;
    data = JSON.parse(t);
  } catch { return null; }
  const table = toTable(data);
  return buildTable(table.columns, table.rows);
}

// ---------------- JSON tree (collapsible, fold/unfold + total counts) ----------------

// Recursively tally every object, array and scalar value in the parsed tree
// (root included), so the summary reflects the whole document, not just the
// top level.
function countTree(value) {
  let objects = 0, arrays = 0, values = 0;
  (function walk(v) {
    if (v !== null && typeof v === "object") {
      if (Array.isArray(v)) { arrays++; v.forEach(walk); }
      else { objects++; Object.values(v).forEach(walk); }
    } else {
      values++;
    }
  })(value);
  return { objects, arrays, values };
}

function countLabel({ objects, arrays, values }) {
  const parts = [];
  if (objects) parts.push(`${objects} object${objects === 1 ? "" : "s"}`);
  if (arrays) parts.push(`${arrays} array${arrays === 1 ? "" : "s"}`);
  parts.push(`${values} value${values === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

// JSON tree node with collapse/expand. Branches toggle on click; leaves are
// colored by type.
function buildTreeNode(value, keyLabel) {
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
    for (const [k, v] of entries) children.appendChild(buildTreeNode(v, String(k)));
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

// Parse `text` as JSON and return a collapsible tree view — Expand all /
// Collapse all controls plus a total object/array/value count above a
// click-to-fold tree — or null if `text` isn't valid JSON at all.
export function jsonTreeView(text) {
  let data;
  try {
    const t = String(text).trim();
    if (!t) return null;
    data = JSON.parse(t);
  } catch { return null; }

  const wrap = el("div", "jtree-wrap");
  const bar = el("div", "preview-bar");
  const exp = el("button", "linkbtn", "Expand all");
  const col = el("button", "linkbtn", "Collapse all");
  const count = el("span", "jt-summary", countLabel(countTree(data)));
  bar.append(exp, col, count);
  const tree = el("div", "jt");
  tree.appendChild(buildTreeNode(data, null));
  exp.addEventListener("click", () => setTreeOpen(tree, true));
  col.addEventListener("click", () => setTreeOpen(tree, false));
  wrap.append(bar, tree);
  return wrap;
}

// ---------------- JSON code view (code-editor-style folding) ----------------
//
// Renders real JSON source — braces, brackets, commas, colons — with a fold
// arrow in the gutter on every line that opens a non-empty object/array.
// Built recursively from the parsed value (not by matching brackets in
// pretty-printed text): each object/array becomes an open row + a
// `.jc-children` container + a close row, mirroring buildTreeNode's
// row/children split. That nesting is what makes fold state survive a
// parent re-expanding — collapsing a parent only toggles its own children
// container's display, so a nested region left folded stays folded
// underneath, exactly like a real code editor.

function jcToken(value) {
  const type = value === null ? "null" : typeof value;
  const cls = type === "number" ? "tok-num" : type === "boolean" ? "tok-bool" : type === "null" ? "tok-null" : "tok-str";
  const text = value === null ? "null" : type === "string" ? JSON.stringify(value) : String(value);
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

// One gutter+content row. `foldable` gets a clickable ▾ arrow; other rows get
// a same-width spacer so content columns still line up.
function jcRow(foldable) {
  const row = el("div", "jc-row");
  const gutter = el("div", "jc-gutter");
  const tri = el("span", foldable ? "jc-tri" : "jc-tri-spacer", foldable ? "▾" : null);
  gutter.appendChild(tri);
  const content = el("div", "jc-content");
  row.append(gutter, content);
  return { row, content, tri };
}

// Recursively build rows for `value` (a key/isLast pair positions it within
// its parent so the key prefix and trailing comma render correctly).
function buildCodeValue(value, key, isLast) {
  const keyHtml = key != null ? `<span class="tok-key">${escapeHtml(JSON.stringify(String(key)))}</span><span class="jc-punct">: </span>` : "";
  const commaHtml = isLast ? "" : `<span class="jc-punct">,</span>`;
  const isObj = value !== null && typeof value === "object";

  if (!isObj) {
    const { row, content } = jcRow(false);
    content.innerHTML = keyHtml + jcToken(value) + commaHtml;
    return row;
  }

  const isArr = Array.isArray(value);
  const entries = isArr ? value.map((v, i) => [null, v]) : Object.entries(value);
  const openCh = isArr ? "[" : "{";
  const closeCh = isArr ? "]" : "}";

  if (!entries.length) {
    const { row, content } = jcRow(false);
    content.innerHTML = `${keyHtml}<span class="jc-punct">${openCh}${closeCh}</span>${commaHtml}`;
    return row;
  }

  const frag = document.createDocumentFragment();
  const openRow = jcRow(true);
  const expandedHtml = `${keyHtml}<span class="jc-punct">${openCh}</span>`;
  openRow.content.innerHTML = expandedHtml;
  frag.appendChild(openRow.row);

  const children = el("div", "jc-children");
  entries.forEach(([k, v], idx) => children.appendChild(buildCodeValue(v, k, idx === entries.length - 1)));
  frag.appendChild(children);

  const closeRow = jcRow(false);
  closeRow.content.innerHTML = `<span class="jc-punct">${closeCh}</span>${commaHtml}`;
  frag.appendChild(closeRow.row);

  let open = true;
  const itemWord = `${entries.length} item${entries.length === 1 ? "" : "s"}`;
  const collapsedHtml = `${keyHtml}<span class="jc-punct">${openCh}</span><span class="jc-fold" title="${itemWord}">&hellip;</span><span class="jc-punct">${closeCh}</span>${commaHtml}`;
  openRow.tri.addEventListener("click", () => {
    open = !open;
    openRow.tri.textContent = open ? "▾" : "▸";
    openRow.content.innerHTML = open ? expandedHtml : collapsedHtml;
    children.style.display = open ? "" : "none";
    closeRow.row.style.display = open ? "" : "none";
  });

  return frag;
}

// Parse `text` as JSON and return a per-line-foldable code view (real JSON
// punctuation, gutter fold arrows), or null if `text` isn't valid JSON at all.
export function jsonCodeView(text) {
  let data;
  try {
    const t = String(text).trim();
    if (!t) return null;
    data = JSON.parse(t);
  } catch { return null; }
  const wrap = el("div", "jc");
  wrap.appendChild(buildCodeValue(data, null, true));
  return wrap;
}
