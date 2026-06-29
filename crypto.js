// crypto.js — AES-128-CBC decrypt/encrypt that mirrors the CipherNet backend.
//
// Backend reference (EncryptionMiddleware.cs):
//   Aes aes = Aes.Create();                       // CBC + PKCS7 (the .NET defaults)
//   aes.Key = UTF8("<your 16-char key>");         // 16 bytes  -> AES-128
//   aes.IV  = UTF8("<same as key>");              // 16 bytes
//   ciphertext is Base64-encoded on the wire (request body, query string, response body)
//
// The key/IV are entered by the user in the panel (nothing is baked in here).
// Web Crypto's AES-CBC uses PKCS7 padding, so it matches the .NET output exactly.

const CipherNetCrypto = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function strToBytes(str) {
    return enc.encode(str);
  }

  function base64ToBytes(b64) {
    const clean = String(b64).replace(/\s+/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(buffer) {
    const arr = new Uint8Array(buffer);
    let bin = "";
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  async function importKey(keyStr, usages) {
    if (!keyStr) throw new Error("No key set — enter the AES key in the 🔑 Key box");
    return crypto.subtle.importKey(
      "raw",
      strToBytes(keyStr),
      { name: "AES-CBC" },
      false,
      usages
    );
  }

  // Decrypt a Base64 ciphertext string -> UTF-8 plaintext.
  // If ivStr is empty the key is reused as the IV (the backend uses key === IV).
  async function decrypt(base64Cipher, keyStr, ivStr) {
    const key = await importKey(keyStr, ["decrypt"]);
    const iv = strToBytes(ivStr || keyStr);
    const cipherBytes = base64ToBytes(base64Cipher);
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      key,
      cipherBytes
    );
    return dec.decode(plainBuf);
  }

  // Encrypt UTF-8 plaintext -> Base64 ciphertext (handy for crafting requests).
  async function encrypt(plainText, keyStr, ivStr) {
    const key = await importKey(keyStr, ["encrypt"]);
    const iv = strToBytes(ivStr || keyStr);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      key,
      strToBytes(plainText)
    );
    return bytesToBase64(cipherBuf);
  }

  // Try several candidate encodings of the same blob and return the first that
  // decrypts cleanly. Useful for query strings that may be percent-encoded.
  async function tryDecrypt(candidates, keyStr, ivStr) {
    const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
    let lastErr = null;
    for (const c of list) {
      try {
        return { ok: true, text: await decrypt(c, keyStr, ivStr) };
      } catch (e) {
        lastErr = e;
      }
    }
    return { ok: false, error: lastErr ? lastErr.message : "no input" };
  }

  return { decrypt, encrypt, tryDecrypt, base64ToBytes, bytesToBase64 };
})();
