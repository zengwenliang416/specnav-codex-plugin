#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function hasCodexManifest(root) {
  return fs.existsSync(path.join(root, '.codex-plugin', 'plugin.json'));
}

function pluginRootFrom(start) {
  let current = path.resolve(start);
  while (true) {
    if (hasCodexManifest(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`specnav-runtime-current-plugin-root-not-found:${path.resolve(start)}`);
    }
    current = parent;
  }
}

const currentPluginRoot = pluginRootFrom(__dirname);
const currentPluginJson = readJson(path.join(currentPluginRoot, '.codex-plugin', 'plugin.json')) || {};
const currentPluginName = currentPluginJson.name || path.basename(currentPluginRoot);

function envName(pluginName) {
  return `SPECNAV_${pluginName.replace(/-/g, '_').toUpperCase()}_ROOT`;
}

function isPluginRoot(root, pluginName) {
  if (!root || fs.existsSync(path.join(root, '.orphaned_at'))) return false;
  const pluginJson = readJson(path.join(root, '.codex-plugin', 'plugin.json'));
  return !!pluginJson && pluginJson.name === pluginName;
}

function findMarketplaceRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.agents', 'plugins', 'marketplace.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function entryPath(entry) {
  if (!entry) return null;
  if (typeof entry.source === 'string') return entry.source;
  if (entry.source && typeof entry.source.path === 'string') return entry.source.path;
  return null;
}

function fromMarketplaceJson(pluginName, marketplaceRoot) {
  if (!marketplaceRoot) return null;
  const marketplace = readJson(path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'));
  if (!marketplace || !Array.isArray(marketplace.plugins)) return null;
  const entry = marketplace.plugins.find((item) => item && item.name === pluginName);
  const sourcePath = entryPath(entry);
  if (!sourcePath) return null;
  const root = path.resolve(marketplaceRoot, sourcePath);
  return isPluginRoot(root, pluginName) ? root : null;
}

function fromSourceSibling(pluginName) {
  const parent = path.dirname(currentPluginRoot);
  if (path.basename(parent) !== 'plugins') return null;
  const root = path.join(parent, pluginName);
  return isPluginRoot(root, pluginName) ? root : null;
}

function versionSort(a, b) {
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(b, a);
}

function installedCacheRoot() {
  const versionDir = currentPluginRoot;
  const pluginDir = path.dirname(versionDir);
  if (path.basename(pluginDir) !== currentPluginName) return null;
  const marketplaceRoot = path.dirname(pluginDir);
  const cacheRoot = path.dirname(marketplaceRoot);
  if (path.basename(cacheRoot) !== 'cache') return null;
  return marketplaceRoot;
}

function fromInstalledCache(pluginName, marketplaceRoot) {
  if (!marketplaceRoot) return null;
  const currentVersion = path.basename(currentPluginRoot);
  const sameVersion = path.join(marketplaceRoot, pluginName, currentVersion);
  if (isPluginRoot(sameVersion, pluginName)) return sameVersion;

  const base = path.join(marketplaceRoot, pluginName);
  let versions = [];
  try {
    versions = fs.readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(versionSort);
  } catch {
    return null;
  }

  for (const version of versions) {
    const root = path.join(base, version);
    if (isPluginRoot(root, pluginName)) return root;
  }
  return null;
}

function fromEnv(pluginName) {
  const value = process.env[envName(pluginName)];
  if (!value) return null;
  const root = path.resolve(value);
  if (isPluginRoot(root, pluginName)) return root;
  throw new Error(`invalid-plugin-root:${pluginName}:${root}`);
}

function resolvePluginRoot(pluginName) {
  if (!/^[a-z0-9-]+$/.test(pluginName)) throw new Error(`invalid-plugin-name:${pluginName}`);
  if (pluginName === currentPluginName && isPluginRoot(currentPluginRoot, pluginName)) return currentPluginRoot;

  const explicit = fromEnv(pluginName);
  if (explicit) return explicit;

  const envMarketplace = process.env.SPECNAV_MARKETPLACE_ROOT
    ? path.resolve(process.env.SPECNAV_MARKETPLACE_ROOT)
    : null;
  const sourceMarketplace = findMarketplaceRoot(currentPluginRoot);
  const cacheMarketplace = installedCacheRoot();

  const candidates = [
    fromMarketplaceJson(pluginName, envMarketplace),
    fromInstalledCache(pluginName, envMarketplace),
    fromMarketplaceJson(pluginName, sourceMarketplace),
    fromSourceSibling(pluginName),
    fromInstalledCache(pluginName, cacheMarketplace)
  ];

  const root = candidates.find(Boolean);
  if (root) return root;
  throw new Error(`missing-plugin:${pluginName}`);
}

function assertSafeRelative(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('missing-plugin-script-path');
  }
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
    throw new Error(`invalid-plugin-script-path:${relativePath}`);
  }
}

function requirePluginScript(pluginName, relativePath) {
  assertSafeRelative(relativePath);
  const root = resolvePluginRoot(pluginName);
  return require(path.join(root, relativePath));
}

module.exports = {
  currentPluginName,
  currentPluginRoot,
  requirePluginScript,
  resolvePluginRoot
};
