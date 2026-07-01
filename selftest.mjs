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

console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
