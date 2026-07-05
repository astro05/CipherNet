**Version:** 2.12.0 | **Last Modified:** 2026-07-05

# CipherNet (Chrome DevTools extension)

Decrypts CipherNet API **request payloads**, **encrypted query strings**, and
**responses** straight inside Chrome DevTools, so you can read the plaintext
while debugging.

## How it matches the backend

The backend (`EncryptionMiddleware.cs`) uses:

| Setting   | Value                                              |
| --------- | -------------------------------------------------- |
| Algorithm | AES (`Aes.Create()`) → **AES-128-CBC** + **PKCS7** |
| Key       | UTF-8 bytes of your 16-char key (→ AES-128)        |
| IV        | UTF-8 bytes of the same value as the key           |
| Encoding  | **Base64** on the wire                             |

No key is baked into the extension — you enter it in the **🔑 Key** box (it's
saved via `chrome.storage`). The 16-byte key forces AES-128. The extension
decrypts with the Web Crypto API, whose AES-CBC uses PKCS7 padding — identical
to .NET's default — so round-trips match byte-for-byte.

## Install (load unpacked)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top-right) on
3. Click **Load unpacked** and select this folder
   (`c:\Joy\Project\AkijErpDecryption`)
4. Open **DevTools** (F12) on your app → switch to the **"CipherNet"** tab
5. Trigger an API call. Each request appears with a decrypted
   **Request Payload**, **Query String**, and **Response**.

> Note: Chrome does not allow extensions to modify the *built-in* Network
> panel's Payload/Response tabs. This extension adds its own panel that mirrors
> the same requests with decrypted content.

> Permissions: the **Disable cache** control uses `declarativeNetRequest` with
> host access, so Chrome shows a "Read and change all your data on all websites"
> warning on install. The rule only adds no-cache request headers on the
> inspected tab; no data ever leaves the browser (offline-first, no telemetry).

## Using it (works like the Network tab)

- A **request list** with `Name · Method · Status · Type · Size · Time` columns
  (plus optional `Initiator`, `Encryption`, `Decryption` columns). Encrypted
  requests are flagged with 🔒. Columns are **sortable** (click a header to cycle
  ascending → descending → off, shown with ▲/▼), **resizable** (drag a column
  border at **any height**, not just the header; double-click it to auto-fit),
  **reorderable** (drag a header), and
  **show/hide-able** (right-click a header). Sort, widths, order and visibility
  persist via `chrome.storage`; "Reset columns" restores defaults.
- Click a request to open a detail pane with sub-tabs, just like Chrome's
  Network panel:
  - **Headers** — General (URL, method, status, remote address) + Response
    Headers + Request Headers. When the query string decrypts, a **Request URL
    (decrypted)** row is added. When the request carries an `Authorization:
    Bearer …` header, a **Bearer Token** row appears (masked) with a **Copy**
    button that copies the full token — handy for pasting into the Encrypt URL
    tool below.
  - **Payload** — decrypted **Query String Parameters** (parsed into a table)
    and decrypted **Request Payload**, each with a **View raw / View decrypted**
    toggle and **Copy**.
  - **Preview** — pretty, collapsible **JSON tree** of the (decrypted) response
    with **Expand all / Collapse all**; images are rendered inline.
  - **Response** — the decrypted response body, pretty-printed JSON.
  - **Timing** — DNS / Connect / SSL / Send / Waiting (TTFB) / Download
    breakdown with proportional bars.
  - **Cookies** — parsed Request and Response (Set-Cookie) cookie tables.
  - **Initiator** — initiator type, URL, and JS call stack when available.
- **Leading toolbar buttons** — right after the CipherNet icon sit the view
  switchers: **🔑 Key**, **🌐 Network**, **🔒 Encrypt URL** and **🔓 Decrypt**.
  **Network** is the default view (the request list + detail pane); the Encrypt
  URL and Decrypt tools open in place of it, and **🌐 Network** (or clicking the
  active tool again) brings the list back. The network-only toolbar controls
  (Record, Clear, Preserve log, Disable cache, Throttling, Search, Filter,
  Encrypted only, Export) show **only in the Network view** and are hidden while a
  tool is open, so the view switchers stay uncluttered.
- **Key 🔑** — starts empty: enter your AES key and **Save** (the **IV** is
  optional and defaults to the key). Saving persists it via `chrome.storage`,
  re-renders the open request live, and **auto-closes the Key box**. While no key
  is saved the **🔑 Key** button **blinks red** so it's obvious one is needed.
  **Clear** wipes the stored key (and starts the blink again).
