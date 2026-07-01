// ui/table.js — the request list view: the resizable/reorderable/sortable column
// table, row rendering, the list↔detail splitter, selection, and clearing.

import { state, DEFAULT_LIST_WIDTH } from "../core/state.js";
import { els } from "../core/els.js";
import { el, debounce } from "../core/dom.js";
import { nameOf, fmtSize, fmtTime } from "../core/format.js";
import { typeLabel, rowHidden } from "../services/filters.js";
import { saveSettings } from "../services/storage.js";
import { renderDetail } from "./detail.js";

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
export const COLUMN_MAP = Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c]));
const MIN_COL_WIDTH = 40;

export function defaultColumns() {
  return {
    order: COLUMN_DEFS.map((c) => c.id),
    widths: Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.width])),
    visible: Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.visible])),
  };
}
// Merge persisted layout over defaults so newly added columns still appear.
export function normalizeColumns(saved) {
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
const persistColumns = debounce(() => saveSettings({ columns: state.columns }), 250);

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
export function renderHead() {
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
    els.reqHead.appendChild(th);
  }
  els.reqTable.style.width = total + "px";
  renderColResizers();
}

// Full-height resize handles overlaid on each column's right border, so a column
// can be resized by dragging the border at ANY vertical position (not just the
// header). The overlay lives inside #listInner (which is sized to the table), so
// the handles span the whole table height and scroll with it.
function renderColResizers() {
  const layer = els.colResizers;
  if (!layer) return;
  layer.innerHTML = "";
  for (const col of visibleColumns()) {
    const h = el("div", "col-resizer");
    h.dataset.col = col.id;
    h.title = "Drag to resize · double-click to auto-fit";
    layer.appendChild(h);
  }
  positionColResizers();
}
// Place each handle at its column's cumulative right-edge x (called on resize too).
function positionColResizers() {
  const layer = els.colResizers;
  if (!layer) return;
  const handles = layer.children;
  let x = 0, i = 0;
  for (const col of visibleColumns()) {
    x += state.columns.widths[col.id] || col.width;
    if (handles[i]) handles[i].style.left = x + "px";
    i++;
  }
}

/* --- rows --- */
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
export function addRow(entry) {
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
export function rebuildTable() {
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
export const applySortDebounced = debounce(applySort, 120);
function toggleSort(colId) {
  const s = state.sort;
  if (s.col !== colId) { s.col = colId; s.dir = 1; }      // new column → ascending
  else if (s.dir === 1) s.dir = -1;                       // asc → desc
  else { s.col = null; s.dir = 0; }                       // desc → off
  saveSettings({ sort: s });
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
  positionColResizers();
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
els.colResizers.addEventListener("mousedown", (e) => {
  const h = e.target.closest(".col-resizer");
  if (!h) return;
  e.preventDefault();
  e.stopPropagation();
  suppressColDrag = true; // don't let the header start a reorder drag
  const id = h.dataset.col;
  colResize = { id, startX: e.clientX, startW: state.columns.widths[id] || COLUMN_MAP[id].width };
  document.body.classList.add("col-resizing");
});
els.colResizers.addEventListener("dblclick", (e) => {
  const h = e.target.closest(".col-resizer");
  if (h) autoFitColumn(h.dataset.col);
});
els.reqHead.addEventListener("click", (e) => {
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
    saveSettings({ layout: state.layout });
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
  saveSettings({ layout: state.layout });
});

export function selectEntry(id) {
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

/* ------------------------------- count + clear ------------------------ */
export function updateCount() {
  const n = state.entries.length;
  els.count.textContent = `${n} request${n === 1 ? "" : "s"}`;
  els.empty.style.display = n ? "none" : "block";
}
export function clearRequests() {
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

/* ------------------------------- wiring ------------------------------- */
els.clearBtn.addEventListener("click", clearRequests);
els.pauseBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  els.pauseBtn.classList.toggle("recording", !state.paused);
  els.pauseBtn.title = state.paused ? "Resume capturing" : "Stop capturing";
});
els.closeDetail.addEventListener("click", closeDetail);
