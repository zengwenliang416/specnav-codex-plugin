#!/usr/bin/env node
'use strict';

const path = require('node:path');

const metadata = require('../kernel/metadata');
const { loadRuntimeLock } = require('../kernel/runtime/lock-manifest');
const {
  installRuntime
} = require('../kernel/runtime/installer');
const { doctorRuntime } = require('../kernel/runtime/doctor');
const { repairRuntime } = require('../kernel/runtime/repair');
const {
  inspectRuntimeScopes,
  loadProviderEnvironment,
  probeMachineComponents,
  selectRuntimeScope
} = require('../kernel/runtime/scope-resolver');

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
  const dshManifest = path.resolve(
    pluginRoot,
    '../..',
    'specnav.suite.json'
  );
  if (require('node:fs').existsSync(dshManifest)) {
    try {
      const manifest = JSON.parse(
        require('node:fs').readFileSync(dshManifest, 'utf8')
      );
      if (
        manifest.schema === 'specnav.dshSuite.v1'
        && Array.isArray(manifest.modules)
        && manifest.modules.some((entry) => (
          entry
          && entry.name === 'specnav-verification'
          && entry.path === 'modules/specnav-verification'
        ))
      ) {
        return (
          'dsh preset: reinstall specnav-dsh-plugin into '
          + '$DSH_HOME/.agent-presets/specnav'
        );
      }
    } catch {
      throw new Error(
        'verification-runtime:invalid-dsh-manifest'
      );
    }
  }
  return 'codex plugin marketplace upgrade specnav-marketplace --json';
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];
  const json = args.includes('--json');
  if (![
    'doctor',
    'inspect',
    'install',
    'repair',
    'select-scope'
  ].includes(action)) {
    const result = {
      ok: false,
      blockers: [`verification-runtime:unsupported-action:${action || '<missing>'}`]
    };
    process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);
    process.exit(2);
  }

  const version = argValue(args, '--version');
  const projectRoot = path.resolve(
    argValue(args, '--project', process.cwd())
  );
  if (args.includes('--root')) {
    const result = {
      ok: false,
      blockers: [{
        id: 'verification-runtime:runtime-root-override-forbidden',
        artifact: '--root',
        detail: 'select project or user scope in .specnav/config.json'
      }],
      fallback_used: false
    };
    process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);
    process.exit(2);
  }
  if (action === 'select-scope') {
    const result = selectRuntimeScope({
      projectRoot,
      scope: argValue(args, '--scope')
    });
    process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);
    process.exit(result.ok ? 0 : 2);
  }

  let supportedVersion = version;
  try {
    supportedVersion = loadRuntimeLock().runtime_version;
  } catch {
    // A corrupt plugin lock is handled by doctor.
  }
  const scopeInspection = inspectRuntimeScopes({
    projectRoot,
    runtimeVersion: supportedVersion || version,
    environment: {}
  });
  const selectCommand = (scope) => command([
    'node',
    __filename,
    'select-scope',
    '--scope',
    scope,
    '--project',
    projectRoot,
    '--json'
  ]);
  scopeInspection.actions = scopeInspection.ok ? [] : [
    {
      id: 'verification-runtime:select-project-scope',
      command: selectCommand('project')
    },
    {
      id: 'verification-runtime:select-user-scope',
      command: selectCommand('user')
    }
  ];
  if (action === 'inspect') {
    const result = {
      ...scopeInspection,
      machine_components: probeMachineComponents({ projectRoot })
    };
    process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);
    process.exit(result.ok ? 0 : 2);
  }
  if (!scopeInspection.ok) {
    process.stdout.write(`${JSON.stringify(scopeInspection, null, json ? 2 : 0)}\n`);
    process.exit(2);
  }
  const runtimeBase = scopeInspection.runtime_base;
  if (action === 'doctor') {
    const providerSelection = loadProviderEnvironment({
      projectRoot,
      scope: scopeInspection.selected_scope,
      environment: process.env
    });
    const installCommand = command([
      'node',
      __filename,
      'install',
      '--version',
      supportedVersion || '<required-version>',
      '--project',
      projectRoot,
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
      '--json'
    ]);
    const result = doctorRuntime({
      requestedVersion: version,
      environment: currentEnvironment(),
      providerEnvironment: providerSelection.environment,
      requiresMidscene: args.includes('--requires-midscene'),
      runtimeBase,
      runtimeScope: scopeInspection.selected_scope,
      scopeSelectionSource: scopeInspection.selection_source,
      providerScope: providerSelection.scope,
      providerSource: providerSelection.source,
      providerFile: providerSelection.file,
      installCommand,
      repairCommand,
      pluginRepairCommand: pluginRepairCommand(),
      environmentRepairCommand: (
        `Use Node.js 20-24 on darwin-arm64, then rerun: ${doctorCommand}`
      )
    });
    if (!providerSelection.ok) {
      result.ok = false;
      result.readiness = 'blocked';
      result.blockers.push(...providerSelection.blockers);
    }
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
    process.stdout.write(`${JSON.stringify({
      ...result,
      runtime_scope: scopeInspection.selected_scope,
      runtime_base: runtimeBase,
      scope_selection_source: scopeInspection.selection_source
    }, null, json ? 2 : 0)}\n`);
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
