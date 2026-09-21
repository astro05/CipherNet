// services/networkControls.js — §27 network controls: Preserve log, Disable cache
// and Throttling. Cache/Offline are enforced via declarativeNetRequest session
// rules scoped to the inspected tab.

import { state } from "../core/state.js";
import { els } from "../core/els.js";
import { saveSettings } from "./storage.js";

// Throttle presets mirror Chrome DevTools (download/upload in bits/s, latency ms).
const THROTTLE_PRESETS = [
  { id: "none", label: "No throttling" },
  { id: "offline", label: "Offline", down: 0, up: 0, latency: 0 },
  { id: "fast5g", label: "Fast 5G", down: 100e6, up: 50e6, latency: 20 },
  { id: "slow5g", label: "Slow 5G", down: 25e6, up: 10e6, latency: 40 },
  { id: "fast4g", label: "Fast 4G", down: 10e6, up: 5e6, latency: 80 },
  { id: "slow4g", label: "Slow 4G", down: 4e6, up: 3e6, latency: 150 },
  { id: "3g", label: "3G", down: 1.5e6, up: 750e3, latency: 300 },
  { id: "slow3g", label: "Slow 3G", down: 400e3, up: 400e3, latency: 2000 },
];
export function populateThrottle() {
  els.throttle.innerHTML = "";
  for (const p of THROTTLE_PRESETS) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    els.throttle.appendChild(o);
  }
}
export function applyThrottleNote() {
  if (state.throttle === "none") { els.throttleNote.textContent = ""; return; }
  if (state.throttle === "offline") { els.throttleNote.textContent = "⛔ Offline — blocking all requests"; return; }
  const p = THROTTLE_PRESETS.find((x) => x.id === state.throttle);
  // Bandwidth/latency shaping needs CDP (Network.emulateNetworkConditions);
  // Chrome won't let an extension attach the debugger while DevTools is open.
  els.throttleNote.textContent = `▲ ${p ? p.label : ""} — bandwidth shaping needs debugger (inactive while DevTools is open)`;
}

// All declarativeNetRequest-controllable resource types.
const ALL_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
];
// §27 Rule IDs are derived from the inspected tab ID so that panels on
// different tabs don't overwrite each other's session rules, and so the
// background worker can clean up exactly one dead panel's rules. background.js
// must keep this derivation in sync.
const CACHE_RULE_ID = 1;
const OFFLINE_RULE_ID = 2;
function cacheRuleId(tabId) { return tabId * 2 + CACHE_RULE_ID; }
function offlineRuleId(tabId) { return tabId * 2 + OFFLINE_RULE_ID; }

function dnrCtx() {
  const dnr = chrome.declarativeNetRequest;
  const tabId = chrome.devtools.inspectedWindow.tabId;
  if (!dnr || !dnr.updateSessionRules || typeof tabId !== "number") return null;
  return { dnr, tabId };
}

// §27 Disable cache: inject no-cache request headers for the inspected tab.
function cacheRule(tabId) {
  return {
    id: cacheRuleId(tabId),
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "Cache-Control", operation: "set", value: "no-cache, no-store, max-age=0" },
        { header: "Pragma", operation: "set", value: "no-cache" },
      ],
    },
    condition: { tabIds: [tabId], resourceTypes: ALL_RESOURCE_TYPES },
  };
}
export function applyDisableCache() {
  const ctx = dnrCtx();
  if (!ctx) { els.disableCache.title = "Disable cache is unavailable in this browser"; return; }
  ctx.dnr.updateSessionRules(
    { removeRuleIds: [cacheRuleId(ctx.tabId)], addRules: state.disableCache ? [cacheRule(ctx.tabId)] : [] },
    () => { void chrome.runtime.lastError; } // swallow unchecked-error warning
  );
}

// §27 Throttling: "Offline" is enforced for real by blocking every request on
// the inspected tab (works while DevTools is open). Bandwidth presets can't be
// shaped without the debugger, so they remain informational.
function offlineRule(tabId) {
  return {
    id: offlineRuleId(tabId),
    priority: 2,
    action: { type: "block" },
    condition: { tabIds: [tabId], resourceTypes: ALL_RESOURCE_TYPES },
  };
}
export function applyThrottle() {
  const ctx = dnrCtx();
  if (!ctx) { els.throttle.title = "Offline throttling is unavailable in this browser"; return; }
  const offline = state.throttle === "offline";
  ctx.dnr.updateSessionRules(
    { removeRuleIds: [offlineRuleId(ctx.tabId)], addRules: offline ? [offlineRule(ctx.tabId)] : [] },
    () => { void chrome.runtime.lastError; }
  );
}

/* ------------------------------- wiring ------------------------------- */
els.throttle.addEventListener("change", () => {
  state.throttle = els.throttle.value;
  saveSettings({ throttle: state.throttle });
  applyThrottleNote();
  applyThrottle();
});
els.preserveLog.addEventListener("change", () => {
  state.preserveLog = els.preserveLog.checked;
  saveSettings({ preserveLog: state.preserveLog });
});
els.disableCache.addEventListener("change", () => {
  state.disableCache = els.disableCache.checked;
  saveSettings({ disableCache: state.disableCache });
  applyDisableCache();
});

// Remove the session rules when the DevTools panel goes away, so a tab is never
// left permanently blocked / no-cache after DevTools closes. This is only a
// fallback: `pagehide` does not reliably fire when the panel page is destroyed,
// so the authoritative cleanup lives in background.js, which removes this tab's
// rules when the panel's live-relay port disconnects (§27).
window.addEventListener("pagehide", () => {
  const ctx = dnrCtx();
  if (ctx) ctx.dnr.updateSessionRules({ removeRuleIds: [cacheRuleId(ctx.tabId), offlineRuleId(ctx.tabId)] });
});
