#!/usr/bin/env node
'use strict';

// L3 anchor coverage scan. Reads the OPTIONAL ai-annotation-policy foundation
// spec, enumerates code files touched by the active change, and checks each
// in-scope file for an anchor comment (default token `@ai-anchor`).
//
// Governance: advisory by default. It writes verify/static/anchor-report.json
// and an `anchor.coverage` event on every run. It only produces blocking
// `anchor-uncovered:<file>` output when the policy declares `enforcement: gate`
// (a deliberate per-project opt-in). Absent policy => nothing is expected.

const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');
const foundation = runtime.requirePluginScript('specnav-requirements', 'scripts/foundation-specs');

const SCHEMA = 'specnav.verify.anchorReport.v1';
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.rb', '.java',
  '.kt', '.rs', '.php', '.cs', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp',
  '.m', '.mm', '.scala', '.vue', '.svelte'
]);

function isCodeFile(rel) {
  return CODE_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

function isTestFile(rel) {
  return /(^|\/)(tests?|__tests__|spec|specs)(\/|$)/i.test(rel) || /\.(test|spec)\.[a-z]+$/i.test(rel);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimal glob -> RegExp supporting `**` (any path depth) and `*` (segment).
function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1;
      } else {
        out += '[^/]*';
      }
    } else {
      out += escapeRegExp(c);
    }
  }
  out += '$';
  return new RegExp(out);
}

function matchesAnyGlob(rel, globs) {
  return globs.some((glob) => globToRegExp(glob).test(rel));
}

function changedCodeFiles(projectRoot) {
  const diff = lib.runCommand('git diff --name-only HEAD && git ls-files --others --exclude-standard', {
    cwd: projectRoot,
    timeoutMs: 30000
  });
  if (!diff.ok) return { ok: false, files: [] };
  const files = Array.from(new Set(
    diff.stdout.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((file) => file && !file.startsWith('openspec/') && isCodeFile(file) && !isTestFile(file))
  ));
  return { ok: true, files };
}

function scopeGlobs(policy, changeDir) {
  const globs = Array.isArray(policy.seam_globs) ? policy.seam_globs.filter((g) => typeof g === 'string' && g.trim()) : [];
  if (globs.length) return globs;
  if (changeDir) {
    const scope = lib.readFileScope(changeDir);
    if (scope && Array.isArray(scope.include) && scope.include.length) {
      return scope.include.map((root) => (root.endsWith('/') ? `${root}**` : `${root}/**`));
    }
  }
  return [];
}

// Best-effort "key seam" set from codegraph evidence, when a change has an index.
function keySeamFiles(changeDir) {
  if (!changeDir) return new Set();
  const indexPath = path.join(changeDir, 'codegraph', 'evidence-index.json');
  const data = lib.readJson(indexPath, null);
  const files = new Set();
  const entries = data && Array.isArray(data.entries) ? data.entries : [];
  for (const entry of entries) {
    const sources = entry && Array.isArray(entry.source_files) ? entry.source_files : [];
    for (const src of sources) if (typeof src === 'string' && src.trim()) files.add(src.trim());
  }
  return files;
}

function scanAnchors(projectRoot, rel, anchorPattern) {
  const abs = path.join(projectRoot, rel);
  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return { readable: false, anchors: 0, seam_refs: [] };
  }
  const seamRefs = [];
  let anchors = 0;
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(anchorPattern);
    if (idx === -1) continue;
    anchors += 1;
    const rest = line.slice(idx + anchorPattern.length).trim();
    const match = rest.match(/^([A-Za-z][\w-]*)/);
    if (match) seamRefs.push(match[1]);
  }
  return { readable: true, anchors, seam_refs: Array.from(new Set(seamRefs)) };
}

function scan(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const policy = foundation.validateAnnotationPolicy(projectRoot);
  const changeState = lib.activeChangeState(projectRoot);
  const change = changeState.change || null;
  const changeDir = change ? lib.changeDir(projectRoot, change) : null;

  const anchorPattern = policy.anchor_pattern || foundation.DEFAULT_ANCHOR_PATTERN;
  const enforcement = policy.enforcement; // 'advisory' | 'gate' | null
  const gate = enforcement === 'gate';

  const diff = changedCodeFiles(projectRoot);
  const globs = scopeGlobs(policy, changeDir);
  const keySeams = keySeamFiles(changeDir);

  const inScope = diff.files.filter((rel) => (globs.length ? matchesAnyGlob(rel, globs) : true));
  const scanned = inScope.map((rel) => {
    const result = scanAnchors(projectRoot, rel, anchorPattern);
    return {
      file: rel,
      key_seam: keySeams.has(rel),
      anchors_found: result.anchors,
      seam_refs: result.seam_refs,
      covered: result.anchors > 0
    };
  });

  const uncovered = scanned.filter((entry) => !entry.covered).map((entry) => entry.file);
  const coverageRatio = scanned.length === 0 ? 1 : Number(((scanned.length - uncovered.length) / scanned.length).toFixed(4));
  const blockers = gate ? uncovered.map((file) => `anchor-uncovered:${file}`) : [];

  return {
    schema: SCHEMA,
    change,
    policy_present: policy.present,
    enforcement: enforcement || null,
    anchor_pattern: anchorPattern,
    diff_ok: diff.ok,
    scanned,
    coverage_ratio: coverageRatio,
    uncovered,
    blockers,
    ok: blockers.length === 0
  };
}

function writeReport(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const report = scan(projectRoot);
  if (report.change) {
    const changeDir = lib.changeDir(projectRoot, report.change);
    const outPath = path.join(changeDir, 'verify', 'static', 'anchor-report.json');
    lib.writeJson(outPath, report);
    lib.event(projectRoot, 'anchor.coverage', {
      change: report.change,
      coverage_ratio: report.coverage_ratio,
      scanned: report.scanned.length,
      uncovered_count: report.uncovered.length,
      enforcement: report.enforcement || 'none'
    });
  }
  return report;
}

function markdown(report) {
  const lines = [];
  lines.push('# SpecNav Anchor Coverage (L3)');
  lines.push('');
  lines.push(`- change: \`${report.change || 'none'}\``);
  lines.push(`- policy: ${report.policy_present ? report.enforcement || 'present' : 'absent'}`);
  lines.push(`- anchor pattern: \`${report.anchor_pattern}\``);
  lines.push(`- coverage: ${report.coverage_ratio} (${report.scanned.length} scanned, ${report.uncovered.length} uncovered)`);
  lines.push(`- ok: ${report.ok}`);
  if (report.blockers.length) lines.push(`- blockers: ${report.blockers.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const write = !process.argv.includes('--no-write');
  const report = write ? writeReport() : scan();
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : markdown(report));
  process.exit(report.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { scan, writeReport, markdown };
