#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');

const SCHEMA = 'specnav.repositoryDiscovery.v1';
const DISCOVERY_PATH = path.join('openspec', '.specnav', 'context', 'repository-discovery.json');
const IGNORE_DIRS = new Set(['.git', '.next', '.turbo', 'node_modules', 'dist', 'build', 'coverage']);

const CONFIG_FILES = [
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.js',
  'vite.config.ts',
  'vite.config.mjs',
  'vite.config.cjs',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'i18n-config.ts',
  'i18n-config.js',
  'next-intl.config.js',
  'next-intl.config.mjs',
  'tailwind.config.js',
  'tailwind.config.ts'
];

const DIRECTORY_SIGNALS = [
  {
    path: 'src/app',
    kind: 'route-tree',
    summary: 'App-router style source tree is present.',
    finding: 'application routes',
    target: { spec: 'frontend-backend-data-flow', section: 'Flow Index' },
    confidence: 0.76
  },
  {
    path: 'app',
    kind: 'route-tree',
    summary: 'Root app router directory is present.',
    finding: 'application routes',
    target: { spec: 'frontend-backend-data-flow', section: 'Flow Index' },
    confidence: 0.72
  },
  {
    path: 'src/pages',
    kind: 'route-tree',
    summary: 'Pages-router style source tree is present.',
    finding: 'page routes',
    target: { spec: 'frontend-backend-data-flow', section: 'Flow Index' },
    confidence: 0.72
  },
  {
    path: 'pages',
    kind: 'route-tree',
    summary: 'Root pages router directory is present.',
    finding: 'page routes',
    target: { spec: 'frontend-backend-data-flow', section: 'Flow Index' },
    confidence: 0.7
  },
  {
    path: 'src/routes',
    kind: 'route-tree',
    summary: 'Route directory is present.',
    finding: 'application routes',
    target: { spec: 'frontend-backend-data-flow', section: 'Flow Index' },
    confidence: 0.7
  },
  {
    path: 'routes',
    kind: 'route-tree',
    summary: 'Root route directory is present.',
    finding: 'application routes',
    target: { spec: 'frontend-backend-data-flow', section: 'Flow Index' },
    confidence: 0.66
  },
  {
    path: 'src/api',
    kind: 'api-surface',
    summary: 'API directory is present.',
    finding: 'API surface',
    target: { spec: 'system-architecture', section: 'API Surface' },
    confidence: 0.74
  },
  {
    path: 'src/app/api',
    kind: 'api-surface',
    summary: 'App-router API directory is present.',
    finding: 'API routes',
    target: { spec: 'frontend-backend-data-flow', section: 'Boundary Contracts' },
    confidence: 0.78
  },
  {
    path: 'app/api',
    kind: 'api-surface',
    summary: 'Root app API directory is present.',
    finding: 'API routes',
    target: { spec: 'frontend-backend-data-flow', section: 'Boundary Contracts' },
    confidence: 0.74
  },
  {
    path: 'src/API',
    kind: 'api-surface',
    summary: 'Uppercase API directory is present.',
    finding: 'API surface',
    target: { spec: 'system-architecture', section: 'API Surface' },
    confidence: 0.7
  },
  {
    path: 'API',
    kind: 'api-surface',
    summary: 'Root uppercase API directory is present.',
    finding: 'API surface',
    target: { spec: 'system-architecture', section: 'API Surface' },
    confidence: 0.66
  },
  {
    path: 'src/components',
    kind: 'components',
    summary: 'Component directory is present.',
    finding: 'component inventory',
    target: { spec: 'component-architecture', section: 'Component Taxonomy' },
    confidence: 0.78
  },
  {
    path: 'components',
    kind: 'components',
    summary: 'Root component directory is present.',
    finding: 'component inventory',
    target: { spec: 'component-architecture', section: 'Component Taxonomy' },
    confidence: 0.72
  },
  {
    path: 'src/hooks',
    kind: 'hooks',
    summary: 'Hook directory is present.',
    finding: 'state and hook ownership',
    target: { spec: 'component-architecture', section: 'State Ownership Rules' },
    confidence: 0.7
  },
  {
    path: 'hooks',
    kind: 'hooks',
    summary: 'Root hook directory is present.',
    finding: 'state and hook ownership',
    target: { spec: 'component-architecture', section: 'State Ownership Rules' },
    confidence: 0.66
  },
  {
    path: 'src/services',
    kind: 'services',
    summary: 'Service directory is present.',
    finding: 'service boundary',
    target: { spec: 'system-architecture', section: 'Module Boundaries' },
    confidence: 0.72
  },
  {
    path: 'services',
    kind: 'services',
    summary: 'Root service directory is present.',
    finding: 'service boundary',
    target: { spec: 'system-architecture', section: 'Module Boundaries' },
    confidence: 0.66
  },
  {
    path: 'src/utils',
    kind: 'utilities',
    summary: 'Utility directory is present.',
    finding: 'shared utility boundary',
    target: { spec: 'component-architecture', section: 'Shared Component Extraction Rules' },
    confidence: 0.62
  },
  {
    path: 'utils',
    kind: 'utilities',
    summary: 'Root utility directory is present.',
    finding: 'shared utility boundary',
    target: { spec: 'component-architecture', section: 'Shared Component Extraction Rules' },
    confidence: 0.58
  },
  {
    path: 'dictionaries',
    kind: 'i18n',
    summary: 'Dictionary directory is present.',
    finding: 'internationalization dictionary',
    target: { spec: 'ui-design', section: 'Theme & Internationalization' },
    confidence: 0.82
  },
  {
    path: 'i18n',
    kind: 'i18n',
    summary: 'i18n directory is present.',
    finding: 'internationalization runtime',
    target: { spec: 'ui-design', section: 'Theme & Internationalization' },
    confidence: 0.8
  },
  {
    path: 'locales',
    kind: 'i18n',
    summary: 'Locale directory is present.',
    finding: 'locale files',
    target: { spec: 'ui-design', section: 'Theme & Internationalization' },
    confidence: 0.78
  },
  {
    path: 'src/i18n',
    kind: 'i18n',
    summary: 'Source i18n directory is present.',
    finding: 'internationalization runtime',
    target: { spec: 'ui-design', section: 'Theme & Internationalization' },
    confidence: 0.78
  },
  {
    path: 'src/locales',
    kind: 'i18n',
    summary: 'Source locale directory is present.',
    finding: 'locale files',
    target: { spec: 'ui-design', section: 'Theme & Internationalization' },
    confidence: 0.74
  },
  {
    path: 'theme',
    kind: 'theme',
    summary: 'Theme directory is present.',
    finding: 'theme system',
    target: { spec: 'ui-design', section: 'Theme & Internationalization' },
    confidence: 0.78
  },
  {
    path: 'src/theme',
    kind: 'theme',
    summary: 'Source theme directory is present.',
    finding: 'theme system',
    target: { spec: 'ui-design', section: 'Theme & Internationalization' },
    confidence: 0.74
  }
];

