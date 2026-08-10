'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const localMetadata = require('../metadata');
const { canonicalValue } = require('../cases/canonical');
const { resolveHostSyncPlan } = require('./host-provenance');

const SNAPSHOT_SCHEMA = 'specnav.verification.compatibility-snapshot.v1';
const LOCAL_PLUGIN_ROOT = path.resolve(__dirname, '../..');
const BLOCKER_LITERAL = /['"`]([a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9:._/-]*)+)['"`]/gi;
const IGNORED_LITERAL_PREFIXES = Object.freeze([
  'about:',
  'data:',
  'file:',
  'http:',
  'https:',
  'node:'
]);
const REPORT_MODEL_FILES = Object.freeze([
  'kernel/reporting/report-model-builder.js',
  'kernel/reporting/report-authorities.js',
  'kernel/reporting/report-selectors.js',
  'schemas/report-model.schema.json'
]);
const ARCHITECTURE_PATTERNS = Object.freeze([
  {
    id: 'direct-kernel-internal-import',
    pattern: /require\s*\([^)]*kernel\//
  },
  {
    id: 'duplicate-kernel-service',
    pattern: /\bcreate(?:DecisionEngine|EvidenceStore|ReadingEvaluator|ReportModelBuilder|SixDomainAggregator)\b/
  },
  {
    id: 'manual-domain-aggregation',
    pattern: /\bdomain_results\s*=/
  },
  {
    id: 'manual-release-verdict',
    pattern: /\brelease\.status\s*=/
  }
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function stableDigest(value) {
  return sha256(canonicalJson(value));
}

function readJson(file, blockerId = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    if (blockerId) throw new Error(blockerId);
    throw new Error(`verification-drift:json-invalid:${file}`);
  }
}

function assertDirectory(root, blockerId) {
  let resolved;
  try {
    resolved = fs.realpathSync(root);
  } catch {
    throw new Error(blockerId);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(blockerId);
  }
  return resolved;
}

function requiredDirectory(value, blockerId) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(blockerId);
  }
  return assertDirectory(path.resolve(value), blockerId);
}

function safeRelativePath(value, blockerId) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || path.isAbsolute(value)
  ) {
    throw new Error(blockerId);
  }
  const segments = value.replaceAll('\\', '/').split('/');
  if (
    segments.some((segment) => (
      segment.length === 0 || segment === '.' || segment === '..'
    ))
  ) {
    throw new Error(blockerId);
  }
  return segments.join('/');
}

function confinedFile(root, relative, blockerId) {
  const safe = safeRelativePath(relative, blockerId);
  let current = root;
  for (const segment of safe.split('/')) {
    current = path.join(current, segment);
    if (
      fs.existsSync(current)
      && fs.lstatSync(current).isSymbolicLink()
    ) {
      throw new Error(blockerId);
    }
  }
  const resolved = path.resolve(root, safe);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(blockerId);
  }
  return { relative: safe, file: resolved };
}

function listFiles(root, predicate = () => true) {
  const files = [];
  for (const entry of fs.readdirSync(root, {
    recursive: true,
    withFileTypes: true
  })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (predicate(relative)) files.push(relative);
  }
  return files.sort();
}

function fileDigest(root, relative) {
  return sha256(fs.readFileSync(path.join(root, relative)));
}

function digestFiles(root, files) {
  const records = files.map((relative) => ({
    path: relative,
    sha256: fileDigest(root, relative)
  }));
  return {
    digest: stableDigest(records),
    files: records
  };
}

function metadataLiteral(source, name, blockerId) {
  const stringMatch = source.match(
    new RegExp(`const ${name} = ['"]([^'"]+)['"];`)
  );
  if (stringMatch) return stringMatch[1];
  const numberMatch = source.match(
    new RegExp(`const ${name} = ([0-9]+);`)
  );
  if (numberMatch) return Number(numberMatch[1]);
  throw new Error(blockerId);
}

