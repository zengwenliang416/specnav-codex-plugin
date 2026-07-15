#!/usr/bin/env node
'use strict';

// SessionStart: announce sibling repositories that carry a CodeGraph index so
// the model reaches for `codegraph explore -p <repo>` instead of grepping
// foreign codebases. Silent when nothing is found. Budget: one compact line.

const fs = require('fs');
const path = require('path');

const MAX_SIBLINGS = 30;

function projectRoot() {
  return path.resolve(process.env.PROJECT_DIR || process.env.PWD || process.cwd());
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function hasIndex(dir) {
  try {
    return fs.statSync(path.join(dir, '.codegraph')).isDirectory();
  } catch {
    return false;
  }
}

function main() {
  if (process.env.SPECNAV_CROSS_REPO_REDIRECT === '0') return;
  const root = projectRoot();
  const parent = path.dirname(root);
  const repos = new Set();

  let siblings = [];
  try {
    siblings = fs.readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .slice(0, MAX_SIBLINGS);
  } catch {}
  for (const entry of siblings) {
    const dir = path.join(parent, entry.name);
    if (dir !== root && hasIndex(dir)) repos.add(dir);
  }

  // Non-sibling repos can be declared explicitly.
  const declared = readJson(path.join(root, 'openspec', '.specnav', 'cross-repo.json'));
  if (declared && Array.isArray(declared.repos)) {
    for (const item of declared.repos) {
      if (typeof item !== 'string' || !item.trim()) continue;
      const dir = path.resolve(root, item.trim());
      if (dir !== root && hasIndex(dir)) repos.add(dir);
    }
  }

  if (!repos.size) return;
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: JSON.stringify({
        schema: 'specnav.crossRepo.v1',
        indexed_repos: Array.from(repos).sort(),
        usage: 'To explore or locate code in these external repos, run `codegraph explore -p <repo> "<question>"` (or codegraph_explore MCP with projectPath). Do NOT grep/find across them. Read stays fine for one specific file.'
      })
    }
  })}\n`);
}

try {
  main();
} catch {}
process.exit(0);