const TEST_DIRS = ['tests', 'test', '__tests__', 'e2e', 'cypress', 'playwright'];

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

function slug(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || 'item';
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function existsAsFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function existsAsDir(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function safeRelative(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return toPosix(relative);
}

function listFiles(root, relativeDir, limit = 20) {
  const start = path.join(root, relativeDir);
  const stack = [start];
  const samples = [];
  let count = 0;

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      count += 1;
      if (samples.length < limit) {
        const relative = safeRelative(root, absolute);
        if (relative) samples.push(relative);
      }
    }
  }

  return { count, samples };
}

function createContext(projectRoot) {
  return {
    projectRoot,
    evidence: [],
    findings: [],
    conflicts: [],
    openItems: [],
    evidenceIds: new Set(),
    findingKeys: new Set()
  };
}

function addEvidence(context, relativePath, kind, summary, details = {}) {
  const normalizedPath = toPosix(relativePath);
  let id = `ev-${slug(`${kind}-${normalizedPath}`)}`;
  let suffix = 2;
  while (context.evidenceIds.has(id)) {
    id = `ev-${slug(`${kind}-${normalizedPath}`)}-${suffix}`;
    suffix += 1;
  }
  context.evidenceIds.add(id);
  context.evidence.push({
    id,
    path: normalizedPath,
    kind,
    summary,
    details
  });
  return id;
}

