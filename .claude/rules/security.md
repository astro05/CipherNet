---
paths:
  - "src/core/crypto.js"
  - "src/ui/keyBox.js"
  - "src/services/storage.js"
  - "selftest.mjs"
---

# Crypto & Key Handling Rules

Per PRD §24 (Security):

- Keys and IVs must never be logged — no `console.log`/`console.error` of key material, and no telemetry of any kind (offline-first, no external calls).
- Mask sensitive values (keys, tokens, decrypted secrets) in any UI element that isn't the deliberate key-entry/reveal box.
- Stored keys go through `chrome.storage`; don't introduce plaintext persistence outside that path.
- The extension mirrors a .NET backend's AES-128-CBC + PKCS7 scheme (see `selftest.mjs`). Any change to key/IV handling must keep the round-trip test passing.
