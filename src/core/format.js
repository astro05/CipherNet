// core/format.js — pure formatting / parsing helpers (no DOM, no state).

export function nameOf(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return (seg || u.pathname || u.hostname) + (u.search ? u.search : "");
  } catch {
    return url;
  }
}
export function rawQuery(url) {
  const i = url.indexOf("?");
  return i >= 0 ? url.slice(i + 1) : "";
}
export function hostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }
export function schemeOf(url) { try { return new URL(url).protocol.replace(":", ""); } catch { return ""; } }
export function typeOf(mime) {
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
export function fmtSize(bytes) {
  if (bytes == null || bytes < 0) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " kB";
  return (bytes / 1048576).toFixed(2) + " MB";
}
export function fmtTime(ms) {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000) return Math.round(ms) + " ms";
  return (ms / 1000).toFixed(2) + " s";
}
export function looksEncrypted(s) {
  if (!s) return false;
  const t = s.trim();
  // Base64-ish, reasonably long, not obvious JSON/text.
  return t.length >= 16 && /^[A-Za-z0-9+/=\s%]+$/.test(t) && t[0] !== "{" && t[0] !== "[";
}
export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function formatBody(text) {
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
export function safeDecode(s) { try { return decodeURIComponent(s); } catch { return null; } }
export function safeAtob(b64) { try { return atob(b64); } catch { return b64; } }
// Drop a single pair of surrounding double-quotes (CipherNet sometimes returns the
// ciphertext as a JSON string).
export function stripQuotes(s) {
  const t = String(s).trim();
  return t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"' ? t.slice(1, -1) : t;
}
