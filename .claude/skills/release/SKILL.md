---
description: Bumps the version number, rebuilds and packs the extension, runs the crypto self-test, and updates docs for a release. Use when the user asks to cut a release, bump the version, or ship a build of CipherNet.
argument-hint: <new-version>
---

## Current version

!`node -p "require('./manifest.json').version"`

## Release steps

1. Set the new version ($ARGUMENTS, or ask the user if omitted) in:
   - `manifest.json` (`version`)
   - `package.json` (`version`)
   - `Features.md` (the `**Version:** ... | **Last Modified:** ...` line — also update the date)
   - `README.md` (same version/date line, if present)
2. Run `npm run selftest` — the crypto round-trip must pass before packing.
3. Run `npm run build`, then `npm run pack`.
4. Confirm `dist/` and the packed `.crx` were produced without errors.
5. Summarize what changed in this release (new features, fixes) for the user to review before they commit.

Use checklist.md in this skill directory as the full pre-flight checklist.
