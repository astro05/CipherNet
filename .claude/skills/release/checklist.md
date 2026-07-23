# Release Checklist

## Version bump
- [ ] `manifest.json` `version` updated
- [ ] `package.json` `version` updated
- [ ] `Features.md` header (`**Version:**` / `**Last Modified:**`) updated
- [ ] `README.md` version/date line updated (if present)
- [ ] All four match exactly

## Verification
- [ ] `npm run selftest` passes (AES-128-CBC/PKCS7 round-trip matches the .NET backend)
- [ ] No key/IV material printed anywhere in build or selftest output

## Build & pack
- [ ] `npm run build` completes without errors (`dist/` regenerated)
- [ ] `npm run pack` completes without errors (signed `.crx` produced)
- [ ] `key.pem` still lives outside the repo (`../ciphernet-key/`) — never staged, committed, or copied back into the project folder

## Docs
- [ ] `Features.md` reflects any new/changed features in this release
- [ ] relevant `spec/*.md` section updated if scope or requirements changed
