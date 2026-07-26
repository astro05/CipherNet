**Version:** 2.19.15 | **Last Modified:** 2026-07-26

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
- **Add request** — name a request (API name) and assign it to a folder, then save method/URL/headers/body/token
- **Collection tree** — dropdown showing all folders and requests in a tree view
- **Delete folder** — remove a folder and all its requests (with 🗑 button)
- **Delete request** — remove a single saved request (with 🗑 button)
- **Load request** — click any API in the tree to load it into the API Testing tool
- **Rename folder** — rename a folder (with ✎ button)
- **Rename request** — rename a saved API request (with ✎ button)
- **Save button** — update a previously saved request after modifying it (its favorite is preserved)
- **Save request** — persist requests and Bearer tokens via `chrome.storage.sync` (see **Backup & Restore** for surviving removal of the extension)
- **Favorite ★** — star a request; favorites float to the top of their folder (rides along in sync and in the backup file automatically)
- **Filter box** — a search box at the top of the Collection tree filters folders and requests by name as you type

## Environments ({{variables}})
- **🌎 Environment switcher** — pick an active environment in the API Testing toolbar (turns green when one is active); "No Environment" disables substitution
- **{{name}} substitution** — reference variables as `{{name}}` anywhere in the URL, headers, body, or Bearer token; they're resolved at **send time** (the editors keep the `{{name}}` literal, so it's non-destructive and reusable)
- **Manage in place** — create / rename / delete environments and edit their `name → value` variables in one pop-panel
- **Colour-highlighted everywhere** — `{{name}}` renders in a distinct colour right inside the URL, Bearer Token, Body, or any Params/Headers Key/Value cell: blue when the active environment defines it, red when it doesn't
- **Autocomplete everywhere** — type `{{` in the URL, Bearer Token, Body, or any Params/Headers Key/Value cell and a dropdown of the active environment's variables (name + value) appears; ↑/↓ to move, Enter/Tab or click to insert, Esc to dismiss
- **Params stay literal in the URL** — a `{{name}}` typed into a Param's Key or Value isn't percent-encoded when it syncs into the URL bar, so it stays readable and resolves correctly
- **Unresolved heads-up** — after a send, any `{{name}}` not defined in the active environment is called out in the status line
- **Persisted + backed up** — environments live in `chrome.storage.sync` and are also written to the linked backup file, so they survive a remove/re-add

## Saved Responses
- **📌 Save response** — on the response meta line; keeps the **full** response body plus the request that produced it
- **🗂 Saved panel** — browse saved responses (method · status · name · size); click to re-open, ✎ rename, 🗑 delete
- **Re-decrypted on view** — only the raw body is stored (never the decrypted plaintext); it's decrypted again with the current key when you open it (PRD §24)
- **Kept on disk + backed up** — stored in `chrome.storage.local` (far bigger than the sync history quota), capped by count and ~4 MB total with oldest-first eviction, and mirrored into the linked backup file
- **Complements History** — Request History logs every send as a lightweight summary; Saved Responses is the deliberate, full-body keep

## Request History
- **🕘 History button** — beside ➕ Add in the API Testing toolbar; opens a dropdown of the last 100 sent requests, newest first
- **Auto-logged** — every Send Encrypted / Send Plain call is logged automatically, no naming needed (unlike Collections)
- **Load from history** — click an entry to reload its URL/payload/Bearer token back into the composer
- **Per-entry delete + Clear all** — remove one entry (🗑) or clear the whole log
- **Compact by design** — stores the request (URL/body/token) and a response summary (status/size/time), not the full response body, to stay well inside chrome.storage.sync's 100 KB/8 KB-per-item quota across 100 entries

## Backup & Restore (Collections, History, Environments & Saved Responses)
- **Why it exists** — Chrome erases an extension's storage, `local` **and** `sync` alike, when the extension is removed. (Synced settings only come back for Web Store installs on a signed-in profile; a sideloaded build gets nothing back.) A file on disk is the only copy that survives.
- **🗄 Backup menu** — in the API Testing toolbar; shows whether a backup file is linked and whether Chrome still permits writing to it
- **Link backup file** — pick a file once; Collections, History, Environments and Saved Responses are written to it from then on
- **Automatic save** — every add / rename / delete / send / environment edit / response save writes the file (debounced), so it never lags behind the live store
- **Automatic pull on load** — each time the panel opens, the linked file is read and merged back in, with no interaction
- **Restore after re-adding the extension** — re-add, open 🗄 Backup → *Link backup file…* → **Open existing backup**, and every folder, request, history entry, environment and saved response comes back
- **Restore from file** — merge any backup copy into the current data (plain file picker, works in the panel)
- **Download a copy** — one-off snapshot, e.g. to move your setup to another machine
- **Non-destructive merges** — a restore unions folders/requests/environments rather than replacing them; history is de-duplicated by timestamp and saved responses by id
- **v1 files still load** — older backups (Collections + History only) restore fine; the new fields default empty
- **Keys are never backed up** — AES keys and IVs stay in `chrome.storage` and are never written to the file (PRD §24). The file *does* contain Bearer tokens (saved with a request, and in environment variables) and full response bodies, so it's kept wherever the user chose to put it — the 🗄 Backup menu says so.

