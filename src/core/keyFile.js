// core/keyFile.js — reads an encrypted key file (see spec/31-key-file.md).
//
// File format: { v: 1, salt, iv, ct } (Base64). `ct` is AES-GCM ciphertext of
// {"key":"...","iv":"..."}, encrypted with a key derived (PBKDF2-SHA256) from
// an app-fixed passphrase below — so the AES key/IV never sits in the file as
// plaintext. This is NOT a secrecy boundary: the passphrase ships in this
// file, so anyone with the extension's source can decrypt any .key file. It
// only stops the key from being casually readable (a glance at the file, a
// screenshot, an accidental share) the way a plaintext value would be.
const APP_PASSPHRASE = "CipherNet.v1.key-file"; // not a secret — see note above

const PBKDF2_ITERATIONS = 600_000; // OWASP-current floor for PBKDF2-HMAC-SHA256

const dec = new TextDecoder();

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_PASSPHRASE), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

// key-file JSON string -> { key, iv }. Throws on a corrupt/tampered or
// non-key-file JSON.
export async function decryptKeyFile(fileText) {
  let parsed;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    throw new Error("not a valid key file");
  }
  if (parsed.v !== 1 || !parsed.salt || !parsed.iv || !parsed.ct) throw new Error("not a valid key file");
  const aesKey = await deriveKey(base64ToBytes(parsed.salt));
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(parsed.iv) }, aesKey, base64ToBytes(parsed.ct));
  const { key, iv } = JSON.parse(dec.decode(plainBuf));
  if (typeof key !== "string") throw new Error("key file missing key");
  return { key, iv: typeof iv === "string" ? iv : "" };
}
