// ui/jsonTable.js — render tabular JSON as a sortable + per-column-filterable
// table (a lightweight data grid). Returns null when the text isn't tabular JSON
// so callers can fall back to a text/pre view.
//
// Shapes handled:
//   [ {..}, {..} ]  -> columns = union of keys, one row per object
//   [ 1, 2, 3 ]     -> a single "Value" column
//   { a: 1, b: 2 }  -> a two-column Key / Value table

import { el } from "../core/dom.js";

function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Normalise parsed JSON into { columns, rows } or null when not tabular.
function toTable(value) {
  if (Array.isArray(value)) {
    if (!value.length) return null;
    if (value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) {
      const cols = [];
      const seen = new Set();
      for (const obj of value) for (const k of Object.keys(obj)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
      return { columns: cols, rows: value.map((obj) => cols.map((c) => cellText(obj[c]))) };
    }
    return { columns: ["Value"], rows: value.map((v) => [cellText(v)]) };
  }
  if (value !== null && typeof value === "object") {
    const rows = Object.entries(value).map(([k, v]) => [k, cellText(v)]);
    return rows.length ? { columns: ["Key", "Value"], rows } : null;
  }
  return null;
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

// Parse `text` as JSON and return a table element, or null if it isn't tabular.
export function jsonTableView(text) {
  let data;
  try {
    const t = String(text).trim();
    if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
    data = JSON.parse(t);
  } catch { return null; }
  const table = toTable(data);
  return table ? buildTable(table.columns, table.rows) : null;
}
