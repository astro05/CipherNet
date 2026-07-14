# CipherNet - Chrome DevTools Extension Requirements

## Overview

Build a Chrome DevTools extension named **CipherNet**.

The goal is to create a custom DevTools panel that provides **all capabilities of Chrome's native Network tab**, while adding custom request/response decryption, analysis, and debugging features.

The user experience should feel almost identical to Chrome DevTools Network panel.

---

# Primary Goal

Create a DevTools panel called:

```
CipherNet
```

This panel should behave like the native **Network** panel with additional capabilities.

The extension should support Chrome Manifest V3.

---

# Core Requirements

## 1. DevTools Panel

Create a DevTools panel.

```
Chrome DevTools
 ├── Elements
 ├── Console
 ├── Sources
 ├── Network
 ├── CipherNet
```

The panel must load independently and not interfere with Chrome's built-in Network panel.

---

# 2. Network Request Capture

Capture every network request from the inspected page.

Support:

* Fetch API
* XMLHttpRequest
* Document requests
* Script
* CSS
* Images
* Fonts
* WebSocket
* EventSource
* Media
* Other resources

For every request collect:

* Request ID
* URL
* Method
* Scheme
* Domain
* Path
* Query
* Protocol
* Remote Address
* Status Code
* Status Text
* Type
* Initiator
* Priority
* Timing
* Transfer Size
* Encoded Size
* Decoded Size
* Content Length
* Cache Status
* Service Worker Info
* Security Details
* Request Headers
* Response Headers
* Cookies
* Request Body
* Response Body
* Raw Response
* MIME Type
* HTTP Version

---

# 3. Network Table

Replicate Chrome Network table.

Columns:

* Name
* Status
* Type
* Initiator
* Size
* Time
* Waterfall

Additional custom columns:

* Encryption
* Decryption Status
* API Name
* Response Hash
* Request Hash
* Tags

Columns must support:

* Resize
* Hide
* Reorder
* Sort
* Pin

---

# 4. Timeline

Replicate Chrome waterfall timeline.

Support:

* DNS
* TCP
* SSL
* Request Sent
* Waiting
* Download

Allow:

* Zoom
* Scroll
* Time ruler

---

# 5. Filtering

Support all Network filters.

Examples:

```
method:POST
status-code:200
domain:example.com
larger-than:100k
mime-type:application/json
has-response-header
is:running
is:from-cache
```

Additional filters:

```
encrypted:true
decrypted:true
api:login
tag:user
hash:xxxx
```

---

# 6. Search

Global search.

Search inside:

* URL
* Headers
* Cookies
* Request body
* Response body
* Decrypted body

Support:

* Regex
* Case sensitive
* Whole word

---

# 7. Request Details

Clicking a request opens detail tabs exactly like Chrome.

Tabs:

## Headers

Display:

General

Request Headers

Response Headers

Cookies

Query Parameters

Form Data

Payload

Security

Certificates

---

## Preview

Pretty preview.

Support:

* JSON
* HTML
* XML
* Images
* Videos
* Text
* Binary

---

## Response

Raw response.

Syntax highlighting.

Line numbers.

Word wrap.

Search.

---

## Timing

Full timing breakdown.

---

## Cookies

Cookie table.

---

## Initiator

Dependency graph.

---

## Security

TLS

Certificate

Cipher

Protocol

---

# 8. Decryption Engine

Primary feature.

If request/response matches configured rules:

Automatically decrypt.

Display:

Original

↓

Decrypted

↓

Pretty JSON

Supported modes:

* AES
* AES-GCM
* AES-CBC
* DES
* TripleDES
* RSA
* ECIES
* XOR
* Base64
* Hex
* Custom JavaScript

Architecture must allow plugins for future algorithms.

---

# 9. Rule Engine

Create configurable rules.

Example:

```
IF

Host == api.company.com

AND

Path starts with /v2/

THEN

Decrypt Response

Algorithm = AES-GCM

Key = xxxx

IV = yyyy
```

