# 27. Network Controls (Chrome DevTools Equivalent)

The CipherNet panel must provide the same network control features as Chrome DevTools.

### Preserve Log

Add a **"Preserve log"** checkbox.

Behavior:

* When enabled, network requests remain in the request list after page navigation or reload.
* Requests are only cleared when the user clicks **Clear**.
* Persist the setting across DevTools sessions using Chrome Storage.
* Default: Disabled.

---

### Disable Cache

Add a **"Disable cache"** checkbox.

Behavior:

* When enabled and the CipherNet panel is open, browser caching should be disabled for the inspected page, matching Chrome DevTools behavior.
* Apply to all resource types (HTML, JS, CSS, Images, Fonts, XHR, Fetch, etc.).
* Use the Chrome Debugger Protocol (`Network.setCacheDisabled`) when available.
* Display the current cache state in the toolbar.
* Persist the setting across sessions.
* Default: Disabled.

---

### Network Throttling

Add a network throttling dropdown identical to Chrome DevTools.

Supported presets:

* No throttling
* Offline
* Fast 5G
* Slow 5G
* Fast 4G
* Slow 4G
* 3G
* Slow 3G
* Custom...

Each profile should define:

* Download speed
* Upload speed
* Latency

Example:

| Profile       |  Download |    Upload |  Latency |
| ------------- | --------: | --------: | -------: |
| No throttling | Unlimited | Unlimited |     0 ms |
| Fast 5G       |  100 Mbps |   50 Mbps |    20 ms |
| Slow 5G       |   25 Mbps |   10 Mbps |    40 ms |
| Fast 4G       |   10 Mbps |    5 Mbps |    80 ms |
| Slow 4G       |    4 Mbps |    3 Mbps |   150 ms |
| 3G            |  1.5 Mbps |  750 Kbps |   300 ms |
| Slow 3G       |  400 Kbps |  400 Kbps |  2000 ms |
| Offline       |         0 |         0 | Infinite |

Requirements:

* Use the Chrome DevTools Protocol (`Network.emulateNetworkConditions`) or the latest supported network emulation API.
* Apply throttling immediately without requiring a page reload.
* Display the active profile in the toolbar.
* Persist the selected profile across DevTools sessions.

---

### Toolbar

The toolbar should closely match Chrome DevTools and include:

* Record (Start/Stop Capture)
* Clear
* Preserve Log
* Disable Cache
* Network Throttling dropdown
* Filter
* Search
* Export
* Import
* Settings

Toolbar behavior should match Chrome DevTools as closely as possible, including keyboard shortcuts, icons, and interaction patterns.

---

### Rule Enforcement & Cleanup

Because Chrome won't let an extension attach the debugger while DevTools is open, CDP-based
shaping (`Network.setCacheDisabled`, `Network.emulateNetworkConditions`) is unavailable when the
panel is active. Enforcement therefore uses `declarativeNetRequest` **session** rules scoped to
the inspected tab (`tabIds`):

* **Disable cache** → a `modifyHeaders` rule injecting no-cache headers.
* **Offline** → a `block` rule blocking every resource type, including `main_frame`, so the tab
  shows Chrome's "This page has been blocked by an extension" page while Offline is active.
* Bandwidth/latency presets remain informational (a note in the toolbar explains why).

Cleanup requirements (a tab must **never** remain blocked after DevTools goes away):

* Rule IDs are derived from the inspected tab ID (`tabId * 2 + 1` cache, `tabId * 2 + 2` offline),
  so several panels on different tabs don't overwrite each other's rules.
* The authoritative cleanup runs in the **background service worker**: when the last live-relay
  port for a tab disconnects (the panel's context is gone), the worker removes that tab's two
  session rules. Port disconnect fires reliably even when the panel page is destroyed without
  `pagehide`/`unload` (closing or undocking DevTools).
* The panel's own `pagehide` handler removes the same rules as a fallback; double removal is a
  no-op.
* On panel reopen the persisted settings re-apply the rules (`applyDisableCache` / `applyThrottle`),
  so a saved "Offline" selection still blocks while the panel is open.

### Performance Requirements

* Switching throttle profiles should take effect immediately.
* Preserve Log should not impact UI performance, even with 100,000+ captured requests.
* Cache state and network profile should remain synchronized with the browser.
* All control states must be restored automatically when DevTools is reopened.