function kernelIdentity(pluginRoot) {
  const metadataFile = path.join(pluginRoot, 'kernel/metadata.js');
  const contractsFile = path.join(pluginRoot, 'kernel/contracts.js');
  const metadataSource = fs.readFileSync(metadataFile, 'utf8');
  const contractsSource = fs.readFileSync(contractsFile, 'utf8');
  const blockerId = 'verification-drift:kernel-identity-invalid';
  const localSourcesMatch = (
    sha256(metadataSource)
      === fileDigest(LOCAL_PLUGIN_ROOT, 'kernel/metadata.js')
    && sha256(contractsSource)
      === fileDigest(LOCAL_PLUGIN_ROOT, 'kernel/contracts.js')
  );
  return Object.freeze({
    name: metadataLiteral(metadataSource, 'name', blockerId),
    version: metadataLiteral(metadataSource, 'version', blockerId),
    api_version: metadataLiteral(metadataSource, 'apiVersion', blockerId),
    contract_version: metadataLiteral(
      metadataSource,
      'contractVersion',
      blockerId
    ),
    contract_digest: localSourcesMatch
      ? localMetadata.contractDigest
      : `source-${sha256(`${metadataSource}\n${contractsSource}`)}`
  });
}

function kernelSourceSnapshot(pluginRoot) {
  const files = listFiles(
    path.join(pluginRoot, 'kernel'),
    (relative) => relative.endsWith('.js')
  ).map((relative) => `kernel/${relative}`);
  const snapshot = digestFiles(pluginRoot, files);
  return Object.freeze({
    digest: snapshot.digest,
    file_count: snapshot.files.length
  });
}

function schemaSnapshot(pluginRoot) {
  const schemaRoot = path.join(pluginRoot, 'schemas');
  const files = fs.readdirSync(schemaRoot)
    .filter((name) => name.endsWith('.schema.json'))
    .sort();
  return Object.freeze(Object.fromEntries(
    files.map((name) => [name, fileDigest(schemaRoot, name)])
  ));
}

function blockerRegistry(pluginRoot) {
  const kernelRoot = path.join(pluginRoot, 'kernel');
  const files = listFiles(kernelRoot, (relative) => relative.endsWith('.js'));
  const ids = new Set();
  for (const relative of files) {
    const source = fs.readFileSync(path.join(kernelRoot, relative), 'utf8');
    for (const match of source.matchAll(BLOCKER_LITERAL)) {
      const id = match[1];
      if (
        !IGNORED_LITERAL_PREFIXES.some((prefix) => id.startsWith(prefix))
      ) {
        ids.add(id);
      }
    }
  }
  const sorted = [...ids].sort();
  return Object.freeze({
    digest: stableDigest(sorted),
    ids: Object.freeze(sorted)
  });
}

function fixtureSnapshot(fixtureRoot, host) {
  const manifest = readJson(path.join(fixtureRoot, 'manifest.json'));
  const blockerId = `verification-drift:fixture-path-unsafe:${host}`;
  const records = [];
  for (const group of ['positive', 'negative']) {
    for (const entry of manifest[group] || []) {
      const fixture = confinedFile(fixtureRoot, entry.file, blockerId);
      records.push({
        group,
        entity_type: entry.entity_type,
        file: fixture.relative,
        expected_field: entry.expected_field || null,
        value: canonicalValue(readJson(fixture.file))
      });
    }
  }
  records.sort((left, right) => (
    left.group.localeCompare(right.group)
    || left.entity_type.localeCompare(right.entity_type)
    || left.file.localeCompare(right.file)
  ));
  return Object.freeze({
    digest: stableDigest(records),
    record_count: records.length
  });
}

function reportModelSnapshot(pluginRoot, fixtureRoot) {
  const files = digestFiles(pluginRoot, REPORT_MODEL_FILES);
  const fixture = readJson(path.join(
    fixtureRoot,
    'positive/report-model.json'
  ));
  return Object.freeze({
    digest: stableDigest({
      generator_sources: files.files,
      normalized_fixture: fixture
    }),
    generator_sources: Object.freeze(files.files)
  });
}

