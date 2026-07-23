# CipherNet

Chrome DevTools extension that mirrors the native Network panel and decrypts CipherNet API traffic (AES-128-CBC/PKCS7). Full requirements: `spec/` (start at `spec/PRD.md`, the index).

## Spec-driven development (mandatory — applies to every contributor, human or agent)

`spec/` is the source of truth — not memory, not this file. Specs are **feature-specific**: one file per feature, indexed from `spec/PRD.md`. `spec/00-overview.md` and `spec/29-important-constraints.md` apply globally.

On every request to implement a new feature or change existing behavior, in this order:

1. **Spec first, before any plan or code:**
   - New feature → create `spec/NN-feature-name.md` (next free number after 29) and add it to the table in `spec/PRD.md`.
   - Change to existing behavior → edit the existing `spec/*.md` file that owns it.
2. Plan the change against the now-current spec.
3. Implement in code, one feature/section at a time — don't build ahead of what's specced.
4. Update user-facing docs (`README.md`, `Features.md`) affected by the change.
5. Bump the version — see `.claude/rules/build.md` for where it's tracked.

Never skip step 1 to "save time." Code without a matching spec file is not done, no matter who's asking.

## Other rules (auto-applied by path)

- `.claude/rules/security.md` — crypto/key-handling rules for `src/core/crypto.js`, `src/ui/keyBox.js`, `src/services/storage.js`, `selftest.mjs`.
- `.claude/rules/build.md` — build, pack, version, and release conventions.
