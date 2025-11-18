#!/usr/bin/env node
/**
 * Dependency footprint and packaging validator for AI Consul.
 * - Ensures critical native deps stay below size budgets
 * - Audits electron-builder config for native module handling
 * - Performs basic platform readiness checks
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const yaml = require('yaml');
const { createRequire } = require('module');

const execAsync = util.promisify(exec);
const requireFromRoot = createRequire(path.join(process.cwd(), 'package.json'));

class DependencyValidator {
  constructor() {
    this.root = process.cwd();
    this.criticalDeps = {
      'onnxruntime-node': {
        maxSize: 50 * 1024 * 1024,
        platforms: ['darwin', 'win32', 'linux'],
        required: true,
        localOnly: true,
      },
      'python-shell': {
        maxSize: 150 * 1024,
        platforms: ['darwin', 'win32', 'linux'],
        required: false,
        localOnly: true,
      },
      ws: {
        maxSize: 250 * 1024,
        platforms: ['all'],
        required: false,
        localOnly: false,
      },
    };
  }

  async run() {
    console.log('🔍 Running dependency validation...\n');
    await this.validatePackageSizes();
    await this.validateElectronBuilder();
    await this.validatePlatformReadiness();
    console.log('\n✅ Validation complete!');
  }

  async validatePackageSizes() {
    for (const [dep, config] of Object.entries(this.criticalDeps)) {
      try {
        const depPath = this.resolveDependencyPath(dep);
        const size = await this.getFolderSize(depPath);
        const withinBudget = size <= config.maxSize;

        console.log(`📦 ${dep}`);
        console.log(`   Location: ${path.relative(this.root, depPath)}`);
        console.log(`   Size: ${this.formatBytes(size)} (budget ${this.formatBytes(config.maxSize)})`);
        console.log(`   Status: ${withinBudget ? '✅ OK' : '⚠️ OVERSIZED'}`);

        if (!withinBudget) {
          console.warn('   ⚠️ Consider dynamic imports or trimming optional files\n');
        } else {
          console.log('');
        }
      } catch (error) {
        if (config.required) {
          console.error(`❌ ${dep} missing. Required for local-first mode.`);
        } else {
          console.log(`ℹ️ ${dep} not installed (optional).`);
        }
      }
    }
  }

  resolveDependencyPath(dep) {
    const pkgPath = requireFromRoot.resolve(`${dep}/package.json`);
    return path.dirname(pkgPath);
  }

  async getFolderSize(folderPath) {
    if (!fs.existsSync(folderPath)) return 0;

    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(folderPath, entry.name);
        if (entry.isDirectory()) {
          return this.getFolderSize(entryPath);
        }
        const stats = await fs.promises.stat(entryPath);
        return stats.size;
      }),
    );

    return sizes.reduce((acc, size) => acc + size, 0);
  }

  async validateElectronBuilder() {
    console.log('🏗️ Auditing electron-builder configuration...\n');
    const builderPath = path.join(this.root, 'electron-builder.yml');
    if (!fs.existsSync(builderPath)) {
      console.warn('⚠️ electron-builder.yml not found, skipping config audit.\n');
      return;
    }

    const rawConfig = fs.readFileSync(builderPath, 'utf8');
    const builderConfig = yaml.parse(rawConfig);

    if (builderConfig.npmRebuild !== true) {
      console.warn('⚠️ npmRebuild should be true when bundling native modules.');
    } else {
      console.log('✅ npmRebuild enabled');
    }

    if (!Array.isArray(builderConfig.asarUnpack) || builderConfig.asarUnpack.length === 0) {
      console.warn('⚠️ asarUnpack missing. Native modules should be unpacked.');
    } else {
      console.log('✅ asarUnpack patterns detected');
    }

    const recommendedPatterns = [
      '!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}',
      '!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}',
      '!**/node_modules/*.d.ts',
      '!**/node_modules/.bin',
      '!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}',
      '!.editorconfig',
      '!**/._*',
      '!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}',
      '!**/{__pycache__,thumbs.db,.flowconfig,.idea,.vs,.nyc_output}',
      '!**/{appveyor.yml,.travis.yml,circle.yml}',
      '!**/{npm-debug.log,yarn.lock,.yarn-integrity,.yarn-metadata.json}',
    ];

    const filePatterns = builderConfig.files || [];
    console.log('\n📋 File exclusion patterns:');
    recommendedPatterns.forEach((pattern) => {
      const included = filePatterns.includes(pattern);
      console.log(`   ${included ? '✅' : '⚠️'} ${pattern}`);
    });
  }

  async validatePlatformReadiness() {
    console.log('\n🖥️ Platform readiness checks...\n');
    const platform = os.platform();
    console.log(`Current platform: ${platform}`);

    const pythonChecks =
      platform === 'win32'
        ? ['py -3 --version', 'python.exe --version']
        : ['python3 --version', 'python --version'];

    let pythonAvailable = false;
    for (const cmd of pythonChecks) {
      if (!cmd) continue;
      // eslint-disable-next-line no-await-in-loop
      const result = await this.checkCommand(cmd);
      if (result) {
        pythonAvailable = true;
        break;
      }
    }
    console.log(`Python: ${pythonAvailable ? '✅ Found' : '⚠️ Not detected'}`);
  }

  async checkCommand(command) {
    try {
      await execAsync(command);
      return true;
    } catch {
      return false;
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(2)} ${units[exponent]}`;
  }
}

new DependencyValidator()
  .run()
  .catch((error) => {
    console.error('\n❌ Validation failed:', error);
    process.exitCode = 1;
  });