function architectureSnapshot(pluginRoot, hostFiles, host) {
  const blockerId = `verification-drift:host-path-unsafe:${host}`;
  const files = [...new Set(hostFiles || [])]
    .map((relative) => safeRelativePath(relative, blockerId))
    .sort();
  const records = [];
  const violations = [];
  for (const relative of files) {
    const { file } = confinedFile(pluginRoot, relative, blockerId);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      violations.push({
        file: relative,
        rule: 'host-file-missing'
      });
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    records.push({
      path: relative,
      sha256: sha256(source)
    });
    for (const rule of ARCHITECTURE_PATTERNS) {
      if (rule.pattern.test(source)) {
        violations.push({
          file: relative,
          rule: rule.id
        });
      }
    }
  }
  violations.sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.rule.localeCompare(right.rule)
  ));
  return Object.freeze({
    digest: stableDigest(records),
    files: Object.freeze(records),
    violations: Object.freeze(violations)
  });
}

function loadManifest(pluginRoot, manifestFile, host) {
  if (!manifestFile) return null;
  const pathBlocker = `verification-drift:manifest-path-unsafe:${host}`;
  let manifestParent;
  try {
    manifestParent = fs.realpathSync(path.dirname(manifestFile));
  } catch {
    throw new Error(pathBlocker);
  }
  const normalizedManifest = path.join(
    manifestParent,
    path.basename(manifestFile)
  );
  const manifestRelative = path.relative(
    pluginRoot,
    normalizedManifest
  ).split(path.sep).join('/');
  const confined = confinedFile(
    pluginRoot,
    manifestRelative,
    pathBlocker
  );
  if (!fs.existsSync(confined.file)) {
    throw new Error(`verification-drift:manifest-missing:${host}`);
  }
  return Object.freeze({
    relative: confined.relative,
    value: readJson(
      confined.file,
      `verification-drift:manifest-invalid:${host}`
    )
  });
}

