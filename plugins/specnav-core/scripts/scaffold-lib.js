#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./specnav-lib');

function usage(scriptName, extra = '') {
  return [
    `Usage: node ${scriptName} [--project <dir>] [--change <id>] [--force] [--dry-run] [--json]`,
    '',
    'Scaffold SpecNav skill assets into an OpenSpec project without validating or inventing decisions.',
    '',
    'Options:',
    '  --project <dir>  Project root. Defaults to PROJECT_DIR, PWD, or current directory.',
    '  --change <id>    Required for change-level artifacts unless the script says otherwise.',
    '  --force          Overwrite existing files.',
    '  --dry-run        Report planned writes without writing files.',
    '  --json           Print machine-readable result.',
    '  --help           Show help.',
    extra ? `\n${extra}` : ''
  ].filter(Boolean).join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    project: null,
    change: null,
    force: false,
    dryRun: false,
    json: false,
    help: false,
    values: {},
    errors: []
  };

  function readValue(flag, index) {
    const value = argv[index + 1] || '';
    if (!value || value.startsWith('--')) {
      options.errors.push(`missing-option-value:${flag}`);
      return { value: null, nextIndex: index };
    }
    return { value, nextIndex: index + 1 };
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--project') {
      const parsed = readValue('--project', index);
      options.project = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--change') {
      const parsed = readValue('--change', index);
      options.change = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, ...rest] = arg.slice(2).split('=');
      const value = rest.join('=');
      if (!value) options.errors.push(`missing-option-value:--${key}`);
      else options.values[key] = value;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const parsed = readValue(`--${key}`, index);
      if (parsed.value !== null) options.values[key] = parsed.value;
      index = parsed.nextIndex;
    }
  }

  return options;
}

function invalidChangeId(value) {
  if (!value || value === '.' || value === '..') return true;
  return value.includes('/') || value.includes('\\') || value.includes('..') || /\s/.test(value);
}

function projectRoot(options) {
  return path.resolve(options.project || process.env.PROJECT_DIR || process.env.PWD || process.cwd());
}

function requireOpenSpec(root) {
  const dir = path.join(root, 'openspec');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return {
      ok: false,
      blockers: ['missing-openspec'],
      message: `OpenSpec directory not found: ${dir}`
    };
  }
  return { ok: true, blockers: [] };
}

function strictActiveChange(root, explicitChange) {
  const fromArg = explicitChange || null;
  const fromEnv = process.env.SPECNAV_CHANGE || null;
  const activeFile = path.join(lib.specnavDir(root), 'active-change');
  const fromFile = fs.existsSync(activeFile) ? fs.readFileSync(activeFile, 'utf8').trim() : null;
  const change = fromArg || fromEnv || fromFile;

  if (invalidChangeId(change)) {
    return {
      ok: false,
      change: null,
      blockers: ['active-change'],
      message: 'A clean active change is required. Set --change, SPECNAV_CHANGE, or openspec/.specnav/active-change.'
    };
  }

  const dir = path.join(root, 'openspec', 'changes', change);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return {
      ok: false,
      change,
      blockers: [`missing-change-dir:${change}`],
      message: `Active change directory not found: ${dir}`
    };
  }

  return {
    ok: true,
    change,
    dir,
    blockers: []
  };
}

function replacements(values = {}) {
  const now = new Date().toISOString();
  const branch = values.branch || 'ui-html';
  const prototypeEntries = {
    'ui-html': 'artifact/index.html',
    'logic-state': 'logic/harness.js',
    'api-contract': 'api/examples.json',
    'data-flow': 'data-flow-map.md',
    'component-seam': 'component/component-map.md'
  };
  return {
    SPECNAV_CHANGE: values.change || '<active-change>',
    SPECNAV_CREATED_AT: now,
    SPECNAV_RELEASE_TARGET: values.releaseTarget || values['release-target'] || '<release-target>',
    SPECNAV_TASK_ID: values.taskId || values['task-id'] || '<task-id>',
    SPECNAV_PROTOTYPE_BRANCH: branch,
    SPECNAV_PROTOTYPE_ENTRY: prototypeEntries[branch] || '<prototype-entry>'
  };
}