function addFinding(context, type, summary, foundationTarget, evidenceRefs, confidence) {
  const refs = unique(evidenceRefs);
  if (!refs.length) return null;
  const key = `${type}|${summary}|${foundationTarget.spec}|${refs.join(',')}`;
  if (context.findingKeys.has(key)) return null;
  context.findingKeys.add(key);
  const id = `finding-${slug(type)}-${context.findings.length + 1}`;
  const finding = {
    id,
    type,
    summary,
    foundation_target: foundationTarget,
    evidence_refs: refs,
    confidence: Number(confidence.toFixed(2))
  };
  context.findings.push(finding);
  return finding;
}

function addConflict(context, type, summary, foundationTarget, evidenceRefs, confidence, question, openItem) {
  const refs = unique(evidenceRefs);
  if (!refs.length) return null;
  const conflict = {
    id: `conflict-${slug(type)}-${context.conflicts.length + 1}`,
    type,
    summary,
    foundation_target: foundationTarget,
    evidence_refs: refs,
    confidence: Number(confidence.toFixed(2)),
    question,
    open_item: openItem
  };
  context.conflicts.push(conflict);
  return conflict;
}

function addOpenItem(context, type, question, foundationTarget, evidenceRefs, confidence) {
  const refs = unique(evidenceRefs);
  if (!refs.length) return null;
  const item = {
    id: `open-${slug(type)}-${context.openItems.length + 1}`,
    type,
    question,
    foundation_target: foundationTarget,
    evidence_refs: refs,
    confidence: Number(confidence.toFixed(2))
  };
  context.openItems.push(item);
  return item;
}

function dependencyNames(packageJson) {
  return unique([
    ...Object.keys(isPlainObject(packageJson.dependencies) ? packageJson.dependencies : {}),
    ...Object.keys(isPlainObject(packageJson.devDependencies) ? packageJson.devDependencies : {}),
    ...Object.keys(isPlainObject(packageJson.peerDependencies) ? packageJson.peerDependencies : {})
  ]).sort();
}

function hasAny(names, candidates) {
  return candidates.some((candidate) => names.includes(candidate));
}

