#!/usr/bin/env node
'use strict';

const path = require('node:path');

const metadata = require('../kernel/metadata');
const { loadRuntimeLock } = require('../kernel/runtime/lock-manifest');
const {
  installRuntime,
  runtimeBaseDefault
} = require('../kernel/runtime/installer');
const { doctorRuntime } = require('../kernel/runtime/doctor');
const { repairRuntime } = require('../kernel/runtime/repair');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function currentEnvironment() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    kernel: {
      name: metadata.name,
      version: metadata.version,
      apiVersion: metadata.apiVersion,
      contractVersion: metadata.contractVersion,
      contractDigest: metadata.contractDigest
    }
  };
}

function command(parts) {
  return parts.map((part) => JSON.stringify(String(part))).join(' ');
}

function pluginRepairCommand(pluginRoot = path.resolve(__dirname, '..')) {
  const claudeManifest = path.join(
    pluginRoot,
    '.claude-plugin',
    'plugin.json'
  );
  if (require('node:fs').existsSync(claudeManifest)) {
    return '/plugin marketplace update specnav-marketplace';
  }
  const codeFreeManifest = path.resolve(
    pluginRoot,
    '../..',
    'specnav.manifest.json'
  );
  if (require('node:fs').existsSync(codeFreeManifest)) {
    try {
      const manifest = JSON.parse(
        require('node:fs').readFileSync(codeFreeManifest, 'utf8')
      );
      if (
        manifest.schema === 'specnav.hostPackage.v1'
        && Array.isArray(manifest.modules)
        && manifest.modules.some((entry) => (
          entry
          && entry.name === 'specnav-verification'
          && entry.path === 'modules/specnav-verification'
        ))
      ) {
        return (
          'codefree-o plugin '
          + 'github:zengwenliang416/specnav-codefree-o-plugin -g'
        );
      }
    } catch {
      throw new Error(
        'verification-runtime:invalid-codefree-o-manifest'
      );
    }
  }
  return 'codex plugin marketplace upgrade specnav-marketplace --json';
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];
  const json = args.includes('--json');
  if (!['install', 'doctor', 'repair'].includes(action)) {
    const result = {
      ok: false,
      blockers: [`verification-runtime:unsupported-action:${action || '<missing>'}`]
    };
    process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);
    process.exit(2);
  }

  const version = argValue(args, '--version');
  const runtimeBase = path.resolve(
    argValue(args, '--root', runtimeBaseDefault())
  );
  const projectRoot = path.resolve(
    argValue(args, '--project', process.cwd())
  );
  if (action === 'doctor') {
    let supportedVersion = version;
    try {
      supportedVersion = loadRuntimeLock().runtime_version;
    } catch {
      // A corrupt plugin lock is handled by the doctor and repaired by
      // refreshing the configured marketplace snapshot.
    }
    const installCommand = command([
      'node',
      __filename,
      'install',
      '--version',
      supportedVersion || '<required-version>',
      '--project',
      projectRoot,
      '--root',
      runtimeBase,
      '--json'
    ]);
    const repairCommand = command([
      'node',
      __filename,
      'repair',
      '--version',
      supportedVersion || version || '<required-version>',
      '--project',
      projectRoot,
      '--root',
      runtimeBase,
      '--json'
    ]);
    const doctorCommand = command([
      'node',
      __filename,
      'doctor',
      '--version',
      supportedVersion || version || '<required-version>',
      '--project',
      projectRoot,
      '--root',
      runtimeBase,
      '--json'
    ]);
    const result = doctorRuntime({
      requestedVersion: version,
      environment: currentEnvironment(),
      providerEnvironment: process.env,
      requiresMidscene: args.includes('--requires-midscene'),
      runtimeBase,
      installCommand,
      repairCommand,
      pluginRepairCommand: pluginRepairCommand(),
      environmentRepairCommand: (
        `Use Node.js 20-24 on darwin-arm64, then rerun: ${doctorCommand}`
      )
    });
    process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);
    process.exit(result.ok ? 0 : 2);
  }

  try {
    const runtimeOperation = action === 'repair' ? repairRuntime : installRuntime;
    const result = await runtimeOperation({
      requestedVersion: version,
      environment: currentEnvironment(),
      projectRoot,
      runtimeBase,
      onEvent(event) {
        process.stderr.write(`${JSON.stringify(event)}\n`);
      }
    });
    process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);
  } catch (error) {
    const result = {
      ok: false,
      runtime_version: version,
      runtime_root: version ? path.join(runtimeBase, version) : null,
      blockers: [error instanceof Error ? error.message : String(error)],
      fallback_used: false
    };
    process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  argValue,
  command,
  currentEnvironment,
  main,
  pluginRepairCommand
};