- **Encrypt URL 🔒** — a small tool that does the reverse of decryption: paste a
  plaintext **URL** and/or a **Payload / Body** and click **Encrypt** to get the
  CipherNet-encrypted output (AES-128-CBC → Base64, using the saved key/IV). The URL's
  **query string** is encrypted and spliced back in (`path?<ciphertext>`), so the
  result round-trips with the decrypt path; a URL with no query string is left
  unencrypted (only the query is encryptable). Each output line has a **Copy**
  button. Handy for crafting or replaying
  encrypted requests by hand. When the **URL** field holds a query string it's
  broken out into a Postman-style **Query Params** table (enable checkbox · Key ·
  Value · Description, with add/remove rows); editing the table rewrites the URL
  and editing the URL rebuilds the table, so you can compose the query before
  encrypting. Opening the tool hides the request list / detail view and the
  resource-type filter row so you get a focused encrypt view; click **🌐 Network**
  (or **🔒 Encrypt URL** again) to bring the network view back.
  - **Bearer Token** — a field beside Payload/Body for an `Authorization` token.
    It is **never encrypted**; it's sent as-is (with `Bearer ` prepended if you
    omit it) on the Send requests below.
  - **Send Encrypt** / **Send Decrypt** — fire the request like Postman. **Send
    Encrypt** encrypts the query string and body first, then sends; **Send
    Decrypt** sends the URL/body exactly as entered. The method is `GET` when
    there's no body, `POST` (JSON) when there is.
  - **Collections (folders of saved requests)** — while the Encrypt URL view is
    open, three tools appear in the toolbar after **🔓 Decrypt**:
    - **➕ Add** — opens a small panel to name the request (**API name**) and pick
      or create a **folder**, then saves it (URL, body, token) locally.
    - **📚 Collection** — a dropdown **tree** of every folder → API; click an API
      to load it, or use the **🗑** icon on any row to delete that folder (with
      its requests) or a single request.
    - **💾 Save** — appears only after you **load** a saved request and then
      **modify** it, and updates that saved request in place.

    Persisted in `chrome.storage`; pre-2.9 flat saves migrate into a **Default**
    folder automatically.
  - **Response viewer** — a Postman-style panel: a status · time · size · method
    URL line, then tabs:
    - **Body** — the response body via `bodyView` (decrypted when possible, with
      a raw/decrypted toggle, a **Preview** table, and Copy).
    - **Headers** — the readable response headers (cross-origin responses only
      expose CORS-safelisted ones).
    - **Cookies** — any `Set-Cookie` the browser exposes (usually none — fetch
      hides Set-Cookie).
    - **History** — every request sent this session; click a row to reload its
      response. (In-memory only.)
- **Decrypt 🔓** — the quick reverse of Encrypt URL: paste any CipherNet-encrypted
  (Base64) value and click **Decrypt** (or **Ctrl/Cmd+Enter**) to get the
  plaintext, pretty-printed when it's JSON, with a **View raw / View decrypted**
  toggle, a **Preview** table, and a **Copy** button. It uses the saved key/IV
  and tries a few encodings (trimmed, unquoted, percent-decoded).
  - **Preview** — when the decrypted body is tabular JSON (an array of objects,
    an object, or an array), a **Preview** button beside the raw/decrypted toggle
    shows it as a **table** with **click-to-sort** headers and a **per-column
    filter** box. The **View raw / decrypted** toggle stays visible in Preview,
    so one click jumps back to the text. Available anywhere a decrypted body is
    shown (Decrypt tool, Encrypt URL response, and the request detail tabs).
  - **Paste a whole URL** — if the input is a URL whose query string is encrypted
    (`https://host/path?<ciphertext>`), the tool decrypts just the query and
    shows the **full decrypted URL** (with Copy), plus the decrypted query body.
  - **Auto-lenient** — a real AES-CBC ciphertext is always a multiple of 16
    bytes, and Web Crypto rejects anything else outright (unlike CryptoJS-based
    tools, which silently tolerate it). When a strict decrypt fails, the tool
    **automatically** retries in lenient mode: it trims the tail to whole 16-byte
    blocks and decrypts **without PKCS7 validation** — matching CryptoJS — so a
    value with a stray/truncated tail still decrypts (a note reports how many
    tail bytes were dropped; the very end may be garbled). The same auto-lenient
    fallback applies to the Encrypt URL response body.
- **Filter** — a Chrome-style filter mini-language (everything else is a plain
  URL substring; prefix a term with `-` to negate):

  ```
  method:POST            status-code:200      status:404
  domain:api.company.com host:cdn.example.com scheme:https
  mime-type:json         protocol:h2
  larger-than:100k       smaller-than:2m
  has-response-header:content-type            has-request-header:authorization
  is:running             is:from-cache
  encrypted:true         decrypted:true       api:login
  ```

  Terms combine with AND, e.g. `method:POST larger-than:10k -domain:cdn.example.com`.
  **Encrypted only** hides non-API noise.
