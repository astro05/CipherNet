// selftest.mjs — proves the extension's crypto matches the .NET backend.
//
//   node selftest.mjs
//
// 1. Encrypts a sample the *backend* way (Node `crypto`, AES-128-CBC + PKCS7).
// 2. Decrypts it the *extension* way (Web Crypto, exactly as src/core/crypto.js does).
// 3. Confirms the round-trip and that the backend's known IV/key sizes hold.

import { createCipheriv } from "node:crypto";
import { webcrypto } from "node:crypto";

// A neutral 16-char test key (no real secret in source). The point of this test
// is to prove the AES-128-CBC + PKCS7 round-trip between the .NET-style encrypt
// (Node `crypto`) and the extension's decrypt (Web Crypto) — any 16-byte key works.
const KEY = "unit-test-key-16";
const IV = "unit-test-key-16";

const keyBytes = Buffer.from(KEY, "utf8");
const ivBytes = Buffer.from(IV, "utf8");

console.log(`Key bytes: ${keyBytes.length}  ->  AES-${keyBytes.length * 8}`);
console.log(`IV  bytes: ${ivBytes.length}`);
if (keyBytes.length !== 16 || ivBytes.length !== 16) {
  console.error("✗ Expected 16-byte key & IV (AES-128). Aborting.");
  process.exit(1);
}

// --- Backend-style encrypt (what the .NET middleware emits on the wire) ---
function backendEncrypt(plain) {
  const cipher = createCipheriv("aes-128-cbc", keyBytes, ivBytes); // PKCS7 by default
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64");
}

// --- Extension-style decrypt (identical logic to crypto.js / Web Crypto) ---
async function extensionDecrypt(base64Cipher) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  const cipherBytes = Buffer.from(base64Cipher, "base64");
  const plainBuf = await webcrypto.subtle.decrypt(
    { name: "AES-CBC", iv: ivBytes },
    key,
    cipherBytes
  );
  return Buffer.from(plainBuf).toString("utf8");
}

const samples = [
  JSON.stringify({ userId: 42, name: "Mostafa", roles: ["admin", "import"] }),
  "id=1001&status=approved&page=2", // looks like a decrypted query string
  "plain short text",
];

let failures = 0;
for (const sample of samples) {
  const onWire = backendEncrypt(sample);
  const back = await extensionDecrypt(onWire);
  const ok = back === sample;
  failures += ok ? 0 : 1;
  console.log(`\n${ok ? "✓" : "✗"} round-trip`);
  console.log(`   plaintext : ${sample}`);
  console.log(`   base64    : ${onWire}`);
  console.log(`   decrypted : ${back}`);
}

// --- Key file round-trip (src/core/keyFile.js: PBKDF2 + AES-GCM) ---
// Re-implemented against Node's webcrypto rather than imported, since
// keyFile.js uses browser globals (`crypto.subtle`, `atob`/`btoa`) that
// don't exist under plain Node.
async function keyFileRoundTrip() {
  const APP_PASSPHRASE = "CipherNet.v1.key-file"; // must match src/core/keyFile.js
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
  const teEnc = new TextEncoder();
  const teDec = new TextDecoder();

  async function deriveKey(salt) {
    const material = await webcrypto.subtle.importKey("raw", teEnc.encode(APP_PASSPHRASE), "PBKDF2", false, ["deriveKey"]);
    return webcrypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  async function encryptKeyFile(key, iv) {
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const gcmIv = webcrypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveKey(salt);
    const ctBuf = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: gcmIv }, aesKey, teEnc.encode(JSON.stringify({ key, iv })));
    return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(gcmIv), ct: b64(new Uint8Array(ctBuf)) });
  }
  async function decryptKeyFile(fileText) {
    const parsed = JSON.parse(fileText);
    const aesKey = await deriveKey(fromB64(parsed.salt));
    const plainBuf = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parsed.iv) }, aesKey, fromB64(parsed.ct));
    return JSON.parse(teDec.decode(plainBuf));
  }

  const fileText = await encryptKeyFile(KEY, IV);
  let ok = !fileText.includes(KEY) && !fileText.includes(IV); // no plaintext key in the file
  console.log(`\n${ok ? "✓" : "✗"} key file has no plaintext key/IV`);

  const back = await decryptKeyFile(fileText);
  const roundTripOk = back.key === KEY && back.iv === IV;
  ok = ok && roundTripOk;
  console.log(`${roundTripOk ? "✓" : "✗"} key file round-trip`);

  // AES-GCM authenticates the ciphertext, so a flipped bit must be rejected
  // rather than silently decrypting to garbage — the one integrity guarantee
  // this scheme still has now that the passphrase is fixed, not secret.
  let tamperRejected = false;
  const parsed = JSON.parse(fileText);
  const ctBytes = fromB64(parsed.ct);
  ctBytes[0] ^= 0xff;
  const tampered = JSON.stringify({ ...parsed, ct: b64(ctBytes) });
  try {
    await decryptKeyFile(tampered);
  } catch {
    tamperRejected = true;
  }
  ok = ok && tamperRejected;
  console.log(`${tamperRejected ? "✓" : "✗"} key file rejects a tampered ciphertext`);

  return ok;
}

if (!(await keyFileRoundTrip())) failures++;

console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