function manifestSnapshot(options) {
  const {
    pluginRoot,
    loadedManifest,
    actualKernel,
    host,
    requiredHostFiles,
    expectedSourceCommit
  } = options;
  if (!loadedManifest) {
    return Object.freeze({
      present: false,
      blockers: Object.freeze([]),
      host_files: Object.freeze([])
    });
  }
  if (!Array.isArray(requiredHostFiles) || requiredHostFiles.length === 0) {
    throw new Error(`verification-drift:host-files-required:${host}`);
  }
  const manifest = loadedManifest.value;
  const trustedPlan = resolveHostSyncPlan(host, manifest);
  const manifestPathBlocker = (
    `verification-drift:manifest-path-unsafe:${host}`
  );
  const blockers = [];
  if (
    manifest.schema !== 'specnav.verification.kernel-sync.v1'
    || manifest.generated !== true
  ) {
    blockers.push('manifest-contract-mismatch');
  }
  const claimedKernel = manifest.kernel || {};
  if (
    claimedKernel.name !== actualKernel.name
    || claimedKernel.version !== actualKernel.version
    || claimedKernel.api_version !== actualKernel.api_version
    || claimedKernel.contract_version !== actualKernel.contract_version
    || claimedKernel.contract_digest !== actualKernel.contract_digest
  ) {
    blockers.push('manifest-kernel-identity-mismatch');
  }
  const files = Array.isArray(manifest.files)
    ? [...manifest.files]
      .map((relative) => (
        safeRelativePath(relative, manifestPathBlocker)
      ))
      .sort()
    : [];
  if (
    trustedPlan
    && canonicalJson(files) !== canonicalJson(trustedPlan.exactFiles)
  ) {
    blockers.push('manifest-file-set-mismatch');
  }
  const missing = files.filter((relative) => (
    !fs.existsSync(
      confinedFile(pluginRoot, relative, manifestPathBlocker).file
    )
  ));
  if (missing.length > 0) {
    blockers.push('manifest-file-missing');
  } else {
    const records = files.map((relative) => (
      `${relative}\0${fileDigest(pluginRoot, relative)}`
    ));
    if (sha256(records.join('\n')) !== manifest.source_tree_digest) {
      blockers.push('manifest-tree-mismatch');
    } else if (
      trustedPlan
      && (
      manifest.source_tree_digest !== trustedPlan.sourceTreeDigest
      || files.some((relative) => (
        fileDigest(pluginRoot, relative)
          !== fileDigest(LOCAL_PLUGIN_ROOT, relative)
      ))
      )
    ) {
      blockers.push('manifest-exact-file-provenance-mismatch');
    }
  }
  const hostFileEntries = Array.isArray(manifest.host_files)
    ? manifest.host_files
    : [];
  const hostFiles = hostFileEntries
      .map((entry) => entry?.target)
      .filter((entry) => typeof entry === 'string')
      .map((relative) => (
        safeRelativePath(relative, manifestPathBlocker)
      ))
      .sort();
  const trustedHostFiles = trustedPlan
    ? trustedPlan.hostFiles.map((entry) => entry.target).sort()
    : hostFiles;
  if (
    trustedPlan
    && canonicalJson(hostFiles) !== canonicalJson(trustedHostFiles)
  ) {
    blockers.push('manifest-host-files-mismatch');
  }
  const hostRuntimeEntries = Array.isArray(manifest.host_runtime_files)
    ? manifest.host_runtime_files
    : [];
  const hostRuntimeFiles = hostRuntimeEntries
    .map((entry) => entry?.target)
    .filter((entry) => typeof entry === 'string')
    .map((relative) => (
      safeRelativePath(relative, manifestPathBlocker)
    ))
    .sort();
  const trustedHostRuntimeFiles = trustedPlan
    ? [...trustedPlan.hostRuntimeFiles].sort()
    : hostRuntimeFiles;
  if (
    trustedPlan
    &&
    canonicalJson(hostRuntimeFiles)
      !== canonicalJson(trustedHostRuntimeFiles)
  ) {
    blockers.push('manifest-host-runtime-files-mismatch');
  }
  const required = [...new Set(requiredHostFiles)]
    .map((relative) => (
      safeRelativePath(relative, manifestPathBlocker)
    ))
    .sort();
  if (
    canonicalJson([...hostFiles, ...hostRuntimeFiles].sort())
      !== canonicalJson(required)
  ) {
    blockers.push('manifest-host-files-mismatch');
  }
  const transformedEntries = Array.isArray(manifest.transformed_files)
    ? manifest.transformed_files
    : [];
  const transformedFiles = transformedEntries
      .map((entry) => entry?.target)
      .filter((entry) => typeof entry === 'string')
      .map((relative) => (
        safeRelativePath(relative, manifestPathBlocker)
      ))
      .sort();
  const trustedTransformedFiles = trustedPlan
    ? trustedPlan.transformedFiles.map((entry) => entry.target).sort()
    : transformedFiles;
  if (
    trustedPlan
    &&
    canonicalJson(transformedFiles)
      !== canonicalJson(trustedTransformedFiles)
  ) {
    blockers.push('manifest-transformed-files-mismatch');
  }
  for (const entry of transformedEntries) {
    if (
      !entry
      || typeof entry.target !== 'string'
      || typeof entry.target_sha256 !== 'string'
    ) {
      blockers.push('manifest-host-file-digest-mismatch');
      continue;
    }
    const target = confinedFile(
      pluginRoot,
      entry.target,
      manifestPathBlocker
    ).file;
    if (
      !fs.existsSync(target)
      || sha256(fs.readFileSync(target)) !== entry.target_sha256
    ) {
      blockers.push('manifest-host-file-digest-mismatch');
      continue;
    }
    const trusted = trustedPlan
      ? trustedPlan.transformedFiles.find((candidate) => (
          candidate.target === entry.target
        ))
      : null;
    if (
      trusted
      && (
        entry.source !== trusted.source
        || entry.transform !== trusted.transform
        || entry.source_sha256 !== trusted.source_sha256
        || entry.target_sha256 !== trusted.target_sha256
        || !fs.readFileSync(target).equals(trusted.content)
      )
    ) {
      blockers.push('manifest-transformed-file-provenance-mismatch');
    }
  }
  for (const entry of hostFileEntries) {
    if (
      !entry
      || typeof entry.target !== 'string'
      || typeof entry.target_sha256 !== 'string'
    ) {
      blockers.push('manifest-host-file-digest-mismatch');
      continue;
    }
    const target = confinedFile(
      pluginRoot,
      entry.target,
      manifestPathBlocker
    ).file;
    if (
      !fs.existsSync(target)
      || sha256(fs.readFileSync(target)) !== entry.target_sha256
    ) {
      blockers.push('manifest-host-file-digest-mismatch');
      continue;
    }
    const trusted = trustedPlan
      ? trustedPlan.hostFiles.find((candidate) => (
          candidate.target === entry.target
        ))
      : null;
    if (
      trusted
      && (
        entry.target_sha256 !== trusted.target_sha256
        || !fs.readFileSync(target).equals(trusted.content)
      )
    ) {
      blockers.push('manifest-host-file-provenance-mismatch');
    }
  }
  for (const entry of hostRuntimeEntries) {
    if (
      !entry
      || typeof entry.target !== 'string'
      || typeof entry.target_sha256 !== 'string'
    ) {
      blockers.push('manifest-host-runtime-file-digest-mismatch');
      continue;
    }
    const target = confinedFile(
      pluginRoot,
      entry.target,
      manifestPathBlocker
    ).file;
    if (
      !fs.existsSync(target)
      || sha256(fs.readFileSync(target)) !== entry.target_sha256
    ) {
      blockers.push('manifest-host-runtime-file-digest-mismatch');
    }
  }
  const expectedFiles = [...new Set([
    ...files,
    ...transformedFiles,
    ...hostFiles,
    ...hostRuntimeFiles,
    loadedManifest.relative
  ])].sort();
  const actualFiles = listFiles(pluginRoot);
  if (canonicalJson(expectedFiles) !== canonicalJson(actualFiles)) {
    blockers.push('manifest-file-set-mismatch');
  }
  if (expectedSourceCommit) {
    if (manifest.source_dirty !== false) {
      blockers.push('manifest-source-dirty');
    }
    if (manifest.source_commit !== expectedSourceCommit) {
      blockers.push('manifest-source-commit-mismatch');
    }
  }
  return Object.freeze({
    present: true,
    schema: manifest.schema || null,
    blockers: Object.freeze([...new Set(blockers)].sort()),
    host_files: Object.freeze(hostFiles),
    source_commit: manifest.source_commit || null,
    source_dirty: manifest.source_dirty !== false
  });
}

