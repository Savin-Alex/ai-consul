#!/usr/bin/env tsx
/**
 * Dependency inventory script.
 * Produces JSON describing dependency sizes and whether they include native bindings.
 */
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { createRequire } from 'module';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

interface DepReport {
  name: string;
  version: string;
  sizeBytes: number;
  hasNativeBindings: boolean;
  path: string;
}

interface InventoryReport {
  generatedAt: string;
  nodeVersion: string;
  totalSizeBytes: number;
  dependencies: DepReport[];
}

const root = process.cwd();
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const packageJson = requireFromRoot('./package.json');

async function collectDependencies(): Promise<DepReport[]> {
  const deps = Object.keys(packageJson.dependencies ?? {});
  const reports: DepReport[] = [];

  for (const name of deps) {
    try {
      const depPath = path.dirname(requireFromRoot.resolve(`${name}/package.json`));
      const version = requireFromRoot(`${name}/package.json`).version ?? 'unknown';
      const sizeBytes = await getDirectorySize(depPath);
      const hasNativeBindings = await detectNativeModule(depPath);

      reports.push({
        name,
        version,
        sizeBytes,
        hasNativeBindings,
        path: path.relative(root, depPath),
      });
    } catch (error) {
      console.warn(`⚠️ Unable to resolve dependency "${name}":`, error instanceof Error ? error.message : error);
    }
  }

  return reports.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

async function getDirectorySize(dirPath: string): Promise<number> {
  if (!fs.existsSync(dirPath)) return 0;
  const entries = await readdir(dirPath, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return getDirectorySize(entryPath);
      }
      const fileStat = await stat(entryPath);
      return fileStat.size;
    }),
  );
  return sizes.reduce((acc, size) => acc + size, 0);
}

async function detectNativeModule(dirPath: string): Promise<boolean> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (await detectNativeModule(entryPath)) {
        return true;
      }
    } else if (entry.name.endsWith('.node') || entry.name === 'binding.gyp' || entry.name === 'binding.gypi') {
      return true;
    }
  }
  return false;
}

async function main() {
  const reports = await collectDependencies();
  const totalSizeBytes = reports.reduce((sum, dep) => sum + dep.sizeBytes, 0);
  const report: InventoryReport = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    totalSizeBytes,
    dependencies: reports,
  };

  if (process.argv.includes('--pretty')) {
    console.log(JSON.stringify(report, null, 2));
  } else if (process.argv.includes('--summary')) {
    console.table(
      reports.map((dep) => ({
        name: dep.name,
        sizeMB: (dep.sizeBytes / 1024 / 1024).toFixed(2),
        native: dep.hasNativeBindings ? 'yes' : 'no',
      })),
    );
  } else {
    console.log(JSON.stringify(report));
  }
}

main().catch((error) => {
  console.error('❌ Dependency inventory failed:', error);
  process.exitCode = 1;
});