- **Resource-type pills** — a Chrome-style row of type filters: **All ·
  Fetch/XHR · Doc · CSS · JS · Font · Img · Media · Manifest · Socket · Wasm ·
  Other**. Click one to show only that type (click again for **All**);
  **Ctrl/Cmd-click** to select several. Persisted.
- **More filters ▾** — a dropdown of extra toggles (persisted):
  - **Hide data URLs** — hide `data:` requests.
  - **Hide extension URLs** — hide `chrome-extension://` requests.
  - **Blocked requests** — show only failed/blocked requests (incl. those blocked
    by the Offline throttle).
  - **3rd-party requests** — show only requests whose registrable domain differs
    from the inspected page's.
  - **Blocked response cookies** — best-effort; only matches when Chrome attaches
    blocked-cookie metadata to the request (often empty via the DevTools API).

  All filter mechanisms (pills, More filters, the filter box, Search and
  Encrypted-only) combine with AND.
- **Search 🔍** (or **Ctrl+F**) — full-text search across URL, headers, cookies,
  request body, response body **and the decrypted bodies**, with **.\*** (regex),
  **Aa** (case-sensitive) and **⌷W** (whole-word) toggles. Matching requests are
  highlighted and **Enter / Shift+Enter** (or ▼ / ▲) cycle through them; matches
  are marked in the open detail pane. **Esc** closes.
- **⬇ Export** — download the captured (or currently filtered) requests as
  **HAR**, **JSON**, **CSV**, or a **Decrypted session** (`.json` containing the
  raw + decrypted query, request body and response for every request).
- **Resizable layout** — drag the **splitter** between the request list and the
  detail pane to resize (double-click it to reset); the width persists.
- **● Record** — toggle capturing (red = recording). **🗑** clears the list.
- **Auto capture on Inspect** — recording starts the moment DevTools opens, not
  just once you click the CipherNet tab. Chrome only loads a panel's page
  once it's first shown, so `devtools.js` buffers requests from the instant
  Inspect mode opens and replays them into the panel as soon as it loads.

### Network controls (like Chrome DevTools)

- **Preserve log** — keep requests across page navigations/reloads instead of
  clearing them. Persisted; default off.
- **Disable cache** — injects `Cache-Control: no-cache, no-store` / `Pragma:
  no-cache` request headers for the inspected tab (via
  `declarativeNetRequest`), so responses aren't served from cache while the
  panel is open. Persisted; default off.
