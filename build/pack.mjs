// build/pack.mjs
//
// Packs the obfuscated dist/ folder into a signed CRX3 package — the same thing
// chrome://extensions "Pack extension" produces, but reproducible from the CLI.
//
//   - dist/            must exist first (run `npm run build`); `npm run pack`
//                      rebuilds it for you.
//   - key.pem          the private signing key, kept OUTSIDE this repo (in
//                      ../ciphernet-key/) so it never sits inside the folder
//                      you "Load unpacked" in Chrome — Chrome warns/refuses on
//                      unpacked extensions that contain a .pem file alongside
//                      the manifest. Generated on first run and REUSED
//                      afterwards so the extension ID stays stable. Keep it
//                      secret — anyone with it can publish updates that
//                      Chrome treats as the same extension.
//   - CipherNet.crx   the packaged extension (drag onto chrome://extensions).
//   - CipherNet.zip   plain zip of dist/ — this is what the Chrome Web Store
//                      wants if you ever publish there.
//
// Run with:  npm run pack

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crx3 from "crx3";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist");
const MANIFEST = join(DIST, "manifest.json");

const keyPath = join(ROOT, "..", "ciphernet-key", "key.pem");
const crxPath = join(ROOT, "CipherNet.crx");
const zipPath = join(ROOT, "CipherNet.zip");

if (!existsSync(MANIFEST)) {
  console.error(`dist/ not built (missing ${MANIFEST}).\nRun:  npm run build`);
  process.exit(1);
}

const hadKey = existsSync(keyPath);

// Passing just the manifest path tells crx3 to include the whole dist/ folder.
const info = await crx3([MANIFEST], { keyPath, crxPath, zipPath });

console.log(`\nPacked CRX3:`);
console.log(`  extension id : ${info.appId}`);
console.log(`  crx          : ${crxPath}`);
console.log(`  zip          : ${zipPath}`);
console.log(`  key          : ${keyPath}  ${hadKey ? "(reused)" : "(newly generated — keep it safe!)"}`);
console.log(`\nInstall: open chrome://extensions, enable Developer mode, drag CipherNet.crx onto the page.`);
