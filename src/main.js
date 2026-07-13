// main.js — composition root. Imports every feature module (each wires its own
// DOM listeners on import), applies persisted settings, and runs the initial
// render. This is the only module referenced by panel.html.

import "./ui/theme.js"; // first, to set the theme before the panel paints

import { state, DEFAULT_KEY, DEFAULT_IV, DEFAULT_LIST_WIDTH, DEFAULT_KV_KEY_WIDTH } from "./core/state.js";
import { els } from "./core/els.js";
import { loadSettings } from "./services/storage.js";
import {
  renderTypePills, syncMoreFilterChecks, updateMoreFiltersBtn, applyFilter, refreshPageHost,
} from "./services/filters.js";
import {
  populateThrottle, applyThrottleNote, applyDisableCache, applyThrottle,
} from "./services/networkControls.js";
import {
  defaultColumns, normalizeColumns, COLUMN_MAP, rebuildTable, renderHead, updateCount, clearRequests,
} from "./ui/table.js";

// Side-effect imports: these modules wire their own controls when evaluated.
import "./services/capture.js";
import "./services/search.js";
import "./services/exporter.js";
import { applyKvKeyWidth } from "./ui/detail.js";
import "./ui/views.js";
import { refreshKeyIndicator } from "./ui/keyBox.js";
import "./ui/encryptTool.js";
import "./ui/decryptTool.js";

// Apply the persisted settings once chrome.storage has loaded.
function applySettings(saved) {
  state.key = saved.key || DEFAULT_KEY;
  state.iv = saved.iv || DEFAULT_IV;
  els.keyInput.value = state.key;
  els.ivInput.value = state.iv;
  // Nudge the user to set a key on first run (nothing is baked in): open the Key
  // box and blink the 🔑 Key button until a key is saved.
  if (!state.key) els.keysRow.classList.add("open");
  refreshKeyIndicator();

  // §26 layout
  state.columns = normalizeColumns(saved.columns);
  state.layout = saved.layout && saved.layout.listWidth ? saved.layout : { listWidth: DEFAULT_LIST_WIDTH };
  if (!state.layout.kvKeyWidth) state.layout.kvKeyWidth = DEFAULT_KV_KEY_WIDTH;
  if (saved.sort && COLUMN_MAP[saved.sort.col]) state.sort = saved.sort;
  rebuildTable();
  applyKvKeyWidth();

  // §27 network controls
  state.preserveLog = !!saved.preserveLog;
  state.disableCache = !!saved.disableCache;
  state.throttle = saved.throttle || "none";
  els.preserveLog.checked = state.preserveLog;
  els.disableCache.checked = state.disableCache;
  els.throttle.value = state.throttle;
  applyThrottleNote();
  applyDisableCache();
  applyThrottle();

  // resource-type + more filters
  state.typeFilters = new Set(Array.isArray(saved.typeFilters) ? saved.typeFilters : []);
  Object.assign(state.moreFilters, saved.moreFilters || {});
  renderTypePills();
  syncMoreFilterChecks();
  updateMoreFiltersBtn();
  applyFilter();
}

// §27 Preserve log: clear the list on navigation unless Preserve log is on.
if (chrome.devtools && chrome.devtools.network && chrome.devtools.network.onNavigated) {
  chrome.devtools.network.onNavigated.addListener(() => {
    if (!state.preserveLog) clearRequests();
    refreshPageHost(); // the page origin changed → recompute 3rd-party
  });
}

/* -------------------------------- init -------------------------------- */
state.columns = defaultColumns(); // sync default until chrome.storage loads
populateThrottle();
renderHead();
renderTypePills();
refreshPageHost();
updateCount();
loadSettings().then(applySettings);
