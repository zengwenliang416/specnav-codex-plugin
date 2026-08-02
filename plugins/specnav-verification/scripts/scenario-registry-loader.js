#!/usr/bin/env node
'use strict';

function encode(value, seen = new Set()) {
  if (typeof value === 'function') {
    return {
      __specnav_function_source: Function.prototype.toString.call(value)
    };
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) {
    throw new Error('verification-production:scenario-registry-cycle');
  }
  seen.add(value);
  const encoded = Array.isArray(value)
    ? value.map((entry) => encode(entry, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          encode(entry, seen)
        ])
      );
  seen.delete(value);
  return encoded;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    throw new Error('verification-production:scenario-registry-required');
  }
  const loaded = require(file);
  const scenarios = loaded?.scenarios || loaded;
  if (!scenarios || typeof scenarios !== 'object' || Array.isArray(scenarios)) {
    throw new Error('verification-production:scenario-registry-invalid');
  }
  process.stdout.write(`${JSON.stringify(encode(scenarios))}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    error instanceof Error ? error.message : String(error)
  );
  process.exit(2);
}