function scanPackageJson(context) {
  const file = path.join(context.projectRoot, 'package.json');
  if (!existsAsFile(file)) return null;

  const packageJson = readJson(file);
  if (!isPlainObject(packageJson)) {
    const evidenceId = addEvidence(context, 'package.json', 'package-manifest', 'package.json exists but could not be parsed as an object.');
    addOpenItem(
      context,
      'package-json-parse',
      'Should package.json be repaired before deriving scripts and dependency evidence?',
      { spec: 'system-architecture', section: 'Application Topology' },
      [evidenceId],
      0.9
    );
    return { evidenceId, dependencies: [], scripts: {} };
  }

  const scripts = isPlainObject(packageJson.scripts) ? packageJson.scripts : {};
  const dependencies = dependencyNames(packageJson);
  const evidenceId = addEvidence(context, 'package.json', 'package-manifest', 'package.json scripts and dependencies are available.', {
    name: typeof packageJson.name === 'string' ? packageJson.name : null,
    scripts: Object.keys(scripts).sort(),
    dependencies: dependencies.slice(0, 80)
  });

  if (Object.keys(scripts).length > 0) {
    addFinding(
      context,
      'package-scripts',
      'package.json declares runnable project scripts that should inform setup, test, and verification requirements.',
      { spec: 'system-architecture', section: 'Operational Constraints' },
      [evidenceId],
      0.82
    );
  }

  if (hasAny(dependencies, ['next'])) {
    addFinding(
      context,
      'next-framework',
      'Next.js dependency suggests route, rendering, and API conventions should be reflected in foundation specs.',
      { spec: 'system-architecture', section: 'Application Topology' },
      [evidenceId],
      0.86
    );
  }
  if (hasAny(dependencies, ['vite'])) {
    addFinding(
      context,
      'vite-tooling',
      'Vite dependency suggests frontend build tooling should be reflected in architecture and operational constraints.',
      { spec: 'system-architecture', section: 'Frontend Architecture' },
      [evidenceId],
      0.8
    );
  }
  if (hasAny(dependencies, ['react', 'vue', 'svelte', '@angular/core'])) {
    addFinding(
      context,
      'ui-framework',
      'UI framework dependency suggests component and UI design specs should name framework conventions.',
      { spec: 'component-architecture', section: 'Component Taxonomy' },
      [evidenceId],
      0.78
    );
  }
  if (hasAny(dependencies, ['next-intl', 'react-intl', 'react-i18next', 'i18next', 'vue-i18n'])) {
    addFinding(
      context,
      'i18n-dependency',
      'Internationalization dependency suggests supported locales and default locale must be captured in the UI design spec.',
      { spec: 'ui-design', section: 'Theme & Internationalization' },
      [evidenceId],
      0.82
    );
  }
  if (hasAny(dependencies, ['next-themes', '@theme-ui/core', 'styled-components', '@emotion/react'])) {
    addFinding(
      context,
      'theme-dependency',
      'Theme-related dependency suggests theme modes and toggle policy must be captured in the UI design spec.',
      { spec: 'ui-design', section: 'Theme & Internationalization' },
      [evidenceId],
      0.76
    );
  }
  if (hasAny(dependencies, ['express', 'fastify', 'koa', 'hono', '@nestjs/core'])) {
    addFinding(
      context,
      'server-framework',
      'Server framework dependency suggests API boundaries should be named in the architecture spec.',
      { spec: 'system-architecture', section: 'API Surface' },
      [evidenceId],
      0.74
    );
  }
  if (hasAny(dependencies, ['prisma', 'drizzle-orm', 'typeorm', 'mongoose', 'sequelize'])) {
    addFinding(
      context,
      'database-tooling',
      'Database or ORM dependency suggests persistence ownership should be captured in the system architecture spec.',
      { spec: 'system-architecture', section: 'Database Model' },
      [evidenceId],
      0.76
    );
  }

  return { evidenceId, dependencies, scripts };
}

function scanConfigFiles(context) {
  const found = [];
  for (const relativePath of CONFIG_FILES) {
    if (!existsAsFile(path.join(context.projectRoot, relativePath))) continue;
    const evidenceId = addEvidence(context, relativePath, 'config-file', `${relativePath} config file is present.`);
    found.push({ path: relativePath, evidenceId });

    if (relativePath.startsWith('tsconfig') || relativePath.startsWith('jsconfig')) {
      addFinding(
        context,
        'typescript-config',
        `${relativePath} indicates language and module-resolution conventions that should be reflected in architecture guidance.`,
        { spec: 'system-architecture', section: 'Frontend Architecture' },
        [evidenceId],
        0.68
      );
    }
    if (relativePath.startsWith('vite.config')) {
      addFinding(
        context,
        'vite-config',
        'Vite config indicates frontend build/runtime conventions.',
        { spec: 'system-architecture', section: 'Frontend Architecture' },
        [evidenceId],
        0.78
      );
    }
    if (relativePath.startsWith('next.config')) {
      addFinding(
        context,
        'next-config',
        'Next config indicates route, rendering, and deployment conventions.',
        { spec: 'system-architecture', section: 'Application Topology' },
        [evidenceId],
        0.8
      );
    }
    if (relativePath.startsWith('i18n-config') || relativePath.startsWith('next-intl.config')) {
      addFinding(
        context,
        'i18n-config',
        `${relativePath} indicates locale routing or dictionary conventions.`,
        { spec: 'ui-design', section: 'Theme & Internationalization' },
        [evidenceId],
        0.84
      );
    }
    if (relativePath.startsWith('tailwind.config')) {
      addFinding(
        context,
        'theme-config',
        `${relativePath} may define dark mode, design tokens, or theme conventions.`,
        { spec: 'ui-design', section: 'Theme & Internationalization' },
        [evidenceId],
        0.72
      );
    }
  }
  return found;
}

