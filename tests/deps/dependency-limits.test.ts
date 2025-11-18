import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const NODE_MODULES = path.join(ROOT, 'node_modules');

async function getDirSize(dirPath: string): Promise<number> {
  let total = 0;
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    const stats = await fs.promises.stat(entryPath);
    if (entry.isDirectory()) {
      total += await getDirSize(entryPath);
    } else {
      total += stats.size;
    }
  }
  return total;
}

describe('Dependency size budgets', () => {
  it('onnxruntime-node stays under 300MB', async () => {
    const depPath = path.join(NODE_MODULES, 'onnxruntime-node');
    if (!fs.existsSync(depPath)) {
      return;
    }
    const sizeBytes = await getDirSize(depPath);
    const sizeMB = sizeBytes / (1024 * 1024);
    console.log(`onnxruntime-node size: ${sizeMB.toFixed(2)}MB`);
    expect(sizeBytes).toBeLessThan(300 * 1024 * 1024);
  });

  it('local-first dependencies stay under 300MB total', async () => {
    const deps = ['onnxruntime-node', 'python-shell', 'node-wav', 'pcm-convert'];
    let total = 0;
    for (const dep of deps) {
      const depPath = path.join(NODE_MODULES, dep);
      if (!fs.existsSync(depPath)) {
        continue;
      }
      const size = await getDirSize(depPath);
      const sizeMB = size / (1024 * 1024);
      console.log(`${dep} size: ${sizeMB.toFixed(2)}MB`);
      total += size;
    }
    const totalMB = total / (1024 * 1024);
    console.log(`Total local-first dependencies: ${totalMB.toFixed(2)}MB`);
    expect(total).toBeLessThan(300 * 1024 * 1024);
  });
});


