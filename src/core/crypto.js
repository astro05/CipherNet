// core/crypto.js — AES-128-CBC decrypt/encrypt that mirrors the CipherNet backend.
//
// Backend reference (EncryptionMiddleware.cs):
//   Aes aes = Aes.Create();                       // CBC + PKCS7 (the .NET defaults)
//   aes.Key = UTF8("<your 16-char key>");         // 16 bytes  -> AES-128
//   aes.IV  = UTF8("<same as key>");              // 16 bytes
//   ciphertext is Base64-encoded on the wire (request body, query string, response body)
//
// The key/IV are entered by the user in the panel (nothing is baked in here).
// Web Crypto's AES-CBC uses PKCS7 padding, so it matches the .NET output exactly.

export const CipherNetCrypto = (() => {
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

  // Strip PKCS7 padding when it's valid, else trailing zero bytes, else leave the
  // bytes untouched. Used by the best-effort (no-pad) decrypt path.
  function stripPadding(bytes) {
    if (!bytes.length) return bytes;
    const n = bytes[bytes.length - 1];
    if (n >= 1 && n <= 16 && n <= bytes.length) {
      let ok = true;
      for (let i = bytes.length - n; i < bytes.length; i++) if (bytes[i] !== n) { ok = false; break; }
      if (ok) return bytes.subarray(0, bytes.length - n);
    }
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return bytes.subarray(0, end);
  }

  // AES-CBC decrypt of raw cipher BYTES WITHOUT Web Crypto's strict PKCS7 check.
  // Web Crypto always validates+strips PKCS7 and throws (empty-message
  // OperationError) when the padding isn't valid — so a response that's
  // zero-padded or oddly padded can't be read. Trick: append a crafted block
  // E(0x10¹⁶ ⊕ Cₙ); Web Crypto then strips that synthetic full-padding block
  // instead of the real last block, and we do our own padding removal.
  // `cipher` must be whole 16-byte blocks. Best-effort — a wrong key still yields
  // garbage.
  async function decryptNoPadBytes(cipher, keyStr, ivStr) {
    if (cipher.length === 0 || cipher.length % 16 !== 0) {
      throw new Error("ciphertext length is not a multiple of 16");
    }
    const encKey = await importKey(keyStr, ["encrypt"]);
    const decKey = await importKey(keyStr, ["decrypt"]);
    const iv = strToBytes(ivStr || keyStr);
    const lastBlock = cipher.subarray(cipher.length - 16);
    const b = new Uint8Array(16);
    for (let i = 0; i < 16; i++) b[i] = 0x10 ^ lastBlock[i]; // 0x10 = full-padding byte
    const eBuf = await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, encKey, b);
    const cExtra = new Uint8Array(eBuf).subarray(0, 16);      // E(b); drop WebCrypto's own pad block
    const combined = new Uint8Array(cipher.length + 16);
    combined.set(cipher, 0);
    combined.set(cExtra, cipher.length);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, decKey, combined);
    return dec.decode(stripPadding(new Uint8Array(plainBuf)));
  }

  // Base64 ciphertext -> plaintext without PKCS7 validation (see above).
  async function decryptNoPad(base64Cipher, keyStr, ivStr) {
    return decryptNoPadBytes(base64ToBytes(base64Cipher), keyStr, ivStr);
  }

  // Lenient decrypt (CryptoJS-compatible): tolerate a ciphertext whose length
  // isn't a multiple of 16 by trimming the ragged tail down to whole 16-byte
  // blocks, then decrypting WITHOUT PKCS7 validation. This mirrors how CryptoJS
  // silently handles non-block-aligned input (which strict Web Crypto rejects
  // outright). Best-effort: a wrong key or a truly-corrupt blob still yields
  // garbage, and the last kept block may be real plaintext rather than padding,
  // so the tail can be slightly off. `dropped` = trailing bytes discarded.
  async function decryptLenient(candidates, keyStr, ivStr) {
    const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
    let lastErr = null;
    for (const c of list) {
      try {
        const bytes = base64ToBytes(c);
        const aligned = bytes.length - (bytes.length % 16);
        if (aligned < 16) throw new Error("fewer than one full 16-byte block");
        const text = await decryptNoPadBytes(bytes.subarray(0, aligned), keyStr, ivStr);
        return { ok: true, text, forced: true, dropped: bytes.length - aligned };
      } catch (e) {
        lastErr = (e && e.message) || lastErr;
      }
    }
    return { ok: false, error: lastErr || "decryption failed" };
  }

  // Strict decrypt first; if every candidate fails, fall back to the best-effort
  // no-pad decrypt so an odd-padded API response still yields text. `forced`
  // marks the fallback so callers can flag it.
  async function tryDecryptLoose(candidates, keyStr, ivStr) {
    const strict = await tryDecrypt(candidates, keyStr, ivStr);
    if (strict.ok) return strict;
    const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
    let lastErr = strict.error;
    for (const c of list) {
      try {
        return { ok: true, text: await decryptNoPad(c, keyStr, ivStr), forced: true };
      } catch (e) {
        lastErr = (e && e.message) || lastErr;
      }
    }
    return { ok: false, error: lastErr || "decryption failed" };
  }

  // Strict/loose decrypt, then AUTO-fall back to the lenient (ragged-tolerant)
  // path when that fails — so a non-block-aligned value still decrypts without
  // the caller having to opt in. Marks `lenient: true` when the fallback ran;
  // on total failure returns the (more informative) loose error.
  async function tryDecryptAuto(candidates, keyStr, ivStr) {
    const res = await tryDecryptLoose(candidates, keyStr, ivStr);
    if (res.ok) return res;
    const l = await decryptLenient(candidates, keyStr, ivStr);
    return l.ok ? { ...l, lenient: true } : res;
  }

  return { decrypt, encrypt, tryDecrypt, tryDecryptLoose, decryptLenient, tryDecryptAuto, decryptNoPad, base64ToBytes, bytesToBase64 };
})();
