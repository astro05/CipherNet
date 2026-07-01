// ui/views.js — the leading toolbar buttons switch the panel between three
// mutually-exclusive views:
//   - "network": the request list + detail pane (the default),
//   - "encrypt": the 🔒 Encrypt URL drawer,
//   - "decrypt": the 🔓 Decrypt drawer.
// The Network panel is shown by default; encryptTool/decryptTool call showView
// to open (or toggle back from) their drawers.

import { els } from "../core/els.js";

let current = "network";
export function currentView() { return current; }

export function showView(name) {
  current = name;
  const isNet = name === "network";

  // Show the network list only in the network view; the drawers live in the
  // toolbar, so hide the main area + resource-type filter row for a focused tool.
  els.main.hidden = !isNet;
  els.filtersRow.hidden = !isNet;
  // The network-only toolbar controls (record/clear/preserve/cache/throttle/
  // search/filter/export) belong to the Network view — hide them in the tools.
  els.netControls.hidden = !isNet;
  // In a tool view the list is hidden, so let the toolbar take the remaining
  // height and scroll when it overflows (see body.tool-open in panel.css).
  document.body.classList.toggle("tool-open", !isNet);

  els.encryptRow.classList.toggle("open", name === "encrypt");
  els.decryptRow.classList.toggle("open", name === "decrypt");

  els.networkBtn.classList.toggle("active", isNet);
  els.encryptToggle.classList.toggle("active", name === "encrypt");
  els.decryptToggle.classList.toggle("active", name === "decrypt");
}

// The Network button always returns to the default request-list view.
els.networkBtn.addEventListener("click", () => showView("network"));
