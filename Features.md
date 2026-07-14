**Version:** 2.14.0 | **Last Modified:** 2026-07-14

# Features

## Appearance
- **Auto theme** — automatically follows DevTools (dark/light) with live switching

## Column Management
- **Reorderable columns** — drag a column header to reorder
- **Resizable columns** — drag any column border at any height (not just header); double-click to auto-fit
- **Sortable columns** — click a header to cycle ascending → descending → off (▲/▼ indicators)
- **Show/hide columns** — right-click a header to toggle visibility
- **Column persistence** — sort order, widths, visibility, and reorder state persist via `chrome.storage`
- **Reset columns** — restore default layout and visibility

## Collections (Saved Requests)
- **Add request** — name a request (API name) and assign it to a folder, then save URL/body/token
- **Collection tree** — dropdown showing all folders and requests in a tree view
- **Delete folder** — remove a folder and all its requests (with 🗑 button)
- **Delete request** — remove a single saved request (with 🗑 button)
- **Load request** — click any API in the tree to load it into the Encrypt URL tool
- **Rename folder** — rename a folder (with ✎ button)
- **Rename request** — rename a saved API request (with ✎ button)
- **Save button** — update a previously saved request after modifying it
- **Save request** — persist URLs, payloads, and Bearer tokens via `chrome.storage.sync`, so Collections survive uninstalling and reinstalling the extension (requires the browser signed in with Chrome Sync enabled — otherwise sync storage behaves like local storage and won't survive uninstall)

## Request History
- **🕘 History button** — beside ➕ Add in the Encrypt URL toolbar; opens a dropdown of the last 100 sent requests, newest first
- **Auto-logged** — every Send Encrypt / Send Decrypt call is logged automatically, no naming needed (unlike Collections)
- **Load from history** — click an entry to reload its URL/payload/Bearer token back into the composer
- **Per-entry delete + Clear all** — remove one entry (🗑) or clear the whole log
- **Survives uninstall** — stored via `chrome.storage.sync` like Collections, same signed-in-profile caveat applies
- **Compact by design** — stores the request (URL/body/token) and a response summary (status/size/time), not the full response body, to stay well inside chrome.storage.sync's 100 KB/8 KB-per-item quota across 100 entries

## Decryption
- **Auto-lenient mode** — when strict decryption fails, automatically retry by trimming to whole 16-byte blocks without PKCS7 validation
- **Decrypted request body** — show the plaintext payload
- **Decrypted request headers** — show decrypted URL and Bearer token in the Headers tab
- **Decrypted response body** — show the plaintext response, pretty-printed if JSON
- **Pretty-printed JSON everywhere** — Response tab, Preview drawer's Body tab, and the 🔓 Decrypt tool all pretty-print + syntax-highlight JSON bodies, whether decrypted or shown raw
- **Decrypted query string** — show plaintext query parameters in a parsed table
- **Encryption detection** — flag encrypted requests with 🔒
- **Web Crypto API** — AES-128-CBC with PKCS7 (mirrors .NET backend)

## Detail Pane Tabs
- **Cookies** — parsed Request and Response (Set-Cookie) cookie tables
- **Headers** — General (URL, method, status, remote address), Response Headers, Request Headers, Decrypted URL (when applicable), Bearer Token (when present)
- **Initiator** — initiator type, URL, and JS call stack (when available)
- **Payload** — decrypted Query String Parameters (table) and decrypted Request Payload, each with View raw / View decrypted toggle and Copy
- **Preview** — collapsible JSON tree of decrypted response with Expand all / Collapse all; inline image rendering
- **Response** — decrypted response body, pretty-printed JSON; Copy copies the pretty-printed text (matching what's shown), not the raw minified string
- **Timing** — DNS / Connect / SSL / Send / Waiting (TTFB) / Download with proportional breakdown bars

## Encrypt URL Tool
- **Bearer Token field** — paste `Authorization` token (sent as-is, never encrypted, prepended with `Bearer ` if omitted)
- **Copy buttons** — one-click copy for each output line
- **Encrypt button** — convert plaintext URL/body to CipherNet-encrypted output (AES-128-CBC → Base64)
- **Query Params editor** — Postman-style table (enable checkbox · Key · Value · Description) for composing query strings
- **Round-trip encryption** — encrypted query strings (`path?<ciphertext>`) round-trip with decrypt path
- **Send Decrypt button** — fire the request as-is (GET when no body, POST/JSON when body present)
- **Send Encrypt button** — encrypt query string and body, then fire the request
- **Unencrypted response passthrough** — when a sent request's response can't be decrypted, it's shown as plain raw output (not flagged as a decrypt error), since that's the expected result for a plaintext response
- **Preview on unencrypted responses** — the Preview table is available even when the response wasn't encrypted, as long as the raw body itself is valid JSON

## Filtering
- **Custom filter mini-language** — search by method, status, domain, host, scheme, mime-type, protocol, size, headers, running state, cache status, encryption state, API name
- **Encrypted only toggle** — quickly filter to encrypted requests only
- **More filters dropdown** — Hide data URLs, Hide extension URLs, Blocked requests, 3rd-party requests, Blocked response cookies
- **Resource-type pills** — All · Fetch/XHR · Doc · CSS · JS · Font · Img · Media · Manifest · Socket · Wasm · Other (single or multi-select via Ctrl/Cmd-click)
- **Filter persistence** — resource-type pill selection and More filters toggles persist via `chrome.storage` and are restored the next time DevTools opens

## Key Management
- **Clear key** — wipe stored key and restart red blink indicator
- **IV (optional)** — set custom IV or use key as IV
- **Key auto-save** — persists via `chrome.storage`
- **Key blink indicator** — red blink when no key is saved
- **Key entry box** — textbox to paste and save AES key
- **Key persistence** — stored key persists across DevTools sessions

## Network Capture
- **Auto capture on Inspect** — capturing starts the instant DevTools opens (before the CipherNet tab is even clicked); requests that fire while you're still on Elements/Console/Network are buffered and replayed once the panel loads, so nothing is missed
- **Capture toggle** — Record button to start/stop capturing requests (red = recording)
- **Clear list** — 🗑 button to wipe all captured requests
- **Decryption pipeline** — automatic decryption of requests/responses when key is present
- **Live (pending) requests** — in-flight requests appear immediately with a grey `(pending)` status and `Pending` time, exactly like Chrome's Network panel, then update in place when they finish; network errors show `(failed)` with the `net::ERR_…` reason as a tooltip (powered by a background service worker relaying `webRequest` events for the inspected tab; `is:running` filters to them)
- **Preserve log** — keep requests across page reloads/navigations instead of clearing

## Network Controls
- **Disable cache** — inject `Cache-Control: no-cache, no-store` / `Pragma: no-cache` headers via `declarativeNetRequest`
- **Offline mode** — fully functional request blocking (unlike bandwidth presets which are informational)
- **Throttling presets** — Offline, Fast/Slow 5G, Fast/Slow 4G, 3G, Slow 3G (informational only except Offline)
- **Throttling persistence** — selected preset persists via `chrome.storage`

## Request List
- **Auto-scroll to latest** — the list always follows the newest incoming request, scrolling it into view as it arrives (also while a column sort is active; filtered-out requests are skipped)
- **Column headers** — Name, Method, Status, Type, Size, Time (plus optional Initiator, Encryption, Decryption)
- **Click to detail** — open a request in the detail pane
- **Column resizing** — drag any column border at any height to resize
- **Encrypted badge** — 🔒 icon on encrypted requests
- **Request table** — full list of captured network requests with key metadata

## Search
- **Case-sensitive toggle** — search matching exact case
- **Full-text search** — across URL, headers, cookies, request body, response body, and **decrypted bodies**
- **Keyboard shortcuts** — Ctrl+F (or Cmd+F) to open, Enter / Shift+Enter (or ▼ / ▲) to cycle matches, Esc to close
- **Regex toggle** — use `.*` regex patterns in search
- **Search highlighting** — matches marked in the open detail pane
- **Whole-word toggle** — match complete words only

## Toolbar
- **Decrypt tool** — quick reverse of Encrypt URL
- **Encrypt URL tool** — encode plaintext to CipherNet format
- **Key box** — manage AES key and IV
- **Network view** — the default request list + detail pane
- **View switchers** — click to switch between Network, Encrypt URL, and Decrypt (active tool toggles back to Network)

## User Interface
- **Auto theme switching** — reads `chrome.devtools.panels.themeName` or `prefers-color-scheme`
- **Dark/light theme** — full palette mirror of Chrome's Network panel
- **Focused tool views** — opening Encrypt/Decrypt hides the list/detail view for focused editing
- **Keyboard shortcut** — Ctrl/Cmd+Enter in Decrypt tool to decrypt
- **Live re-render** — changing the key instantly updates all open requests

## View Modes
- **Decrypt view** — paste encrypted value, get plaintext (with JSON preview, copy, view raw/decrypted toggle)
- **Encrypt URL view** — compose plaintext, get CipherNet ciphertext (with query editor, Bearer token, Send buttons, Collections)
- **Network view** — list + detail pane (default)

## Export
- **CSV export** — download requests as comma-separated values
- **Decrypted session export** — `.json` with raw + decrypted query, request body, response for each request
- **HAR export** — download requests in HAR format
- **JSON export** — download requests as JSON
- **Per-request copy** — Copy button on each decrypted output (Headers, Payload, Response, etc.)

## JSON Preview / Table Rendering
- **Click-to-sort headers** — sort by any column ascending/descending
- **Collapse/Expand all** — toggle JSON tree expansion in Preview tab
- **Collapsible JSON tree** — expand/collapse nested objects and arrays
- **Filterable columns** — per-column filter box to search/hide rows
- **Inline images** — render image URLs as thumbnails in Preview
- **Sortable JSON table** — Preview button available for any valid JSON body (array of objects, plain object, array, or scalar), not just tabular shapes
- **View raw toggle** — switch between pretty-printed decrypted and raw (Base64 or plaintext)

## Layout and Resizing
- **Horizontal splitter** — drag between request list and detail pane to resize
- **Reset splitter** — double-click the splitter to restore default width
- **Splitter persistence** — width persists via `chrome.storage`
- **kv column splitter** — drag the divider in Headers/Payload/Initiator to resize the label column, growing or shrinking the value column (e.g. the Request URL row); double-click to reset; persists via `chrome.storage`
