#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const lib = require('./specnav-lib');

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : fallback;
}

function slug(value) {
  return String(value || 'override')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'override';
}

function createOverride(root, args) {
  const gate = argValue(args, '--gate');
  const reason = argValue(args, '--reason');
  if (!gate || !reason) {
    console.error('Usage: node "${PLUGIN_ROOT}/scripts/override.js" create --gate <gate> --reason <reason> [--path <path>] [--command <command>] [--ttl-minutes 30] [--requested-by <name>]');
    process.exit(2);
  }
  const ttlMinutes = Number(argValue(args, '--ttl-minutes', '30'));
  const activeChange = argValue(args, '--change', lib.activeChange(root));
  const entry = {
    schema_version: 1,
    gate,
    reason,
    requested_by: argValue(args, '--requested-by', process.env.USER || 'local-user'),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    active_change: activeChange,
    affected_path: argValue(args, '--path'),
    command: argValue(args, '--command')
  };
  Object.keys(entry).forEach((key) => entry[key] == null && delete entry[key]);
  lib.ensureDir(lib.overridesDir(root));
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug(gate)}.json`;
  const file = path.join(lib.overridesDir(root), filename);
  lib.writeJson(file, entry);
  lib.event(root, 'override.create', { gate, file, active_change: activeChange });
  console.log(file);
}

function list(root) {
  const rows = lib.listOverrides(root).map((entry) => ({
    file: path.relative(root, entry.file),
    gate: entry.data.gate,
    active_change: entry.data.active_change || '',
    affected_path: entry.data.affected_path || '',
    command: entry.data.command || '',
    expires_at: entry.data.expires_at || '',
    expired: entry.data.expires_at ? Date.parse(entry.data.expires_at) <= Date.now() : false,
    reason: entry.data.reason || ''
  }));
  console.log(JSON.stringify(rows, null, 2));
}

function prune(root) {
  let removed = 0;
  for (const entry of lib.listOverrides(root)) {
    if (entry.data.expires_at && Date.parse(entry.data.expires_at) <= Date.now()) {
      fs.unlinkSync(entry.file);
      removed += 1;
    }
  }
  lib.event(root, 'override.prune', { removed });
  console.log(`removed=${removed}`);
}

function main() {
  const root = lib.projectRoot();
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === 'create') return createOverride(root, args.slice(1));
  if (command === 'list') return list(root);
  if (command === 'prune') return prune(root);
  console.error('Usage: node "${PLUGIN_ROOT}/scripts/override.js" <create|list|prune>');
  process.exit(2);
}

if (require.main === module) main();

module.exports = { createOverride };
