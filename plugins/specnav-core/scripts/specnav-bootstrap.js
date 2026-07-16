#!/usr/bin/env node
'use strict';

const fs = require('fs');
const lib = require('./specnav-lib');
const workflow = require('./workflow-state');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function usage() {
  return [
    'Usage: node scripts/specnav-bootstrap.js [--tools <tools>] [--force] [--json] [project-dir]',
    '',
    'Initialize OpenSpec for the target project and write SpecNav runtime state.',
    'Refuses tool/library/plugin repositories (repo-profile:tooling) unless --force.',
    'Default tools: claude,codex'
  ].join('\n');
}

function resultBase(root) {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project_root: root,
    command: '/specnav-bootstrap',
    next_actions: ['/specnav-status', '/specnav-requirements']
  };
}

// Repo suitability: SpecNav's foundation specs (ui-design, data-flow,
// component-architecture) and vertical-slice grammar ("user can ...") assume
// a full-stack product application. Tool/library/infra repositories cannot
// honestly produce those artifacts, and forcing them yields empty-shell
// specs and permanent blockers. Detect the mismatch at bootstrap and refuse
// with an explanation instead of failing slowly — overridable with --force.
function detectRepoProfile(root) {
  const exists = (rel) => fs.existsSync(require('path').join(root, rel));
  const signals = { app: [], nonApp: [] };

  if (exists('plugins') && (exists('.claude-plugin') || exists('.codex-plugin') || exists('.agents'))) {
    signals.nonApp.push('plugin-marketplace-layout');
  }
  const pkg = lib.readJson(require('path').join(root, 'package.json'), null);
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const uiDeps = ['react', 'vue', 'next', 'nuxt', 'svelte', '@angular/core', 'uni-app'];
    if (uiDeps.some((d) => deps[d])) signals.app.push('ui-framework-dependency');
    const serverDeps = ['express', 'koa', 'fastify', 'nest', '@nestjs/core'];
    if (serverDeps.some((d) => deps[d])) signals.app.push('server-framework-dependency');
    if (pkg.main && !pkg.private && !signals.app.length) signals.nonApp.push('published-library-shape');
  }
  if (exists('pom.xml') || exists('build.gradle')) signals.app.push('jvm-application-build');
  if (exists('pages') || exists('src/pages') || exists('app/api') || exists('src/views')) signals.app.push('page-or-route-directory');
  if (exists('Skills') || exists('skills') || exists('SKILL.md')) signals.nonApp.push('skill-repository-layout');

  const profile = signals.app.length ? 'application'
    : signals.nonApp.length ? 'tooling'
      : 'unknown';
  return { profile, signals };
}

function bootstrap(root = lib.projectRoot(process.argv), options = {}) {
  const tools = options.tools || 'claude,codex';
  const base = resultBase(root);

  if (!options.force && !fs.existsSync(lib.openspecDir(root))) {
    const detection = detectRepoProfile(root);
    if (detection.profile === 'tooling') {
      return {
        ...base,
        ok: false,
        status: 'unsuitable-repository',
        blockers: ['repo-profile:tooling'],
        repo_profile: detection,
        detail: 'This repository looks like a tool/library/plugin repo, not a product application. '
          + 'SpecNav\'s foundation specs and vertical-slice grammar assume user-facing features; '
          + 'they would produce empty-shell artifacts here. Re-run with --force if you are sure, '
          + 'or skip SpecNav for this repository.'
      };
    }
  }

  if (fs.existsSync(lib.openspecDir(root))) {
    const state = workflow.writeRuntimeArtifacts(root);
    return {
      ...base,
      ok: true,
      status: 'already-initialized',
      blockers: [],
      openspec_dir: 'openspec',
      workflow_state: 'openspec/.specnav/workflow-state.json',
      state_status: state.status
    };
  }

  const cli = lib.runCommand('command -v openspec', {
    cwd: root,
    timeoutMs: 10000
  });
  if (!cli.ok) {
    return {
      ...base,
      ok: false,
      status: 'blocked',
      blockers: ['missing-openspec-cli'],
      detail: cli.stderr || 'openspec command not found'
    };
  }

  const init = lib.runCommand(`openspec --no-color init --tools ${lib.shellQuote(tools)} ${lib.shellQuote(root)}`, {
    cwd: root,
    timeoutMs: 120000
  });
  if (!init.ok) {
    return {
      ...base,
      ok: false,
      status: 'blocked',
      blockers: ['openspec-init-failed'],
      exit_status: init.status,
      stdout: init.stdout,
      stderr: init.stderr
    };
  }
  if (!fs.existsSync(lib.openspecDir(root))) {
    return {
      ...base,
      ok: false,
      status: 'blocked',
      blockers: ['openspec-init-did-not-create-openspec'],
      stdout: init.stdout,
      stderr: init.stderr
    };
  }

  const state = workflow.writeRuntimeArtifacts(root);
  lib.event(root, 'bootstrap.complete', {
    tools,
    workflow_state: 'openspec/.specnav/workflow-state.json'
  });
  return {
    ...base,
    ok: true,
    status: 'initialized',
    blockers: [],
    tools,
    openspec_dir: 'openspec',
    workflow_state: 'openspec/.specnav/workflow-state.json',
    state_status: state.status
  };
}

function toText(result) {
  const lines = [];
  lines.push('# SpecNav Bootstrap');
  lines.push('');
  lines.push(`- status: ${result.status}`);
  lines.push(`- project_root: ${result.project_root}`);
  lines.push(`- blockers: ${(result.blockers || []).join(', ') || '-'}`);
  if (result.workflow_state) lines.push(`- workflow_state: ${result.workflow_state}`);
  if (result.next_actions) lines.push(`- next_actions: ${result.next_actions.join(', ')}`);
  if (result.detail) lines.push(`- detail: ${result.detail}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const root = lib.projectRoot(process.argv);
  const result = bootstrap(root, {
    tools: argValue(args, '--tools', process.env.SPECNAV_BOOTSTRAP_TOOLS || 'claude,codex'),
    force: hasFlag(args, '--force')
  });
  if (hasFlag(args, '--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(toText(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { bootstrap, detectRepoProfile, toText };
