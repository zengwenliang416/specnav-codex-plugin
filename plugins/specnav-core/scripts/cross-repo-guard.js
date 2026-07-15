#!/usr/bin/env node
'use strict';

// Cross-repo search redirect (PreToolUse: Grep|Bash).
//
// When a search targets a DIFFERENT repository that has its own .codegraph/
// index, deny with the equivalent `codegraph explore -p <repo>` command —
// one structured call replaces a grep sweep of a foreign codebase. Reads of
// specific files are never intercepted, targets without an index pass
// through, and any uncertainty resolves to allow (this is an efficiency
// gate, not a safety gate). SPECNAV_CROSS_REPO_REDIRECT=0 disables it.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SEARCH_COMMANDS = new Set(['grep', 'rg', 'ag', 'ack', 'fgrep', 'egrep']);
const FIND_COMMANDS = new Set(['find', 'fd']);

function readStdinJson() {
  try {
    const input = fs.readFileSync(0, 'utf8').trim();
    return input ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}

function projectRoot() {
  return path.resolve(process.env.PROJECT_DIR || process.env.PWD || process.cwd());
}

function isContainedIn(rootDir, candidate) {
  const rel = path.relative(rootDir, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Walk up from the target looking for a .codegraph/ index root.
function findIndexedRepoRoot(startPath) {
  let current = startPath;
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }
  const home = os.homedir();
  while (true) {
    if (current === home || current === path.dirname(current)) return null;
    if (fs.existsSync(path.join(current, '.codegraph'))) return current;
    current = path.dirname(current);
  }
}

// Extract external path arguments from a shell command containing a search
// tool. High precision by design: only absolute or ../-prefixed tokens are
// considered, so in-repo searches never match.
function externalPathArgsFromCommand(command, root) {
  const tokens = String(command).split(/\s+/);
  const hasSearchVerb = tokens.some((token) => {
    const bare = token.replace(/^["']|["']$/g, '').split('/').pop();
    return SEARCH_COMMANDS.has(bare) || FIND_COMMANDS.has(bare);
  });
  if (!hasSearchVerb) return [];
  const externals = [];
  for (const raw of tokens) {
    const token = raw.replace(/^["']|["']$/g, '');
    if (!token.startsWith('/') && !token.startsWith('../') && !token.startsWith('~/')) continue;
    const expanded = token.startsWith('~/') ? path.join(os.homedir(), token.slice(2)) : token;
    const absolute = path.resolve(root, expanded);
    if (!isContainedIn(root, absolute)) externals.push(absolute);
  }
  return externals;
}

function deny(message) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: message
    }
  })}\n`);
  console.error(message);
  process.exit(2);
}

function main() {
  if (process.env.SPECNAV_CROSS_REPO_REDIRECT === '0') process.exit(0);
  const root = projectRoot();
  const payload = readStdinJson();
  const tool = payload.tool_name || payload.toolName || '';
  const input = payload.tool_input || payload.input || {};

  let externalTargets = [];
  if (/^Grep$/i.test(tool)) {
    if (typeof input.path === 'string' && input.path.trim()) {
      const absolute = path.resolve(root, input.path.trim());
      if (!isContainedIn(root, absolute)) externalTargets.push(absolute);
    }
  } else if (/^Bash$/i.test(tool)) {
    if (typeof input.command === 'string') {
      externalTargets = externalPathArgsFromCommand(input.command, root);
    }
  }
  if (!externalTargets.length) process.exit(0);

  for (const target of externalTargets) {
    const repoRoot = findIndexedRepoRoot(target);
    if (!repoRoot || isContainedIn(root, repoRoot)) continue;
    deny(`[cross-repo-search] ${target} is inside ${repoRoot}, which has a CodeGraph index. `
      + `Use \`codegraph explore -p "${repoRoot}" "<your question or symbol names>"\` `
      + `(or the codegraph_explore MCP tool with projectPath) instead of grep/find — one call returns `
      + `the relevant symbols' source plus call paths. Reading one specific file with the Read tool is fine. `
      + `Set SPECNAV_CROSS_REPO_REDIRECT=0 to disable this redirect.`);
  }
  process.exit(0);
}

try {
  main();
} catch {
  // Fail open: an efficiency gate must never block real work on an internal error.
  process.exit(0);
}
