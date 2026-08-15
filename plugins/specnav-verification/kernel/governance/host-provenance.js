'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_PLUGIN_ROOT = path.resolve(__dirname, '../..');
const HOST_PROVENANCE_ROOT = path.join(
  LOCAL_PLUGIN_ROOT,
  'assets/host-provenance'
);
const SHARED_SCRIPTS = Object.freeze([
  'anchor-scan.js',
  'evidence-runner.js',
  'host-verification-adapter.js',
  'rerun-scope.js',
  'scenario-registry-loader.js',
  'validation-receipt-authority.js',
  'verification-migrate.js',
  'verification-runtime.js',
  'verification-v2-repair-loop.js',
  'verification-v2-run.js',
  'verify-domains.js'
]);
const HOST_RUNTIME_FILES = Object.freeze({
  'claude-code': Object.freeze(['scripts/plugin-runtime.js']),
  'codefree-o': Object.freeze(['scripts/plugin-runtime.js']),
  dsh: Object.freeze(['scripts/plugin-runtime.js'])
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readHostProvenance(relative) {
  return fs.readFileSync(path.join(HOST_PROVENANCE_ROOT, relative));
}

function readSourceSkill(relative) {
  return readHostProvenance(path.posix.join('source-skills', relative));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, {
    recursive: true,
    withFileTypes: true
  })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function transformSkill(source, host) {
  if (host === 'claude-code') {
    return source
      .replace(/when a Codex user/g, 'when a Claude Code user')
      .replace(
        /as the Codex entrypoint/g,
        'as the Claude Code entrypoint'
      )
      .replace(/Codex adapter contract/g, 'Claude Code adapter contract')
      .replace(
        /owning Codex plugin resolver/g,
        'owning Claude Code plugin resolver'
      )
      .replace(
        /owning SpecNav Codex plugin resolver/g,
        'owning SpecNav Claude Code plugin resolver'
      )
      .replace(
        /Codex plugin code must use `PLUGIN_ROOT` and explicit /g,
        'Claude Code skills must resolve installed plugin roots and explicit '
      )
      .replace(
        /scripts\/codex-verification-adapter\.js/g,
        'scripts/claude-verification-adapter.js'
      );
  }
  if (host === 'codefree-o') {
    return source
      .replace(/when a Codex user/g, 'when a CodeFree-O user')
      .replace(/as the Codex entrypoint/g, 'as the CodeFree-O entrypoint')
      .replace(/Codex adapter contract/g, 'CodeFree-O adapter contract')
      .replace(
        /owning Codex plugin resolver/g,
        'owning CodeFree-O module resolver'
      )
      .replace(
        /owning SpecNav Codex plugin resolver/g,
        'owning SpecNav CodeFree-O module resolver'
      )
      .replace(
        /Codex plugin code must use `PLUGIN_ROOT` and explicit /g,
        'CodeFree-O skills must resolve module roots from `shell.env` and explicit '
      )
      .replace(
        /scripts\/codex-verification-adapter\.js/g,
        'scripts/codefree-o-verification-adapter.js'
      );
  }
  if (host === 'dsh') {
    return source
      .replace(/when a Codex user/g, 'when a DeepSeek Harness user')
      .replace(/as the Codex entrypoint/g, 'as the DeepSeek Harness entrypoint')
      .replace(/Codex adapter contract/g, 'dsh adapter contract')
      .replace(
        /owning Codex plugin resolver/g,
        'owning SpecNav dsh preset resolver'
      )
      .replace(
        /owning SpecNav Codex plugin resolver/g,
        'owning SpecNav dsh preset resolver'
      )
      .replace(
        /Codex plugin code must use `PLUGIN_ROOT` and explicit /g,
        'DeepSeek Harness skills must resolve the installed preset root and explicit '
      )
      .replace(
        /scripts\/codex-verification-adapter\.js/g,
        'scripts/dsh-verification-adapter.js'
      );
  }
  throw new Error(`verification-provenance:unsupported-host:${host}`);
}

function stageManifest(host) {
  const adapter = host === 'claude-code'
    ? {
        key: 'claude_adapter',
        path: 'scripts/claude-verification-adapter.js'
      }
    : host === 'codefree-o'
      ? {
          key: 'codefree_o_adapter',
          path: 'scripts/codefree-o-verification-adapter.js'
        }
      : host === 'dsh'
        ? {
            key: 'dsh_adapter',
            path: 'scripts/dsh-verification-adapter.js'
          }
        : null;
  if (!adapter) {
    throw new Error(`verification-provenance:unsupported-host:${host}`);
  }
  return {
    schema: 'specnav.stagePlugin.v1',
    plugin: 'specnav-verification',
    stage: 'verification',
    required: true,
    depends_on: [
      'specnav-core',
      'specnav-requirements',
      'specnav-prototype',
      'specnav-development'
    ],
    commands: [
      'specnav-verification',
      'specnav-verify'
    ],
    skills: [
      'specnav-verification',
      'specnav-verification-runtime-status',
      'specnav-verification-runtime-setup',
      'specnav-verify-plan',
      'specnav-verify-facticity',
      'specnav-verify-static',
      'specnav-verify-unit',
      'specnav-verify-redteam',
      'specnav-verify-e2e',
      'specnav-verify-sensory',
      'specnav-verify-rerun',
      'specnav-html-report'
    ],
    contracts: {
      verification: 'scripts/verification-v2-run.js',
      verification_v1_legacy: 'scripts/verify-domains.js',
      [adapter.key]: adapter.path,
      kernel: 'kernel/index.js'
    },
    state_outputs: [
      'openspec/changes/<change>/verify/'
    ]
  };
}

function claudePluginManifest() {
  return {
    name: 'specnav-verification',
    version: '0.7.0',
    description: (
      'Full Verification 2.0 for Claude Code with approved cases, six-domain '
      + 'evidence, repair loops, gates, and review reports.'
    ),
    author: {
      name: 'Wenliang Zeng'
    },
    homepage: 'https://github.com/zengwenliang416/specnav-claude-plugin',
    repository: 'https://github.com/zengwenliang416/specnav-claude-plugin',
    license: 'MIT',
    keywords: [
      'claude-code',
      'openspec',
      'verification',
      'testing',
      'html-report'
    ],
    skills: './skills/',
    defaultEnabled: true
  };
}

function claudeCommandFiles() {
  const command = readHostProvenance(
    'claude-code/specnav-verification.md'
  ).toString('utf8');
  return [
    {
      target: 'commands/specnav-verification.md',
      content: Buffer.from(command)
    },
    {
      target: 'commands/specnav-verify.md',
      content: Buffer.from(command.replace(
        'description: Run the complete SpecNav Verification 2.0 lifecycle',
        'description: Alias for the complete SpecNav Verification 2.0 lifecycle'
      ))
    }
  ];
}

function trustedHostFiles(host) {
  let files;
  if (host === 'claude-code') {
    files = [
      ...claudeCommandFiles(),
      {
        target: 'scripts/claude-verification-adapter.js',
        content: readHostProvenance(
          'claude-code/claude-verification-adapter.js'
        )
      },
      {
        target: 'specnav-stage.json',
        content: jsonBytes(stageManifest(host))
      },
      {
        target: '.claude-plugin/plugin.json',
        content: jsonBytes(claudePluginManifest())
      }
    ];
  } else if (host === 'codefree-o') {
    files = [
      {
        target: 'scripts/codefree-o-verification-adapter.js',
        content: readHostProvenance(
          'codefree-o/codefree-o-verification-adapter.js'
        )
      },
      {
        target: 'specnav-stage.json',
        content: jsonBytes(stageManifest(host))
      }
    ];
  } else if (host === 'dsh') {
    files = [
      {
        target: 'scripts/dsh-verification-adapter.js',
        content: readHostProvenance(
          'dsh/dsh-verification-adapter.js'
        )
      },
      {
        target: 'specnav-stage.json',
        content: jsonBytes(stageManifest(host))
      }
    ];
  } else {
    throw new Error(`verification-provenance:unsupported-host:${host}`);
  }
  return files
    .map((entry) => Object.freeze({
      ...entry,
      target_sha256: sha256(entry.content)
    }))
    .sort((left, right) => left.target.localeCompare(right.target));
}

function canonicalFiles() {
  const exact = new Set(['package.json']);
  for (const directory of ['kernel', 'schemas', 'assets']) {
    for (const file of listFiles(path.join(LOCAL_PLUGIN_ROOT, directory))) {
      exact.add(
        path.relative(LOCAL_PLUGIN_ROOT, file).split(path.sep).join('/')
      );
    }
  }
  for (const script of SHARED_SCRIPTS) {
    exact.add(path.posix.join('scripts', script));
  }
  const transformed = [];
  for (const file of listFiles(path.join(LOCAL_PLUGIN_ROOT, 'skills'))) {
    const relative = path
      .relative(LOCAL_PLUGIN_ROOT, file)
      .split(path.sep)
      .join('/');
    if (path.basename(file) === 'SKILL.md') {
      transformed.push(relative);
    } else {
      exact.add(relative);
    }
  }
  return {
    exact: [...exact].sort(),
    transformed: transformed.sort()
  };
}

function exactTreeDigest(files) {
  const records = files
    .map((relative) => (
      `${relative}\0${sha256(fs.readFileSync(path.join(
        LOCAL_PLUGIN_ROOT,
        relative
      )))}`
    ))
    .sort();
  return sha256(records.join('\n'));
}

function createHostSyncPlan(host) {
  const files = canonicalFiles();
  const transformedFiles = files.transformed.map((relative) => {
    const source = readSourceSkill(relative).toString('utf8');
    const content = Buffer.from(transformSkill(source, host));
    return Object.freeze({
      source: relative,
      target: relative,
      transform: host === 'claude-code'
        ? 'claude-code-skill-v1'
        : host === 'dsh'
          ? 'dsh-skill-v1'
          : 'codefree-o-skill-v1',
      source_sha256: sha256(source),
      target_sha256: sha256(content),
      content
    });
  });
  const hostFiles = trustedHostFiles(host);
  return Object.freeze({
    host,
    exactFiles: Object.freeze(files.exact),
    sourceTreeDigest: exactTreeDigest(files.exact),
    transformedFiles: Object.freeze(transformedFiles),
    hostFiles: Object.freeze(hostFiles),
    hostRuntimeFiles: HOST_RUNTIME_FILES[host]
  });
}

function resolveHostSyncPlan(host, manifest = null) {
  const supported = new Set(['claude-code', 'codefree-o', 'dsh']);
  if (supported.has(host)) return createHostSyncPlan(host);
  if (supported.has(manifest?.host)) {
    return createHostSyncPlan(manifest.host);
  }
  const transforms = Array.isArray(manifest?.transformed_files)
    ? manifest.transformed_files.map((entry) => entry?.transform)
    : [];
  if (transforms.some((value) => value === 'claude-code-skill-v1')) {
    return createHostSyncPlan('claude-code');
  }
  if (transforms.some((value) => value === 'codefree-o-skill-v1')) {
    return createHostSyncPlan('codefree-o');
  }
  return null;
}

module.exports = {
  HOST_PROVENANCE_ROOT,
  HOST_RUNTIME_FILES,
  LOCAL_PLUGIN_ROOT,
  SHARED_SCRIPTS,
  createHostSyncPlan,
  resolveHostSyncPlan,
  sha256,
  stageManifest,
  transformSkill
};
