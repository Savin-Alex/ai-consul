#!/usr/bin/env node
/**
 * Simple artifact size gate to keep Electron bundles within target budgets.
 * Expects electron-builder outputs in the /release directory.
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const releaseDir = path.join(root, 'release');

const thresholds = {
  local: 200 * 1024 * 1024,
  balanced: 250 * 1024 * 1024,
  full: 320 * 1024 * 1024,
};

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function inferVariant(filename) {
  if (filename.toLowerCase().includes('local')) return 'local';
  if (filename.toLowerCase().includes('balanced')) return 'balanced';
  if (filename.toLowerCase().includes('full')) return 'full';
  return 'default';
}

function main() {
  if (!fs.existsSync(releaseDir)) {
    console.warn('⚠️ Release directory not found. Run `pnpm run make` before size validation.');
    process.exit(0);
  }

  const entries = fs
    .readdirSync(releaseDir)
    .map((name) => {
      const filePath = path.join(releaseDir, name);
      const stats = fs.statSync(filePath);
      return { name, path: filePath, size: stats.size, isFile: stats.isFile() };
    })
    .filter((entry) => entry.isFile);

  if (entries.length === 0) {
    console.warn('⚠️ No build artifacts found in release/.');
    process.exit(0);
  }

  let hasFailure = false;
  console.log('📦 Build artifact sizes:\n');
  entries.forEach((entry) => {
    const variant = inferVariant(entry.name);
    const threshold = thresholds[variant];
    const withinBudget = threshold ? entry.size <= threshold : true;

    console.log(`${entry.name}`);
    console.log(`   Size: ${formatMB(entry.size)}${threshold ? ` (budget ${formatMB(threshold)})` : ''}`);
    console.log(`   Status: ${withinBudget ? '✅ OK' : '⚠️ Exceeds budget'}\n`);

    if (threshold && !withinBudget) {
      hasFailure = true;
    }
  });

  if (hasFailure) {
    console.error('❌ One or more artifacts exceed their size budgets.');
    process.exit(1);
  }

  console.log('✅ All artifacts within budget.');
}

main();