Support:

* URL
* Host
* Method
* Header
* Cookie
* Content-Type
* Regex
* Status

Rules should support priority.

Enable/disable.

Import/export JSON.

---

# 10. Request Modification

Optional interception mode.

Allow:

Modify Request Headers

Modify Response Headers

Modify Body

Modify Query

Modify Cookies

Modify Method

Modify URL

Replay Request

Duplicate Request

Edit and Resend

---

# 11. Pretty Viewer

For JSON:

* Tree view
* Collapse
* Expand
* Search
* Copy path
* Copy value

For XML:

Tree viewer.

For HTML:

DOM preview.

---

# 12. Diff Viewer

Compare:

Original vs Decrypted

Original vs Modified

Request A vs Request B

Side-by-side diff.

Inline diff.

---

# 13. Export

Support export:

HAR

JSON

CSV

TXT

Markdown

Encrypted Session

Decrypted Session

---

# 14. Import

Support:

HAR

JSON

Previously exported sessions

---

# 15. Favorites

Allow:

Bookmark requests

Star requests

Tag requests

Color requests

Notes

---

# 16. Performance

Support:

100,000+ requests

Virtual scrolling

Incremental rendering

Background parsing

Web Workers

Memory optimization

---

# 17. UI

Dark mode

Light mode

Auto theme

Resizable panes

Docking

Split views

Keyboard shortcuts

Context menus

Right-click actions

---

# 18. Keyboard Shortcuts

Examples:

Ctrl+F Search

Ctrl+R Replay

Ctrl+C Copy

Ctrl+S Export

Delete Clear

Space Preview

F2 Rename Tag

---

# 19. Context Menu

Right click request:

Copy URL

Copy Headers

Copy Response

Copy JSON

Copy cURL

Copy Fetch

Copy Axios

Replay

Duplicate

Export

Decrypt

Save Response

Compare

---

# 20. Settings

General

Capture Settings

Storage

Decryption

Rules

Appearance

Export

Advanced

---

# 21. Architecture

Use:

TypeScript

React

Vite

Manifest V3

Chrome DevTools API

Chrome Debugger API (if necessary)

Chrome DevTools Network API

Chrome Storage API

Web Workers

IndexedDB

Redux Toolkit (or Zustand)

CodeMirror or Monaco Editor

React Virtualized (or TanStack Virtual)

Use a modular architecture with feature-based folders.

---

# 22. Code Quality

Requirements:

* Strong TypeScript typing
* ESLint
* Prettier
* Unit tests
* Integration tests
* Playwright end-to-end tests
* Reusable components
* Separation of UI and business logic
* Dependency injection for crypto providers
* Plugin system for future decryptors

---

# 23. Plugin System

Support plugins for:

Decryption algorithms

Exporters

Importers

Custom viewers

Request analyzers

Rule processors

Each plugin should expose a standard interface.

---

# 24. Security

Keys must never be logged.

Sensitive values should be masked.

Support encrypted local storage.

No external telemetry.

Offline-first.

---

# 25. Deliverables

Claude should generate:

1. Complete project architecture
2. Folder structure
3. Database schema (IndexedDB)
4. React component hierarchy
5. State management design
6. TypeScript interfaces
7. DevTools integration
8. Network capture implementation
9. Decryption engine
10. Rule engine
11. UI implementation
12. Testing setup
13. Build configuration
14. Manifest V3 configuration
15. Documentation
16. Installation guide

---

## 26. Resizable Layout (Like Chrome DevTools)

The CipherNet panel must support fully resizable panes and columns, matching the behavior of Chrome DevTools.

### Resizable Panes

Users must be able to resize all major panes by dragging splitter handles.

Supported layouts include:

* Request list ↔ Request details
* Left sidebar ↔ Main content
* Top pane ↔ Bottom pane (when applicable)
* Nested split views

Requirements:

