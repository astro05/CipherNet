---
paths:
  - "src/core/crypto.js"
  - "src/core/keyFile.js"
  - "src/ui/keyBox.js"
  - "src/services/storage.js"
  - "selftest.mjs"
---

# Crypto & Key Handling Rules

Per `spec/24-security.md`:

- Keys and IVs must never be logged — no `console.log`/`console.error` of key material, and no telemetry of any kind (offline-first, no external calls).
- Mask sensitive values (keys, tokens, decrypted secrets) in any UI element — including the 🔑 Key box's own Key/IV inputs (`type="password"`, no plaintext reveal).
- Stored keys go through `chrome.storage`; don't introduce plaintext persistence outside that path.
- Key files (`src/core/keyFile.js`) must never contain the key/IV as plaintext — only as PBKDF2+AES-GCM ciphertext under the app's fixed `APP_PASSPHRASE`. This is obfuscation, not a secrecy boundary (the passphrase ships in the source) — don't describe it as secure against someone with the extension's code, see `spec/31-key-file.md`.
- The extension mirrors a .NET backend's AES-128-CBC + PKCS7 scheme (see `selftest.mjs`). Any change to key/IV handling must keep the round-trip test passing.