## Decryption
- **Auto-lenient mode** — when strict decryption fails, automatically retry by trimming to whole 16-byte blocks without PKCS7 validation
- **Decrypted request body** — show the plaintext payload
- **Decrypted request headers** — show decrypted URL and Bearer token in the Headers tab
- **Decrypted response body** — show the plaintext response, pretty-printed if JSON
- **Pretty-printed JSON everywhere** — Response tab, Preview drawer's Body tab, and the 🔐 Encrypt/Decrypt tool all pretty-print + syntax-highlight JSON bodies, whether decrypted or shown raw
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

## Encrypt/Decrypt Tool
- **Encrypt button** — encode a pasted value to CipherNet ciphertext (AES-128-CBC → Base64); a `base?query` URL encrypts only the query and shows the full URL
- **Decrypt button** — decode an encrypted value (or a URL whose query string is encrypted) back to plaintext, with JSON preview, Copy, and a view raw/decrypted toggle
- **Auto-lenient decrypt** — falls back to the ragged-tolerant path when strict decryption fails
- **Keyboard shortcuts** — Ctrl/Cmd+Enter decrypts, Ctrl/Cmd+Shift+Enter encrypts

## API Testing Tool
Postman-style request builder: a `[method ▾] [ URL ] [Send ▾]` request line above a tab bar (Params · Authorization · Headers · Body) with a decrypting response viewer below.
- **Request line** — HTTP method dropdown (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), URL field, and two Send buttons side by side
- **Send Encrypted / Send Plain buttons** — green **Send Encrypted** (AES-encrypt the query string and body first) and purple **Send Plain** (send as-is), shown side by side
- **📋 Copy menu** — on the response meta line; copies what was actually **sent** (encrypted, when Send Encrypted was used): **URL**, **Body**, **Headers**, **as cURL**, or the **Response** body
- **📌 Save response** — keep the full response body to revisit later (see **Saved Responses**)
- **{{env vars}}** — `{{name}}` in the URL / headers / body / token resolves from the active environment at send time (see **Environments**)
- **Method auto-bump** — typing a body while the method is GET bumps it to POST so bodies aren't silently dropped (GET/HEAD never carry a body)
- **Params tab** — Postman-style query editor (enable checkbox · Key · Value · Description), two-way bound to the URL
- **Authorization tab** — No Auth / Bearer Token; the token is sent as `Authorization` as-is (prepended with `Bearer ` if omitted), never encrypted
- **Headers tab** — key/value/description editor for custom request headers, merged into the outgoing request (a header count shows on the tab)
- **Body tab** — full-width raw (JSON) editor; `Content-Type: application/json` is added when a body is sent unless you set your own
- **Tab indicators** — a green dot marks Params/Authorization/Body when they hold content, matching Postman
- **Bulk Edit** — each table (Params, Headers) toggles to a `key:value`-per-line textarea; prefix a line with `//` to disable it
- **Round-trip encryption** — encrypted query strings (`path?<ciphertext>`) round-trip with the decrypt path
- **Unencrypted response passthrough** — when a sent request's response can't be decrypted, it's shown as plain raw output (not flagged as a decrypt error), since that's the expected result for a plaintext response
- **Preview on unencrypted responses** — the Preview table is available even when the response wasn't encrypted, as long as the raw body itself is valid JSON
- **Saved with the request** — Collections and History round-trip the method, headers, and auth alongside the URL/body/token
- **Status code tooltip** — hover any status code (on the response meta line, in History, and in Saved Responses) to see its meaning, e.g. `204 No Content`

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
- **Key entry box** — masked (password) fields to paste and save AES key/IV, never shown in plaintext
- **Key persistence** — stored key persists across DevTools sessions
- **Encrypted key file (load-only)** — Load the key/IV from a `.key` file, encrypted (PBKDF2 + AES-GCM) under a fixed app passphrase — no passphrase prompt, no plaintext key in the file or UI, but not a secrecy boundary against anyone with the extension's source (PRD §31)

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
- **Status code tooltip** — hover a status cell to see what the code means, e.g. `204 No Content` or `503 Service Unavailable` (falls back to the status class, like `499 Client Error`, for non-standard codes)
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
- **Encrypt/Decrypt tool** — encrypt or decrypt a pasted value with the saved key
- **API Testing tool** — compose and send CipherNet requests (Send Encrypted / Send Plain), with Collections & History
- **Key box** — manage AES key and IV (masked entry, plus Load from an encrypted key file)
- **Network view** — the default request list + detail pane
- **View switchers** — click to switch between Network, API Testing, and Encrypt/Decrypt (active tool toggles back to Network)

## User Interface
- **Auto theme switching** — reads `chrome.devtools.panels.themeName` or `prefers-color-scheme`
- **Dark/light theme** — full palette mirror of Chrome's Network panel
- **Focused tool views** — opening Encrypt/Decrypt hides the list/detail view for focused editing
- **Keyboard shortcut** — in the Encrypt/Decrypt tool, Ctrl/Cmd+Enter decrypts and Ctrl/Cmd+Shift+Enter encrypts
- **Live re-render** — changing the key instantly updates all open requests

## View Modes
- **Encrypt/Decrypt view** — paste a value and encrypt or decrypt it (with JSON preview, copy, view raw/decrypted toggle)
- **API Testing view** — compose and send CipherNet requests (with query editor, Bearer token, Send buttons, Collections)
- **Network view** — list + detail pane (default)

## Export
- **CSV export** — download requests as comma-separated values
- **Decrypted session export** — `.json` with raw + decrypted query, request body, response for each request
- **Error log export** — download internal errors as a `.txt` file (no console output, no external telemetry — errors are logged locally and pulled on demand)
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
