// build/obfuscate.mjs
//
// Produces an obfuscated, load-unpacked-ready copy of the extension in dist/.
//
//   - The three shipped JS files (devtools.js, crypto.js, panel.js) are run
//     through javascript-obfuscator.
//   - Everything else the browser loads (manifest, HTML, CSS, icons) is copied
//     verbatim — those can't be "encrypted" or Chrome won't load them.
//   - selftest.mjs is a Node-only dev tool, not part of the extension, so it is
//     intentionally NOT copied into dist/.
//
// Run with:  npm run build

import { readFile, writeFile, mkdir, rm, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist");

// JS files that ship inside the extension and should be obfuscated.
const JS_TO_OBFUSCATE = ["devtools.js", "crypto.js", "panel.js"];

// Static assets copied byte-for-byte (the browser needs these readable).
const STATIC_EXT = new Set([".json", ".html", ".css", ".png", ".ico", ".svg"]);

// Never ship these into dist/.
const SKIP = new Set(["package.json", "package-lock.json", "selftest.mjs"]);

// MV3-safe obfuscation options.
//   renameGlobals/renameProperties OFF  -> keeps the cross-file `CipherNetCrypto`
//     global and chrome.* / DOM property names intact.
//   debugProtection/selfDefending OFF   -> those inject `new Function(...)`,
//     which the MV3 content-security policy ("script-src 'self'") blocks.
const OPTIONS = {
  target: "browser",
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  selfDefending: false,
  renameGlobals: false,
  renameProperties: false,
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function",
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const entries = await readdir(ROOT, { withFileTypes: true });
  let obfuscated = 0;
  let copied = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (SKIP.has(name)) continue;

    const src = join(ROOT, name);
    const dest = join(DIST, name);

    if (JS_TO_OBFUSCATE.includes(name)) {
      const code = await readFile(src, "utf8");
      const result = JavaScriptObfuscator.obfuscate(code, OPTIONS).getObfuscatedCode();
      await writeFile(dest, result, "utf8");
      console.log(`  obfuscated  ${name}`);
      obfuscated++;
    } else if (STATIC_EXT.has(extname(name).toLowerCase())) {
      await copyFile(src, dest);
      console.log(`  copied      ${name}`);
      copied++;
    } else {
      console.log(`  skipped     ${name}`);
    }
  }

  console.log(`\nDone -> ${DIST}`);
  console.log(`  ${obfuscated} JS file(s) obfuscated, ${copied} asset(s) copied.`);
  console.log(`  Load unpacked from the dist/ folder.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