function scanDirectories(context) {
  const found = [];
  for (const signal of DIRECTORY_SIGNALS) {
    const absolute = path.join(context.projectRoot, signal.path);
    if (!existsAsDir(absolute)) continue;
    const files = listFiles(context.projectRoot, signal.path, 12);
    const evidenceId = addEvidence(context, signal.path, signal.kind, signal.summary, {
      file_count: files.count,
      sample_files: files.samples
    });
    found.push({ signal, evidenceId });
    addFinding(
      context,
      signal.kind,
      `${signal.finding} evidence found at ${signal.path}.`,
      signal.target,
      [evidenceId],
      signal.confidence
    );
  }
  return found;
}

function scanTests(context) {
  const refs = [];
  for (const relativePath of TEST_DIRS) {
    const absolute = path.join(context.projectRoot, relativePath);
    if (!existsAsDir(absolute)) continue;
    const files = listFiles(context.projectRoot, relativePath, 12);
    refs.push(addEvidence(context, relativePath, 'tests', `${relativePath} test directory is present.`, {
      file_count: files.count,
      sample_files: files.samples
    }));
  }
  if (refs.length) {
    addFinding(
      context,
      'test-surface',
      'Repository tests are present and should inform acceptance and component testing expectations.',
      { spec: 'component-architecture', section: 'Testing Expectations' },
      refs,
      0.72
    );
  }
  return refs;
}

function scanWorkflows(context) {
  const workflowDir = path.join(context.projectRoot, '.github', 'workflows');
  if (!existsAsDir(workflowDir)) return [];

  let entries = [];
  try {
    entries = fs.readdirSync(workflowDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const refs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(ya?ml)$/i.test(entry.name)) continue;
    const relativePath = toPosix(path.join('.github', 'workflows', entry.name));
    refs.push(addEvidence(context, relativePath, 'github-workflow', `${relativePath} workflow is present.`));
  }
  if (refs.length) {
    addFinding(
      context,
      'ci-workflows',
      'GitHub Actions workflows are present and should inform operational and verification requirements.',
      { spec: 'system-architecture', section: 'Operational Constraints' },
      refs,
      0.7
    );
  }
  return refs;
}

