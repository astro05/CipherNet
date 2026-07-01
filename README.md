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
  ascending → descending → off, shown with ▲/▼), **resizable** (drag a header
  border; double-click it to auto-fit), **reorderable** (drag a header), and
  **show/hide-able** (right-click a header). Sort, widths, order and visibility
  persist via `chrome.storage`; "Reset columns" restores defaults.
- Click a request to open a detail pane with sub-tabs, just like Chrome's
  Network panel:
  - **Headers** — General (URL, method, status, remote address) + Response
    Headers + Request Headers. When the query string decrypts, a **Request URL
    (decrypted)** row is added.
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
- **Key 🔑** — starts empty: enter your AES key and **Save** (the **IV** is
  optional and defaults to the key). Persists via `chrome.storage` and
  re-renders the open request live. **Clear** wipes the stored key.
- **Encrypt URL 🔒** — a small tool that does the reverse of decryption: paste a
  plaintext **URL** and/or a **Payload / Body** and click **Encrypt** to get the
  CipherNet-encrypted output (AES-128-CBC → Base64, using the saved key/IV). The URL's
  **query string** is encrypted and spliced back in (`path?<ciphertext>`), so the
  result round-trips with the decrypt path; a value with no `?` is encrypted
  whole. Each output line has a **Copy** button. Handy for crafting or replaying
  encrypted requests by hand. Opening the tool hides the request list / detail
  view and the resource-type filter row so you get a focused encrypt view; click
  **🔒 Encrypt URL** again to close the tool and bring the network view back.
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

| File           | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `manifest.json`| MV3 manifest, registers the devtools page          |
| `devtools.js`  | Creates the "CipherNet" panel                   |
| `panel.html/css`| Panel UI                                          |
| `panel.js`     | Captures requests, decrypts, renders               |
| `crypto.js`    | AES-128-CBC decrypt/encrypt (mirrors the backend)  |
| `selftest.mjs` | `node selftest.mjs` — verifies crypto vs. .NET     |

## Ship an obfuscated build

Chrome must load plaintext JS, so the source can't be truly *encrypted* — but it
can be **obfuscated** so it's impractical to read. The build runs the three
shipped JS files (`devtools.js`, `crypto.js`, `panel.js`) through
[`javascript-obfuscator`](https://github.com/javascript-obfuscator/javascript-obfuscator)
and copies the static assets (manifest, HTML, CSS, icons) verbatim into `dist/`.

```
npm install      # once, pulls in javascript-obfuscator (dev only)
npm run build    # writes the obfuscated extension to dist/
```

Then **Load unpacked** from the `dist/` folder instead of the project root.

Notes:

- The obfuscator is configured for MV3: `debugProtection`/`selfDefending` are
  **off** (they inject `new Function(...)`, which the MV3 content-security policy
  blocks), and `renameGlobals`/`renameProperties` are **off** so the cross-file
  `CipherNetCrypto` global and `chrome.*` APIs keep working.
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
