#!/usr/bin/env node

/**
 * Frontend build script — minifies JS and CSS for production.
 * Copies all frontend files to dist/frontend/ with minified assets.
 *
 * Usage: node scripts/build-frontend.js
 */

import esbuild from "esbuild";
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

// Minify game.js with esbuild API (no npx needed)
console.log("📦 Minifying game.js...");
await esbuild.build({
  entryPoints: [path.join(SRC, "game.js")],
  outfile: path.join(DIST, "game.js"),
  bundle: false,
  minify: true,
  target: "es2020",
  allowOverwrite: true,
});

// Minify styles.css with esbuild API
console.log("📦 Minifying styles.css...");
await esbuild.build({
  entryPoints: [path.join(SRC, "styles.css")],
  outfile: path.join(DIST, "styles.css"),
  bundle: false,
  minify: true,
  allowOverwrite: true,
});

// Report sizes
const origJS = fs.statSync(path.join(SRC, "game.js")).size;
const minJS = fs.statSync(path.join(DIST, "game.js")).size;
const origCSS = fs.statSync(path.join(SRC, "styles.css")).size;
const minCSS = fs.statSync(path.join(DIST, "styles.css")).size;

console.log(`\n✅ Frontend build complete!`);
console.log(`   game.js:    ${(origJS / 1024).toFixed(1)}KB → ${(minJS / 1024).toFixed(1)}KB (${((1 - minJS / origJS) * 100).toFixed(0)}% smaller)`);
console.log(`   styles.css: ${(origCSS / 1024).toFixed(1)}KB → ${(minCSS / 1024).toFixed(1)}KB (${((1 - minCSS / origCSS) * 100).toFixed(0)}% smaller)`);
console.log(`   Output: ${DIST}/`);
