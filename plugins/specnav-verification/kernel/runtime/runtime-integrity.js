'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function treeRecords(root) {
  const canonicalRoot = fs.realpathSync(root);
  const records = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(canonicalRoot, file)
        .split(path.sep)
        .join('/');
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        const resolved = path.resolve(path.dirname(file), target);
        if (!contained(canonicalRoot, resolved)) {
          throw new Error(
            `verification-runtime:integrity-symlink-escape:${relative}`
          );
        }
        records.push(`link\0${relative}\0${target}`);
      } else if (stat.isDirectory()) {
        records.push(`dir\0${relative}`);
        visit(file);
      } else if (stat.isFile()) {
        records.push(`file\0${relative}\0${sha256(fs.readFileSync(file))}`);
      } else {
        throw new Error(
          `verification-runtime:integrity-entry-invalid:${relative}`
        );
      }
    }
  };
  visit(canonicalRoot);
  return records;
}

function moduleTreeDigest(runtimeRoot) {
  return sha256(treeRecords(path.join(runtimeRoot, 'node_modules')).join('\n'));
}

module.exports = {
  moduleTreeDigest,
  sha256,
  treeRecords
};
