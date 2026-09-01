# 32. Download Response

The API Testing response viewer can save the response body to a file
(Postman's "Download response"), so a large or binary-ish payload can be
kept and opened in another tool instead of being read in the panel.

### Requirements

* **⬇ Download button** — on the response meta line, beside 📌 Save and
  📋 Copy. Available for both a just-sent response and a re-opened
  🗂 Saved response (they share the same viewer).
* **Saves what the Body tab shows** — the decrypted text when the response
  decrypted, the raw body when it didn't. The raw ciphertext of a decrypted
  response stays reachable via 📋 Copy ▾ → Response.
* **Filename** — `<last URL path segment>-<yyyy-mm-dd-hh-mm-ss>.<ext>`,
  sanitised to `[\w.-]`, falling back to `response` when the URL has no
  usable segment. Extension is `.json` when the response `Content-Type`
  says JSON or the text starts with `{`/`[`, otherwise `.txt`.
* **Pretty-printed JSON** — a body saved as `.json` is re-serialised with
  2-space indentation; if it doesn't parse it is written exactly as received.
* **Empty body** — no file is written; the status line says
  "No response body to download."
* Uses the existing `download()` helper in `src/services/exporter.js`
  (Blob + object URL + `<a download>`, revoked after the click) — no new
  permission, no `chrome.downloads`.
* Nothing is persisted or logged: the file goes straight to the browser's
  download location on an explicit user click (§24 — decrypted plaintext is
  never written to extension storage).
