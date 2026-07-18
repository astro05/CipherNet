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
function tryPrettyJson(text) {
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return null; }
}
// Pretty-print JSON text with 2-space indentation (matching the Response tab's
// display); returns the text unchanged when it isn't parseable JSON.
export function prettyText(text) {
  return tryPrettyJson(text) ?? text;
}
export function formatBody(text) {
  const json = tryPrettyJson(text);
  const isJson = json != null;
  const esc = escapeHtml(isJson ? json : text);
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
// HTTP status reason phrases (RFC 9110 + common extensions), used for the
// hover tooltip that explains what a status code means.
const STATUS_PHRASES = {
  100: "Continue", 101: "Switching Protocols", 102: "Processing", 103: "Early Hints",
  200: "OK", 201: "Created", 202: "Accepted", 203: "Non-Authoritative Information",
  204: "No Content", 205: "Reset Content", 206: "Partial Content", 207: "Multi-Status",
  208: "Already Reported", 226: "IM Used",
  300: "Multiple Choices", 301: "Moved Permanently", 302: "Found", 303: "See Other",
  304: "Not Modified", 305: "Use Proxy", 307: "Temporary Redirect", 308: "Permanent Redirect",
  400: "Bad Request", 401: "Unauthorized", 402: "Payment Required", 403: "Forbidden",
  404: "Not Found", 405: "Method Not Allowed", 406: "Not Acceptable",
  407: "Proxy Authentication Required", 408: "Request Timeout", 409: "Conflict",
  410: "Gone", 411: "Length Required", 412: "Precondition Failed", 413: "Content Too Large",
  414: "URI Too Long", 415: "Unsupported Media Type", 416: "Range Not Satisfiable",
  417: "Expectation Failed", 418: "I'm a Teapot", 421: "Misdirected Request",
  422: "Unprocessable Content", 423: "Locked", 424: "Failed Dependency", 425: "Too Early",
  426: "Upgrade Required", 428: "Precondition Required", 429: "Too Many Requests",
  431: "Request Header Fields Too Large", 451: "Unavailable For Legal Reasons",
  500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout", 505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates", 507: "Insufficient Storage", 508: "Loop Detected",
  510: "Not Extended", 511: "Network Authentication Required",
};
const STATUS_CLASSES = {
  1: "Informational", 2: "Success", 3: "Redirection", 4: "Client Error", 5: "Server Error",
};
// Reason phrase for an HTTP status code, e.g. 204 → "No Content". Empty for
// unknown codes (browsers leave statusText blank on HTTP/2, so we fill it in).
export function statusPhrase(code) {
  return STATUS_PHRASES[Number(code)] || "";
}
// Human-readable meaning of a status code for a hover tooltip, e.g.
// 204 → "204 No Content". Falls back to the status class ("418 Client Error"
// style) for codes not in the table, and "" when there's no code to explain.
export function statusTitle(code) {
  const n = Number(code);
  if (!n) return "";
  const phrase = STATUS_PHRASES[n];
  if (phrase) return `${n} ${phrase}`;
  const cls = STATUS_CLASSES[Math.floor(n / 100)];
  return cls ? `${n} ${cls}` : String(n);
}
export function safeDecode(s) { try { return decodeURIComponent(s); } catch { return null; } }
export function safeAtob(b64) { try { return atob(b64); } catch { return b64; } }
// Drop a single pair of surrounding double-quotes (CipherNet sometimes returns the
// ciphertext as a JSON string).
export function stripQuotes(s) {
  const t = String(s).trim();
  return t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"' ? t.slice(1, -1) : t;
}
