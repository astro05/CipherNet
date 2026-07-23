# 8. Decryption Engine

Primary feature.

If request/response matches configured rules:

Automatically decrypt.

Display:

Original

↓

Decrypted

↓

Pretty JSON

Supported modes:

* AES
* AES-GCM
* AES-CBC
* DES
* TripleDES
* RSA
* ECIES
* XOR
* Base64
* Hex
* Custom JavaScript

Architecture must allow plugins for future algorithms.
