// services/filters.js — the filter engine: the Chrome-style filter mini-language,
// resource-type pills, "More filters" toggles, and the row-visibility predicate.

import { state } from "../core/state.js";
import { els } from "../core/els.js";
import { el } from "../core/dom.js";
import { hostOf, schemeOf, typeOf, nameOf } from "../core/format.js";
import { saveSettings } from "./storage.js";

/* ----------------------------- filter engine -------------------------- */
// Recognized `key:value` filters (PRD §5). Anything else is a plain
// substring match against the URL. A leading `-` negates a term.
const FILTER_KEYS = new Set([
  "method", "status-code", "status", "domain", "host", "scheme", "protocol",
  "mime-type", "mimetype", "larger-than", "smaller-than", "has-response-header",
  "has-request-header", "is", "encrypted", "decrypted", "api", "tag", "hash",
]);

export function parseFilter(text) {
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
      return !!entry.har && (entry.har.response.httpVersion || "").toLowerCase().includes(v);
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
      if (v === "running") return !!entry.pending && !entry.failed; // still in flight
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
  if (!entry.har) return false; // still pending
  if (entry.har._fromCache) return true; // Chrome marks cached entries ("memory"/"disk")
  const ts = entry.har.response && entry.har.response._transferSize;
  return ts === 0 && entry.status > 0;
}

export function applyFilter() {
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
// webRequest's `type` values -> the devtools _resourceType vocabulary, so
// pending rows sort into the same pills/labels their finished form will use.
const WEBREQUEST_TYPE = {
  xmlhttprequest: "xhr",
  main_frame: "document",
  sub_frame: "document",
  stylesheet: "stylesheet",
  script: "script",
  image: "image",
  font: "font",
  media: "media",
  websocket: "websocket",
};
function resourceTypeOf(entry) {
  const rt = ((entry.har && entry.har._resourceType) || "").toLowerCase();
  if (rt) return rt;
  if (entry.resourceType) return WEBREQUEST_TYPE[entry.resourceType] || "other";
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
export function typeLabel(entry) {
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
  if (entry.failed) return true; // webRequest reported a net error
  if (!entry.har) return false;  // still in flight — not blocked (yet)
  if (entry.status === 0) return true; // failed / blocked (incl. our Offline rule)
  const r = entry.har.response;
  return !!(r && (r._error || r.status === 0));
}
function hasBlockedResponseCookies(entry) {
  const r = entry.har && entry.har.response;
  const list = r && (r._blockedResponseCookies || r._blockedCookies);
  return Array.isArray(list) && list.length > 0;
}

/* ------------------- hide URL patterns (§33) -------------------------- */
// One line per pattern. A line with `*` is an anchored, case-insensitive glob
// (`*` matches any run of characters); a line without `*` is a case-insensitive
// substring match, so query strings after the pasted URL still get caught.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function compileUrlPattern(line) {
  const s = String(line).trim();
  if (!s) return null;
  if (s.includes("*")) {
    return { glob: new RegExp("^" + s.split("*").map(escapeRegExp).join(".*") + "$", "i") };
  }
  return { sub: s.toLowerCase() };
}
function urlHiddenByPattern(url) {
  for (const m of state.hideUrlMatchers) {
    if (m.sub ? url.toLowerCase().includes(m.sub) : m.glob.test(url)) return true;
  }
  return false;
}
function compileHideUrlMatchers() {
  state.hideUrlMatchers = state.hideUrlPatterns.map(compileUrlPattern).filter(Boolean);
}
function matchesMoreFilters(entry) {
  const mf = state.moreFilters;
  if (mf.hideData && /^data:/i.test(entry.url)) return false;
  if (mf.hideExt && /^(chrome-extension|moz-extension|extension):\/\//i.test(entry.url)) return false;
  if (mf.blockedReq && !isBlockedRequest(entry)) return false;
  if (mf.blockedCookies && !hasBlockedResponseCookies(entry)) return false;
  if (mf.thirdParty && state.pageHost && !isThirdParty(entry)) return false;
  if (state.hideUrlMatchers.length && urlHiddenByPattern(entry.url)) return false;
  return true;
}

// Single row-visibility predicate (filter + type pills + more filters + search).
export function rowHidden(entry) {
  return (
    !matchesFilter(entry) ||
    !matchesTypeFilter(entry) ||
    !matchesMoreFilters(entry) ||
    (state.onlyEncrypted && !entry.maybeEncrypted) ||
    (state.search.matchIds && !state.search.matchIds.has(entry.id))
  );
}

// Type pills / more-filter toggles are discrete click events, not a rapid
// stream — save immediately rather than debouncing. A debounced save risks
// losing the write entirely: if DevTools closes before the timer fires, the
// pending setTimeout is torn down with the page and chrome.storage.local.set
// never runs.
function persistFilters() {
  saveSettings({ typeFilters: [...state.typeFilters], moreFilters: state.moreFilters });
}
export function renderTypePills() {
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
export function updateMoreFiltersBtn() {
  const any = Object.values(state.moreFilters).some(Boolean) || state.hideUrlPatterns.length > 0;
  els.moreFiltersBtn.classList.toggle("has-active", any);
}
export function syncMoreFilterChecks() {
  els.moreFiltersMenu.querySelectorAll("input[data-mf]").forEach((cb) => {
    cb.checked = !!state.moreFilters[cb.dataset.mf];
    cb.closest("label").classList.toggle("active", cb.checked);
  });
}
// Restore the hide-URL list into the textarea and (re)compile its matchers.
export function syncHideUrlList() {
  compileHideUrlMatchers();
  els.hideUrlList.value = state.hideUrlPatterns.join("\n");
}
export function refreshPageHost() {
  try {
    chrome.devtools.inspectedWindow.eval("location.hostname", (res, err) => {
      if (!err && typeof res === "string") {
        state.pageHost = res;
        if (state.moreFilters.thirdParty) applyFilter();
      }
    });
  } catch { /* ignore */ }
}

/* ------------------------------- wiring ------------------------------- */
els.filter.addEventListener("input", () => {
  state.filter = els.filter.value.trim();
  state.filterTerms = parseFilter(state.filter);
  applyFilter();
});
els.onlyApi.addEventListener("change", () => {
  state.onlyEncrypted = els.onlyApi.checked;
  applyFilter();
});
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
// §33 Hide URL patterns: live-filter + save immediately (same reasoning as
// persistFilters — no debounce that could lose the write when DevTools closes).
els.hideUrlList.addEventListener("input", () => {
  state.hideUrlPatterns = els.hideUrlList.value.split("\n").map((s) => s.trim()).filter(Boolean);
  compileHideUrlMatchers();
  saveSettings({ hideUrlPatterns: state.hideUrlPatterns });
  updateMoreFiltersBtn();
  applyFilter();
});
document.addEventListener("click", () => { els.moreFiltersMenu.hidden = true; });
