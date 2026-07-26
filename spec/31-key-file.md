# 31. Encrypted Key File

The 🔑 Key box supports loading the AES key/IV from an **encrypted `.key`
file** (produced outside the extension), so a key never has to be typed or
appear as plaintext in the file or the UI. This is load-only — the extension
does not create/export key files.

### Requirements

* **Load Key File** — opens a file picker (`.key`/`.json`), decrypts the
  chosen file, and the result becomes the active key/IV, same as typing them
  in and clicking Save. No passphrase prompt — the file alone is sufficient.
  * A corrupt/tampered file or a non-key-file JSON fails cleanly (status
    message: "Load failed — not a valid key file") and leaves the current
    key untouched.
* **File format** — JSON: `{ v: 1, salt, iv, ct }` (all three Base64). `ct`
  is AES-GCM ciphertext of `{"key":"...","iv":"..."}`, encrypted with a key
  derived via PBKDF2-SHA256 (≥600,000 iterations, the current OWASP floor)
  and `salt` from a **fixed passphrase built into `src/core/keyFile.js`**
  (`APP_PASSPHRASE`); `iv` here is the 12-byte AES-GCM nonce (unrelated to
  the CipherNet decryption IV carried *inside* the ciphertext).
* **Threat model — read this before assuming more than it provides**: the
  passphrase is not user-supplied and not secret — it ships in the
  extension's own source. This is **obfuscation, not a secrecy boundary**:
  anyone with the extension's code (which is client-side JS — obfuscated by
  the build, but not encrypted or access-controlled) can decrypt any `.key`
  file made for this app. What it *does* provide: the key is never sitting
  in the file as plaintext, so it survives a casual glance, a screenshot, or
  an accidental share the way a plaintext value wouldn't. It does **not**
  protect the key from anyone who has (or extracts) this extension's code.
* **No plaintext key in the UI**: the key/IV inputs in the 🔑 Key box are
  masked (`type="password"`), same as any other sensitive field — no
  exemption for manual entry.
* Loading reuses the existing 🔑 Key box persistence path
  (`chrome.storage.local` via `saveSettings`) — a loaded key is saved exactly
  like a manually-typed one, including cache invalidation
  (`state.entries[*].decrypted/_searchReady` reset) and re-rendering the open
  detail pane / active search.
