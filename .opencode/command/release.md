---
description: Cut a release — bump version, run selftest, build, pack, update docs
---

Run the release workflow for version $ARGUMENTS. If no version was given, ask the user for one. Then follow the `release` skill (`.opencode/skills/release/SKILL.md`) and its `checklist.md` exactly — version bump, `npm run selftest`, `npm run build`, `npm run pack`, docs update.
