// core/state.js — the single mutable app-state store shared across modules.

// No key is baked in — enter it in the 🔑 Key box (persisted via chrome.storage).
export const DEFAULT_KEY = "";
export const DEFAULT_IV = "";
export const DEFAULT_LIST_WIDTH = 320;
export const DEFAULT_KV_KEY_WIDTH = 180; // detail-pane kv label column width (Headers, Payload, Initiator)

export const state = {
  key: DEFAULT_KEY,
  iv: DEFAULT_IV,
  filter: "",
  filterTerms: [],
  onlyEncrypted: false,
  // §ImageRequest — Chrome-style resource-type pills + "More filters" toggles.
  typeFilters: new Set(), // selected pill ids; empty == "All"
  moreFilters: { hideData: false, hideExt: false, blockedCookies: false, blockedReq: false, thirdParty: false },
  pageHost: "",
  paused: false,
  entries: [],
  byId: new Map(),
  selectedId: null,
  activeTab: "headers",
  nextId: 1,
  search: {
    active: false,
    regex: null,
    ids: [],          // ordered ids of matching entries (for prev/next)
    matchIds: null,   // Set of matching ids, or null when no search
    total: 0,
    idx: 0,
    opts: { regex: false, caseSensitive: false, wholeWord: false },
  },
  // §26 layout (persisted): list-pane width + per-column order/widths/visibility.
  layout: { listWidth: 0, kvKeyWidth: 0 },
  columns: { order: [], widths: {}, visible: {} },
  sort: { col: null, dir: 0 }, // dir: 1 asc, -1 desc, 0 none (capture order)
  // §27 network controls (persisted).
  preserveLog: false,
  disableCache: false,
  throttle: "none",
};
