#!/usr/bin/env node
/**
 * v0.39.2 — Remove node_modules/cpu-features after `npm install`.
 *
 * `cpu-features` is an optional dependency of `ssh2` — a native C++ addon
 * that ssh2 uses to auto-tune cipher selection. It requires Visual Studio
 * Build Tools to compile on Windows, which most developer machines don't
 * have. Without it ssh2 still works, just picks safer defaults.
 *
 * We can't use npm's `--no-optional` because that would also strip
 * platform-specific binaries from esbuild/rollup/vite which we DO need.
 * So we let npm install everything, then delete cpu-features from disk
 * before electron-builder tries to rebuild it.
 *
 * Runs BOTH as a `postinstall` hook AND as an explicit `node scripts/…`
 * step in build/publish commands, so it works even when npm's install
 * scripts are blocked (npm 10 sometimes ships with `ignore-scripts=true`).
 */

const fs = require('node:fs');
const path = require('node:path');

// Prove the script actually ran — helps diagnose stale zip contents.
console.log('[strip-cpu-features] v0.39.2 — checking node_modules…');

const targets = [
  path.join(__dirname, '..', 'node_modules', 'cpu-features'),
  path.join(__dirname, '..', 'node_modules', 'nan'),
];

let removed = 0;
for (const target of targets) {
  if (fs.existsSync(target)) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[strip-cpu-features] removed ${path.basename(target)}`);
      removed++;
    } catch (e) {
      console.warn(`[strip-cpu-features] could not remove ${target}: ${e.message}`);
    }
  }
}
if (removed === 0) {
  console.log('[strip-cpu-features] nothing to remove (already clean)');
}