* Drag handles should provide visual feedback.
* Resize should be smooth (60 FPS where possible).
* Enforce minimum and maximum pane sizes.
* Persist pane sizes across browser sessions using Chrome Storage.
* Double-clicking a splitter resets it to the default size.
* Layout updates should not require reloading the panel.

---

### Resizable Columns

The request table should behave like Chrome DevTools' Network table.

Users must be able to:

* Drag column borders to resize column widths.
* Double-click a column border to auto-fit its content.
* Reorder columns via drag-and-drop.
* Show or hide columns.
* Pin important columns (optional).
* Persist column widths, order, and visibility across sessions.

Columns include (but are not limited to):

* Name
* Status
* Type
* Initiator
* Size
* Time
* Waterfall
* Encryption
* Decryption Status
* API Name
* Response Hash
* Tags

---

### Request Detail Tabs

The request details panel (Headers, Preview, Response, Timing, Cookies, Security, etc.) should support:

* Adjustable panel height.
* Adjustable panel width.
* Draggable divider between the request list and details.
* Remember the user's preferred size.
* Smooth resizing without losing scroll position.

---

### UX Requirements

The resizing behavior should closely match Chrome DevTools:

* Cursor changes to indicate resizable edges.
* Live resizing during drag.
* No layout flickering.
* Responsive rendering.
* Virtualized tables continue to perform well after resizing.
* Keyboard accessibility where applicable.

Preferred implementation:

* Use a robust splitter library (e.g., react-resizable-panels or Split.js) for pane resizing.
* Use a headless table library (e.g., TanStack Table) with custom column-resizing support.
* Store layout preferences in Chrome Storage and restore them automatically when DevTools opens.

---

## 27. Network Controls (Chrome DevTools Equivalent)

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

### Performance Requirements

* Switching throttle profiles should take effect immediately.
* Preserve Log should not impact UI performance, even with 100,000+ captured requests.
* Cache state and network profile should remain synchronized with the browser.
* All control states must be restored automatically when DevTools is reopened.


## 28. Backup & Restore (Collections + History)

Saved requests (Collections) and Request History must survive **removing and
re-adding the extension**.

Chrome erases an extension's storage — `chrome.storage.local` *and*
`chrome.storage.sync` — when the extension is removed. Synced data only returns
for Web Store installs on a signed-in profile, so a sideloaded build gets nothing
back. Extension storage therefore cannot satisfy this requirement on its own: the
data must be mirrored **outside** the extension, to a file on disk.

### Requirements

* The user links a **backup file** once (File System Access API).
* Every change to Collections or History is written to that file automatically.
* When the panel opens, the linked file is read and merged back in automatically
  — no interaction beyond having linked the file.
* After a remove/re-add, re-linking the same file restores everything.
* Provide a **Restore from file** and a **Download a copy** path that work
  without a linked file (moving data between machines, one-off snapshots).
* Restores are **non-destructive**: folders and requests are merged, not
  replaced; history is de-duplicated.

### Constraints

* Chrome blocks file pickers in cross-origin iframes, and a DevTools panel is
  one. Picking a file and granting permission must therefore happen on a
  top-level extension page; reads and writes must happen in the service worker.
* Chrome revokes file permissions across browser restarts. The UI must show when
  auto-save needs re-authorising, and it must be a single click to restore.
* Per §24, **keys and IVs are never written to the backup file.** The file does
  contain Bearer tokens saved with a request, and the UI must say so.

---

# Important Constraints

* The UI should closely mimic Chrome's native Network tab in layout, interactions, keyboard shortcuts, and behavior.
* The implementation should be modular and extensible rather than copying Chrome's internal code.
* Performance should remain smooth with tens of thousands of captured requests.
* All features should be implemented incrementally with clear milestones.
* The codebase should be production-ready, well-documented, and maintainable.

Begin by designing the architecture and project structure, then implement features in logical phases with complete, working code for each phase before moving to the next.