- **Throttling** — a dropdown with Chrome's presets (Offline, Fast/Slow 5G, Fast/
  Slow 4G, 3G, Slow 3G). The selection is persisted and shown in the toolbar.
  - **Offline works for real**: it blocks every request on the inspected tab via
    a `declarativeNetRequest` block rule (so reloads fail like Chrome's Offline).
    The rule is removed when DevTools closes and re-applied when it reopens, so a
    tab is never left permanently blocked.
  > ⚠️ The **bandwidth presets** (5G/4G/3G…) are informational only: shaping
  > throughput/latency needs the Chrome Debugger Protocol
  > (`Network.emulateNetworkConditions`), and Chrome refuses to let an extension
  > attach the debugger to a tab that already has DevTools open. Use Chrome's own
  > Network panel for bandwidth shaping; **Offline** is fully functional here.

### Appearance

- **Auto theme** — the panel follows the host theme automatically. When
  DevTools (or the browser) is in dark mode the panel is dark; in light mode it
  switches to a light palette that mirrors Chrome's light Network panel. It reads
  `chrome.devtools.panels.themeName` (falling back to the
  `prefers-color-scheme` media query) and re-themes live when you flip the
  DevTools theme — no reload needed.

## Not yet implemented (from `docs/PRD.md`)

This extension covers capture, a resizable request table (resize/reorder/hide/
persist columns), decryption, the detail tabs above, advanced filtering, search,
export, resizable panes, and the Preserve log / Disable cache / Throttling
controls. Larger PRD items still open:

- Rule engine (configurable per-host decrypt rules, import/export)
- Request interception / edit-and-resend / replay
- Waterfall timeline column; column pinning
- Real bandwidth/latency throttling (Offline works; 5G/4G/3G shaping is blocked
  by the DevTools/debugger limitation above)
- Diff viewer (original vs. decrypted, request A vs. B)
- Import (HAR / previously exported sessions)
- Favorites / tags / notes / colors
- Additional crypto algorithms (AES-GCM, DES, RSA, ECIES, …) + plugin system
- Virtual scrolling / Web Workers for 100k+ requests
- Full TypeScript + React + Vite rewrite

## Files

The panel is built as small ES modules under `src/`, layered core → services →
ui with a single composition root:

| Path                         | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `manifest.json`              | MV3 manifest, registers the devtools page            |
| `devtools.js`                | Creates the "CipherNet" panel; buffers requests from the moment Inspect mode opens until the panel is first shown |
| `assets/`                    | Extension icons (`icon16/32/48/128.png`, `favicon`)  |
| `panel.html` / `panel.css`   | Panel markup + styles                                |
| `src/main.js`                | Composition root: wires modules, applies settings    |
| `src/core/crypto.js`         | AES-128-CBC decrypt/encrypt (mirrors the backend)    |
| `src/core/format.js`         | Pure formatting / parsing helpers                    |
| `src/core/dom.js`            | Tiny DOM/util primitives (`el`, `copyBtn`, debounce) |
| `src/core/state.js`          | The single mutable app-state store                   |
| `src/core/els.js`            | Cached DOM element references                        |
| `src/services/storage.js`    | Persistence boundary over `chrome.storage.local`     |
| `src/services/capture.js`    | Network capture + response fetch + decryption        |
| `src/services/filters.js`    | Filter engine, resource-type pills, more-filters     |
| `src/services/search.js`     | Global search + in-pane highlighting                 |
| `src/services/exporter.js`   | HAR / JSON / CSV / decrypted-session export          |
| `src/services/networkControls.js` | Preserve log / Disable cache / Throttling       |
| `src/ui/theme.js`            | Auto dark/light theme                                |
| `src/ui/table.js`            | Request list: columns, sort, resize, splitter        |
| `src/ui/detail.js`           | Detail tabs (Headers/Payload/Preview/…)              |
| `src/ui/jsonTable.js`        | Sortable / filterable JSON table (Preview)           |
| `src/ui/views.js`            | Network / Encrypt URL / Decrypt view switcher        |
| `src/ui/keyBox.js`           | 🔑 Key box                                           |
| `src/ui/encryptTool.js`      | 🔒 Encrypt URL tool + Send Encrypt/Decrypt           |
| `src/ui/decryptTool.js`      | 🔓 Decrypt tool (paste ciphertext → plaintext)       |
| `selftest.mjs`               | `node selftest.mjs` — verifies crypto vs. .NET       |

## Ship an obfuscated build

Chrome must load plaintext JS, so the source can't be truly *encrypted* — but it
can be **obfuscated** so it's impractical to read. The build runs every shipped
JS file (`devtools.js` plus the whole `src/` ES-module tree) through
[`javascript-obfuscator`](https://github.com/javascript-obfuscator/javascript-obfuscator)
and copies the static assets (manifest, HTML, CSS, icons) verbatim into `dist/`,
preserving the directory layout (`dist/src/…`).

```
npm install      # once, pulls in javascript-obfuscator (dev only)
npm run build    # writes the obfuscated extension to dist/
```

Then **Load unpacked** from the `dist/` folder instead of the project root.

Notes:

- The obfuscator is configured for MV3: `debugProtection`/`selfDefending` are
  **off** (they inject `new Function(...)`, which the MV3 content-security policy
  blocks), and `renameGlobals`/`renameProperties` are **off** so the ES
  `import`/`export` bindings, `chrome.*` APIs and DOM property names keep working.
- Obfuscation raises the bar; it is **not** real protection. Anyone determined
  can still beautify and trace the code, and no secret key is in the extension
  anyway — the AES key is typed in at runtime.

## Pack a signed .crx

To produce a packaged extension — the same thing chrome://extensions
**"Pack extension"** makes — run:

```
npm install      # once
npm run pack     # rebuilds dist/, then writes CipherNet.crx + CipherNet.zip
```

Outputs (in the project root):

| File              | Purpose                                                      |
| ----------------- | ----------------------------------------------------------- |
| `CipherNet.crx`  | Signed **CRX3** package. Drag it onto chrome://extensions.  |
| `CipherNet.zip`  | Plain zip of `dist/` — upload this to the Chrome Web Store. |
| `key.pem`         | Private signing key (see warning below).                    |

`key.pem` is generated on the **first** pack and **reused** afterwards, so the
extension ID stays stable across rebuilds (currently
`opdendjleoanbhogiodimdjonpbdokno`).

> ⚠️ **Keep `key.pem` secret and backed up.** Anyone who has it can publish
> updates Chrome treats as this same extension. If you lose it, the extension ID
> changes. It's git-ignored on purpose.

Install notes:

- Drag-installing a `.crx` works in **Developer mode**. For everyday users,
  Chrome only allows installs from the Web Store or via enterprise policy —
  packing a `.crx` does not bypass that.

## Verify the crypto

```
node selftest.mjs
```

It encrypts a sample the .NET way (Node `crypto`, AES-128-CBC) and confirms the
extension's Web Crypto path decrypts it back — proving compatibility.
