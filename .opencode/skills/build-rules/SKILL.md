---
name: build-rules
description: Build, pack, version, and release conventions. Use when editing or releasing build artifacts — build/**, manifest.json, package.json, Features.md, README.md — the version in manifest.json, package.json, and Features.md must move together; use the release skill or /release command to ship.
---

# Build & Release Conventions

- `npm run build` → `node build/obfuscate.mjs`, obfuscates `src/` into `dist/` (gitignored).
- `npm run pack` → obfuscates then packs into a signed `.crx`, signed with `../ciphernet-key/key.pem` (kept outside the repo on purpose — Chrome warns/rejects unpacked extensions with a `.pem` inside the loaded folder, and this project root is what you'd "Load unpacked" for dev). Output is named `CipherNet-<version>.crx`/`.zip` (version read from the just-built `dist/manifest.json`), so each pack lands with its own filename instead of overwriting the previous one.
- `npm run selftest` → verifies the AES-128-CBC/PKCS7 round-trip against the .NET backend's scheme.
- The version number is tracked in three places that must move together: `manifest.json` (`version`), `package.json` (`version`), and the `**Version:**` line at the top of `Features.md`. `README.md`'s "Last Modified" date should be updated alongside.
- Use the `release` skill (or the `/release` command) to run this sequence end-to-end.
