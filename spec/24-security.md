# 24. Security

Keys must never be logged.

Sensitive values should be masked, including the Key box's own Key/IV inputs.

Keys can be loaded/saved as an encrypted `.key` file (fixed app passphrase — obfuscation, not a secrecy boundary) — see [31-key-file.md](31-key-file.md).

Support encrypted local storage.

No external telemetry.

Offline-first.
