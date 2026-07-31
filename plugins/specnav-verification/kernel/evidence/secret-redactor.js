'use strict';

const {
  DEFAULT_REDACTION_MARKER,
  REDACTION_BLOCKER,
  selectRedactionMarker
} = require('./redaction-constants');
const {
  createTextRedactor
} = require('./text-redactor');
const {
  redactStructuredValue
} = require('./structured-redactor');

const REDACTOR_INSTANCES = new WeakSet();
const CONFIG_BLOCKER = 'verification-redaction:config-invalid';

function blocker(artifact = 'redaction') {
  return Object.freeze({
    ok: false,
    blockers: Object.freeze([
      Object.freeze({
        id: REDACTION_BLOCKER,
        artifact,
        detail: null
      })
    ])
  });
}

function safeField(options, fallback, textRedactor) {
  try {
    let value;
    if (
      options === undefined
      || (
        options
        && typeof options === 'object'
        && !Array.isArray(options)
        && Object.getOwnPropertyDescriptor(options, 'field') === undefined
      )
    ) {
      value = fallback;
    } else {
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        return null;
      }
      const descriptor = Object.getOwnPropertyDescriptor(options, 'field');
      if (
        !descriptor
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || typeof descriptor.value !== 'string'
      ) {
        return null;
      }
      value = descriptor.value;
    }
    if (
      value.length === 0
      || value.length > 512
      || /[\u0000-\u001f\u007f]/.test(value)
      || textRedactor.redactTextValue(value).count > 0
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function successful(value, fields, count) {
  return Object.freeze({
    ok: true,
    value,
    redaction: Object.freeze({
      status: count > 0 ? 'redacted' : 'not_required',
      redacted_fields: Object.freeze([...fields].sort())
    }),
    redaction_count: count,
    blockers: Object.freeze([])
  });
}

function invalidConfig() {
  throw new Error(CONFIG_BLOCKER);
}

function normalizeSecrets(options) {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return invalidConfig();
    }
    const keys = Reflect.ownKeys(options);
    if (
      keys.some((key) => typeof key === 'symbol')
      || keys.some((key) => key !== 'secrets')
    ) {
      return invalidConfig();
    }
    const descriptor = Object.getOwnPropertyDescriptor(options, 'secrets');
    if (
      !descriptor
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || !Array.isArray(descriptor.value)
    ) {
      return invalidConfig();
    }
    const values = descriptor.value;
    if (values.length > 256) return invalidConfig();
    const normalized = [];
    let totalLength = 0;
    for (let index = 0; index < values.length; index += 1) {
      const item = Object.getOwnPropertyDescriptor(values, String(index));
      if (
        !item
        || !Object.prototype.hasOwnProperty.call(item, 'value')
        || typeof item.value !== 'string'
        || item.value.length === 0
        || item.value.length > 4096
        || item.value.trim().length === 0
      ) {
        return invalidConfig();
      }
      totalLength += item.value.length;
      if (totalLength > 65536) return invalidConfig();
      normalized.push(item.value);
    }
    return Object.freeze(
      [...new Set(normalized)].sort((left, right) => (
        right.length - left.length || left.localeCompare(right)
      ))
    );
  } catch (error) {
    if (error?.message === CONFIG_BLOCKER) throw error;
    return invalidConfig();
  }
}

function createSecretRedactor(options) {
  const secrets = normalizeSecrets(options);
  const marker = selectRedactionMarker(secrets);
  if (marker === null) return invalidConfig();
  const textRedactor = createTextRedactor(secrets, marker);

  function redactText(value, redactOptions) {
    const field = safeField(redactOptions, 'content', textRedactor);
    if (field === null || typeof value !== 'string') {
      return blocker(field);
    }
    const redacted = textRedactor.redactTextValue(value);
    return successful(
      redacted.value,
      redacted.count > 0 ? new Set([field]) : new Set(),
      redacted.count
    );
  }

  function redactValue(value, redactOptions) {
    const field = safeField(redactOptions, 'value', textRedactor);
    if (field === null) return blocker(null);
    try {
      const redacted = redactStructuredValue(value, field, textRedactor);
      return successful(redacted.value, redacted.fields, redacted.count);
    } catch {
      return blocker(field);
    }
  }

  const redactor = Object.freeze({
    marker,
    redactText,
    redactValue
  });
  REDACTOR_INSTANCES.add(redactor);
  return redactor;
}

function isSecretRedactor(value) {
  try {
    return REDACTOR_INSTANCES.has(value)
      && typeof value.marker === 'string'
      && typeof value.redactText === 'function'
      && typeof value.redactValue === 'function';
  } catch {
    return false;
  }
}

module.exports = {
  REDACTION_MARKER: DEFAULT_REDACTION_MARKER,
  createSecretRedactor,
  isSecretRedactor
};