function renderTemplate(text, values) {
  return Object.entries(values).reduce((output, [key, value]) => {
    return output.split(`{{${key}}}`).join(String(value));
  }, text);
}

function pathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function copyTemplateFile(source, target, options, values) {
  const exists = fs.existsSync(target);
  if (exists && !options.force) {
    return { status: 'skipped', source, target, reason: 'exists' };
  }

  const content = renderTemplate(fs.readFileSync(source, 'utf8'), values);
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { status: exists ? 'overwritten' : 'created', source, target };
}

function copyTemplateTree(sourceDir, targetDir, options, values, filter = null) {
  const results = [];
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (filter && entry.name !== filter) continue;
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...copyTemplateTree(source, target, options, values));
      continue;
    }
    if (entry.isFile()) {
      results.push(copyTemplateFile(source, target, options, values));
    }
  }
  return results;
}

function emit(result, json) {
  if (json) {
    fs.writeSync(process.stdout.fd, `${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (!result.ok) {
    fs.writeSync(process.stderr.fd, `${result.message || 'blocked'}\n`);
    for (const blocker of result.blockers || []) {
      fs.writeSync(process.stderr.fd, `- ${blocker}\n`);
    }
    return;
  }

  for (const item of result.files || []) {
    fs.writeSync(process.stdout.fd, `${item.status}: ${path.relative(result.project_root, item.target)}\n`);
  }
}

function runScaffold(config) {
  const options = parseArgs();
  if (options.help) {
    process.stdout.write(`${usage(path.basename(process.argv[1]), config.extraHelp)}\n`);
    return 0;
  }

  const root = projectRoot(options);
  if (options.errors.length) {
    const result = {
      ok: false,
      project_root: root,
      blockers: options.errors,
      message: 'Invalid scaffold command options.'
    };
    emit(result, options.json);
    return 2;
  }

  const openSpec = requireOpenSpec(root);
  if (!openSpec.ok) {
    const result = { ok: false, project_root: root, blockers: openSpec.blockers, message: openSpec.message };
    emit(result, options.json);
    return 2;
  }

  let change = null;
  let changeDir = null;
  if (config.requiresChange) {
    const active = strictActiveChange(root, options.change);
    if (!active.ok) {
      const result = { ok: false, project_root: root, blockers: active.blockers, message: active.message };
      emit(result, options.json);
      return 2;
    }
    change = active.change;
    changeDir = active.dir;
  }

  const values = replacements({ ...options.values, change });
  const files = [];
  let items;
  try {
    items = config.items(options, { root, change, changeDir, values });
  } catch (error) {
    const result = {
      ok: false,
      project_root: root,
      active_change: change,
      blockers: [error.blocker || 'invalid-scaffold-options'],
      message: error.message
    };
    emit(result, options.json);
    return 2;
  }

  for (const item of items) {
    if (!pathInside(root, item.target)) {
      const result = {
        ok: false,
        project_root: root,
        active_change: change,
        blockers: ['scaffold-target-escape'],
        message: `Refusing to scaffold outside project root: ${item.target}`
      };
      emit(result, options.json);
      return 2;
    }
    files.push(...copyTemplateTree(item.source, item.target, options, values, item.filter || null));
  }

  const result = {
    ok: true,
    project_root: root,
    active_change: change,
    dry_run: options.dryRun,
    force: options.force,
    files
  };
  emit(result, options.json);
  return 0;
}

module.exports = {
  copyTemplateFile,
  copyTemplateTree,
  emit,
  parseArgs,
  pathInside,
  requireOpenSpec,
  runScaffold,
  strictActiveChange,
  usage
};
