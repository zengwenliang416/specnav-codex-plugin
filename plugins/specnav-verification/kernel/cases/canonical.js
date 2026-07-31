'use strict';

const crypto = require('node:crypto');

function canonicalString(value) {
  return value.replace(/\r\n?/g, '\n').normalize('NFC');
}

function canonicalValue(value, path = '$', ancestors = new Set()) {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') return canonicalString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`verification-cases:non-finite-number:${path}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError(`verification-cases:cyclic-value:${path}`);
    }
    ancestors.add(value);
    const normalized = value.map((entry, index) => (
      canonicalValue(entry, `${path}[${index}]`, ancestors)
    ));
    ancestors.delete(value);
    return normalized;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`verification-cases:non-json-object:${path}`);
    }
    if (ancestors.has(value)) {
      throw new TypeError(`verification-cases:cyclic-value:${path}`);
    }
    ancestors.add(value);
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
        throw new TypeError(`verification-cases:non-json-value:${path}.${key}`);
      }
      normalized[key] = canonicalValue(child, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return normalized;
  }
  throw new TypeError(`verification-cases:non-json-value:${path}`);
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

function hashCanonical(value) {
  return crypto
    .createHash('sha256')
    .update(canonicalStringify(value))
    .digest('hex');
}

module.exports = {
  canonicalString,
  canonicalStringify,
  canonicalValue,
  hashCanonical
};
