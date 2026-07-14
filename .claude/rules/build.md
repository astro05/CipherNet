---
paths:
  - "build/**"
  - "manifest.json"
  - "package.json"
  - "Features.md"
  - "README.md"
---

# Build & Release Conventions

- `npm run build` → `node build/obfuscate.mjs`, obfuscates `src/` into `dist/` (gitignored).
- `npm run pack` → obfuscates then packs into a signed `.crx`, signed with `../ciphernet-key/key.pem` (kept outside the repo on purpose — Chrome warns/rejects unpacked extensions with a `.pem` inside the loaded folder, and this project root is what you'd "Load unpacked" for dev).
- `npm run selftest` → verifies the AES-128-CBC/PKCS7 round-trip against the .NET backend's scheme.
- The version number is tracked in three places that must move together: `manifest.json` (`version`), `package.json` (`version`), and the `**Version:**` line at the top of `Features.md`. `README.md`'s "Last Modified" date should be updated alongside.
- Use the `/release` skill to run this sequence end-to-end.
