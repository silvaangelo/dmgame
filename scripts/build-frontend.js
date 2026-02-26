#!/usr/bin/env node

/**
 * Frontend build script — minifies JS and CSS for production.
 * Copies all frontend files to dist/frontend/ with minified assets.
 *
 * Usage: node scripts/build-frontend.js
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const SRC = path.resolve("frontend");
const DIST = path.resolve("dist", "frontend");

// Clean dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
}
fs.mkdirSync(DIST, { recursive: true });

// Copy all files first (assets, html, libs, etc.)
function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
copyRecursive(SRC, DIST);

// Minify game.js with esbuild
console.log("📦 Minifying game.js...");
execSync(
  `npx esbuild "${path.join(SRC, "game.js")}" --bundle=false --minify --target=es2020 --outfile="${path.join(DIST, "game.js")}"`,
  { stdio: "inherit" }
);

// Minify styles.css with esbuild
console.log("📦 Minifying styles.css...");
execSync(
  `npx esbuild "${path.join(SRC, "styles.css")}" --bundle=false --minify --outfile="${path.join(DIST, "styles.css")}"`,
  { stdio: "inherit" }
);

// Minify msgpack lib
const msgpackSrc = path.join(SRC, "lib", "msgpack.min.js");
if (fs.existsSync(msgpackSrc)) {
  console.log("📦 Copying msgpack.min.js (already minified)...");
  // Already minified, just ensure it's copied (already done above)
}

// Report sizes
const origJS = fs.statSync(path.join(SRC, "game.js")).size;
const minJS = fs.statSync(path.join(DIST, "game.js")).size;
const origCSS = fs.statSync(path.join(SRC, "styles.css")).size;
const minCSS = fs.statSync(path.join(DIST, "styles.css")).size;

console.log(`\n✅ Frontend build complete!`);
console.log(`   game.js:    ${(origJS / 1024).toFixed(1)}KB → ${(minJS / 1024).toFixed(1)}KB (${((1 - minJS / origJS) * 100).toFixed(0)}% smaller)`);
console.log(`   styles.css: ${(origCSS / 1024).toFixed(1)}KB → ${(minCSS / 1024).toFixed(1)}KB (${((1 - minCSS / origCSS) * 100).toFixed(0)}% smaller)`);
console.log(`   Output: ${DIST}/`);
