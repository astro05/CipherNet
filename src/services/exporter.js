// services/exporter.js — export the captured (or currently filtered) requests as
// HAR / JSON / CSV / a decrypted session, and wire the Export dropdown.

import { state } from "../core/state.js";
import { els } from "../core/els.js";
import { typeOf, nameOf } from "../core/format.js";
import { gatherDecrypted } from "./capture.js";

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

/* ------------------------------- wiring ------------------------------- */
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
