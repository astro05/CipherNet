// build/obfuscate.mjs
//
// Produces an obfuscated, load-unpacked-ready copy of the extension in dist/.
//
//   - Every shipped JS file (devtools.js + the src/ ES-module tree) is run
//     through javascript-obfuscator. ES import/export and relative specifiers
//     are preserved, so the obfuscated modules still load as-is.
//   - Everything else the browser loads (manifest, HTML, CSS, icons) is copied
//     verbatim — those can't be "encrypted" or Chrome won't load them.
//   - The directory structure is preserved (dist/src/... mirrors src/...).
//   - Dev-only files (selftest.mjs, build/, spec/, node_modules/, package.json)
//     are intentionally NOT copied into dist/.
//
// Run with:  npm run build

import { readFile, writeFile, mkdir, rm, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, relative, basename } from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist");

// Directories that never ship (build tooling, docs, deps, prior output, VCS).
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "docs", ".git", ".claude"]);
// Individual files that never ship even though their extension might match.
const SKIP_FILES = new Set(["package.json", "package-lock.json", "selftest.mjs", "key.pem"]);
// Static assets copied byte-for-byte (the browser needs these readable).
const STATIC_EXT = new Set([".json", ".html", ".css", ".png", ".ico", ".svg"]);

// MV3-safe obfuscation options.
//   renameGlobals/renameProperties OFF  -> keeps the cross-file `CipherNetCrypto`
//     export, chrome.* / DOM property names and ES import bindings intact.
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

// Collect every shippable file under ROOT, skipping SKIP_DIRS.
async function collect(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collect(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const files = [];
  await collect(ROOT, files);

  let obfuscated = 0;
  let copied = 0;
  for (const src of files) {
    if (SKIP_FILES.has(basename(src))) continue;
    const rel = relative(ROOT, src);
    const ext = extname(src).toLowerCase();
    const dest = join(DIST, rel);
    await mkdir(dirname(dest), { recursive: true });

    if (ext === ".js") {
      const code = await readFile(src, "utf8");
      const result = JavaScriptObfuscator.obfuscate(code, OPTIONS).getObfuscatedCode();
      await writeFile(dest, result, "utf8");
      console.log(`  obfuscated  ${rel}`);
      obfuscated++;
    } else if (STATIC_EXT.has(ext)) {
      await copyFile(src, dest);
      console.log(`  copied      ${rel}`);
      copied++;
    }
    // anything else (README.md, .crx, .zip, .gitignore, …) is skipped
  }

  console.log(`\nDone -> ${DIST}`);
  console.log(`  ${obfuscated} JS file(s) obfuscated, ${copied} asset(s) copied.`);
  console.log(`  Load unpacked from the dist/ folder.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