function createCompatibilitySnapshot(options = {}) {
  const host = typeof options.host === 'string' && options.host
    ? options.host
    : 'unknown';
  const pluginRoot = requiredDirectory(
    options.pluginRoot,
    `verification-drift:plugin-root-missing:${host}`
  );
  const fixtureRoot = requiredDirectory(
    options.fixtureRoot,
    `verification-drift:fixture-root-missing:${host}`
  );
  const loadedManifest = loadManifest(
    pluginRoot,
    options.manifestFile ? path.resolve(options.manifestFile) : null,
    host
  );
  const kernel = kernelIdentity(pluginRoot);
  const manifest = manifestSnapshot({
    pluginRoot,
    loadedManifest,
    actualKernel: kernel,
    host,
    requiredHostFiles: options.hostFiles,
    expectedSourceCommit: options.expectedSourceCommit || null
  });
  const hostFiles = options.hostFiles || [];
  return Object.freeze({
    schema: SNAPSHOT_SCHEMA,
    host,
    kernel,
    kernel_source: kernelSourceSnapshot(pluginRoot),
    schemas: schemaSnapshot(pluginRoot),
    blocker_registry: blockerRegistry(pluginRoot),
    fixtures: fixtureSnapshot(fixtureRoot, host),
    report_model: reportModelSnapshot(pluginRoot, fixtureRoot),
    architecture: architectureSnapshot(pluginRoot, hostFiles, host),
    manifest
  });
}

module.exports = {
  SNAPSHOT_SCHEMA,
  createCompatibilitySnapshot
};
