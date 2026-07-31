'use strict';

const {
  REDACTION_BLOCKER,
  isSensitiveKey
} = require('./redaction-constants');

function pathSegment(parent, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function objectShape(value) {
  try {
    return {
      prototype: Object.getPrototypeOf(value),
      keys: Reflect.ownKeys(value),
      descriptors: Object.getOwnPropertyDescriptors(value)
    };
  } catch {
    throw new Error(REDACTION_BLOCKER);
  }
}

function outputContainer(array, descriptors) {
  if (!array) return {};
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(REDACTION_BLOCKER);
  }
  return new Array(length);
}

function redactStructuredValue(input, rootPath, textRedactor) {
  const seen = new WeakSet();
  const fields = new Set();
  let count = 0;
  let visited = 0;
  const {
    marker,
    redactTextValue,
    redactSensitiveString
  } = textRedactor;

  function record(path, redacted) {
    if (redacted.count > 0) {
      fields.add(path);
      count += redacted.count;
    }
    return redacted.value;
  }

  function visit(value, currentPath, key = null, depth = 0) {
    visited += 1;
    if (visited > 100000 || depth > 64) {
      throw new Error(REDACTION_BLOCKER);
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(REDACTION_BLOCKER);
      if (key === null || !isSensitiveKey(key)) return value;
      fields.add(currentPath);
      count += 1;
      return marker;
    }
    if (typeof value === 'string') {
      return record(
        currentPath,
        key !== null && isSensitiveKey(key)
          ? redactSensitiveString(key, value)
          : redactTextValue(value)
      );
    }
    if (!value || typeof value !== 'object') {
      throw new Error(REDACTION_BLOCKER);
    }
    if (key !== null && isSensitiveKey(key)) {
      fields.add(currentPath);
      count += 1;
      return marker;
    }
    if (seen.has(value)) throw new Error(REDACTION_BLOCKER);
    seen.add(value);

    const shape = objectShape(value);
    const array = Array.isArray(value);
    if (
      (!array
        && shape.prototype !== Object.prototype
        && shape.prototype !== null)
      || shape.keys.some((candidate) => typeof candidate === 'symbol')
    ) {
      throw new Error(REDACTION_BLOCKER);
    }

    const output = outputContainer(array, shape.descriptors);
    const names = shape.keys
      .filter((candidate) => candidate !== 'length')
      .sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const descriptor = shape.descriptors[name];
      if (
        !descriptor
        || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || (array && !/^(?:0|[1-9][0-9]*)$/.test(name))
      ) {
        throw new Error(REDACTION_BLOCKER);
      }
      if (
        name.length > 512
        || /[\u0000-\u001f\u007f]/.test(name)
        || redactTextValue(name).count > 0
      ) {
        throw new Error(REDACTION_BLOCKER);
      }
      const nextPath = array
        ? `${currentPath}[${name}]`
        : pathSegment(currentPath, name);
      Object.defineProperty(output, name, {
        value: visit(
          descriptor.value,
          nextPath,
          array ? null : name,
          depth + 1
        ),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    seen.delete(value);
    return output;
  }

  return {
    value: visit(input, rootPath),
    fields,
    count
  };
}

module.exports = {
  redactStructuredValue
};
