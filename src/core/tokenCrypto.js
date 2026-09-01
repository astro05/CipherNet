// core/tokenCrypto.js — obfuscates Bearer tokens at rest (chrome.storage +
// backup file), same threat model as core/keyFile.js: a fixed, non-secret
// passphrase built into this file. NOT a secrecy boundary — anyone with the
// extension's source can decrypt it. It only stops a token from sitting as
// plaintext in the backup JSON or chrome.storage. See spec/24-security.md.
const APP_PASSPHRASE = "CipherNet.v1.token-store"; // not a secret — see note above
const PREFIX = "enc1:"; // marks a value this module produced, vs. an older plaintext one

let keyPromise;
function getKey() {
  if (!keyPromise) {
    const digest = crypto.subtle.digest("SHA-256", new TextEncoder().encode(APP_PASSPHRASE));
    keyPromise = digest.then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  return keyPromise;
}

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// plaintext -> `enc1:<iv>.<ciphertext>` (Base64). "" in, "" out.
export async function encryptToken(plain) {
  if (!plain) return "";
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${PREFIX}${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ct))}`;
}

// Reverses encryptToken. Anything not carrying our prefix is passed through
// unchanged, so tokens saved before this feature existed keep working. A value
// that DOES carry the prefix but fails to decrypt (corrupted/tampered/truncated)
// throws rather than being handed back — silently treating ciphertext as if it
// were the real token would let a re-save re-encrypt that garbage, permanently
// losing the original. Callers decide how to surface the failure.
export async function decryptToken(stored) {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored;
  const [ivB64, ctB64] = stored.slice(PREFIX.length).split(".");
  if (!ivB64 || !ctB64) throw new Error("corrupt token ciphertext");
  const key = await getKey();
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivB64) }, key, base64ToBytes(ctB64));
  return new TextDecoder().decode(plainBuf);
}
