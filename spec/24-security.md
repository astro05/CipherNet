# 24. Security

Keys must never be logged.

Sensitive values should be masked, including the Key box's own Key/IV inputs.

Keys can be loaded/saved as an encrypted `.key` file (fixed app passphrase — obfuscation, not a secrecy boundary) — see [31-key-file.md](31-key-file.md).

Support encrypted local storage: Bearer tokens saved with a request (Collections,
Request History, and Saved Responses) are stored as AES-GCM ciphertext, never
plaintext — in `chrome.storage` and in the backup file alike. This covers the
token whether it came from the dedicated Authorization-tab field or a
hand-typed `Authorization` row in the Headers tab — same secret, same
treatment. Same threat model as the [key file](31-key-file.md): a fixed
passphrase built into the extension's own source (obfuscation, not a secrecy
boundary — anyone with the extension's code can decrypt it). What it protects
against is a plaintext token sitting in the backup JSON or in `chrome.storage`,
readable by anything that can open the file/inspect storage without also
having the extension's code. A token stored as an **environment variable**
value instead is not covered — environment variables are a generic
substitution mechanism, not token-specific.

A decrypt failure on a corrupted/tampered stored value throws rather than
silently handing back the ciphertext as if it were the real token (which would
risk a re-save re-encrypting — and permanently burying — the garbage).

No external telemetry.

Offline-first.