function addNegotiationSignals(context, packageScan, configs, directories, testRefs) {
  const routeSignals = directories.filter(({ signal }) => signal.kind === 'route-tree');
  if (routeSignals.length > 1) {
    addConflict(
      context,
      'multiple-route-conventions',
      'Multiple route directory conventions were found.',
      { spec: 'frontend-backend-data-flow', section: 'Flow Index' },
      routeSignals.map((item) => item.evidenceId),
      0.78,
      'Which route convention is canonical for new requirements work?',
      'Confirm the canonical routing surface before updating data-flow foundation specs.'
    );
  }

  const hasNextConfig = configs.some((item) => item.path.startsWith('next.config'));
  const hasViteConfig = configs.some((item) => item.path.startsWith('vite.config'));
  if (hasNextConfig && hasViteConfig) {
    addConflict(
      context,
      'multiple-frontend-runtimes',
      'Both Next and Vite config files were found.',
      { spec: 'system-architecture', section: 'Application Topology' },
      configs.filter((item) => item.path.startsWith('next.config') || item.path.startsWith('vite.config')).map((item) => item.evidenceId),
      0.82,
      'Which frontend runtime is authoritative for the feature being specified?',
      'Record the canonical runtime and any secondary tooling before requirements negotiation.'
    );
  }

  const apiRefs = directories.filter(({ signal }) => signal.kind === 'api-surface').map((item) => item.evidenceId);
  if (apiRefs.length > 0) {
    addOpenItem(
      context,
      'api-flow-ownership',
      'Which API flows, validation owners, and error states should be captured for the discovered API surface?',
      { spec: 'frontend-backend-data-flow', section: 'Boundary Contracts' },
      apiRefs,
      0.68
    );
  }

  const componentRefs = directories.filter(({ signal }) => signal.kind === 'components').map((item) => item.evidenceId);
  if (componentRefs.length > 0 && testRefs.length === 0) {
    addOpenItem(
      context,
      'component-test-expectations',
      'What component testing expectations apply to the discovered component surface?',
      { spec: 'component-architecture', section: 'Testing Expectations' },
      componentRefs,
      0.62
    );
  }

  const i18nRefs = directories.filter(({ signal }) => signal.kind === 'i18n').map((item) => item.evidenceId);
  if (i18nRefs.length > 0) {
    addOpenItem(
      context,
      'i18n-locale-policy',
      'Which locales are supported, what is the default locale, and should prototypes show a locale switcher?',
      { spec: 'ui-design', section: 'Theme & Internationalization' },
      i18nRefs,
      0.76
    );
  }

  const themeRefs = directories.filter(({ signal }) => signal.kind === 'theme').map((item) => item.evidenceId);
  if (themeRefs.length > 0) {
    addOpenItem(
      context,
      'theme-mode-policy',
      'Which theme modes are supported, and should prototypes show a theme toggle or explicitly omit it?',
      { spec: 'ui-design', section: 'Theme & Internationalization' },
      themeRefs,
      0.72
    );
  }

  if (packageScan && packageScan.evidenceId && Object.keys(packageScan.scripts).length === 0) {
    addOpenItem(
      context,
      'missing-package-scripts',
      'Which build, test, and validation commands should SpecNav use for this repository?',
      { spec: 'system-architecture', section: 'Operational Constraints' },
      [packageScan.evidenceId],
      0.64
    );
  }
}

function discoverRepository(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const context = createContext(projectRoot);

  const packageScan = scanPackageJson(context);
  const configs = scanConfigFiles(context);
  const directories = scanDirectories(context);
  const testRefs = scanTests(context);
  scanWorkflows(context);
  addNegotiationSignals(context, packageScan, configs, directories, testRefs);

  return {
    schema: SCHEMA,
    project_root: projectRoot,
    generated_at: new Date().toISOString(),
    discovery_path: DISCOVERY_PATH,
    ignored_dirs: Array.from(IGNORE_DIRS).sort(),
    evidence: context.evidence,
    findings: context.findings,
    conflicts: context.conflicts,
    open_items: context.openItems
  };
}

function writeDiscovery(projectRoot, discovery) {
  const file = path.join(projectRoot, DISCOVERY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(discovery, null, 2)}\n`);
  return file;
}

function markdown(discovery, writeFile = null) {
  const lines = [];
  lines.push('# SpecNav Repository Discovery');
  lines.push('');
  lines.push(`- project: \`${discovery.project_root}\``);
  lines.push(`- evidence: ${discovery.evidence.length}`);
  lines.push(`- findings: ${discovery.findings.length}`);
  lines.push(`- conflicts: ${discovery.conflicts.length}`);
  lines.push(`- open items: ${discovery.open_items.length}`);
  if (writeFile) lines.push(`- wrote: \`${writeFile}\``);
  lines.push('');
  lines.push('| Finding | Confidence | Evidence |');
  lines.push('| --- | --- | --- |');
  for (const finding of discovery.findings) {
    lines.push(`| ${finding.summary} | ${finding.confidence} | ${finding.evidence_refs.join('<br>')} |`);
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    write: argv.includes('--write')
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(lib.projectRoot());
  const discovery = discoverRepository(projectRoot);
  const writeFile = args.write ? writeDiscovery(projectRoot, discovery) : null;
  process.stdout.write(args.json ? `${JSON.stringify(discovery, null, 2)}\n` : markdown(discovery, writeFile));
}

if (require.main === module) main();

module.exports = { discoverRepository, writeDiscovery, markdown, SCHEMA, DISCOVERY_PATH };
