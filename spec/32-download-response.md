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
* **Send → Download** — **Send Encrypted** and **Send Plain** are each split
  buttons: a `▾` segment welded onto the right edge in the same fill
  (Postman-style) opens a one-item menu, **⬇ Download response**. It sends
  exactly like the button it hangs off, then writes the response to a file
  **without rendering it**: the response viewer keeps
  whatever it was showing. The send is still logged to Request History.
  * **Any content type** — the response is taken as a `Blob`. A text-ish body
    (`text/*`, JSON, XML, JavaScript, form-urlencoded, or no `Content-Type`)
    goes through the decrypt + pretty-print path above; anything else (a
    file, an image, any binary) is written byte-for-byte.
  * **Server-chosen filename** — a `Content-Disposition` `filename` is used
    when the server sends one (sanitised to `[\w.-]`); otherwise the name is
    derived as above with the extension taken from the `Content-Type`
    subtype (`application/pdf` → `.pdf`, unknown → `.bin`).
* Nothing is persisted or logged: the file goes straight to the browser's
  download location on an explicit user click (§24 — decrypted plaintext is
  never written to extension storage).
