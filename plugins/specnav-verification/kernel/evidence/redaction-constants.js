'use strict';

const DEFAULT_REDACTION_MARKER = '[REDACTED]';
const REDACTION_BLOCKER = 'verification-redaction:value-invalid';
const SENSITIVE_KEY_FAMILIES = Object.freeze([
  Object.freeze({
    normalized: 'authorization',
    pattern: 'authorization',
    category: 'authorization'
  }),
  Object.freeze({
    normalized: 'cookie',
    pattern: 'cookie',
    category: 'cookie'
  }),
  Object.freeze({
    normalized: 'apikey',
    pattern: 'api[-_]?key',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'token',
    pattern: 'token',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'secretaccesskey',
    pattern: 'secret[-_]?access[-_]?key',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'secret',
    pattern: 'secret',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'password',
    pattern: 'password',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'passwd',
    pattern: 'passwd',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'credential',
    pattern: 'credential',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'credentials',
    pattern: 'credentials',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'privatekey',
    pattern: 'private[-_]?key',
    category: 'generic'
  }),
  Object.freeze({
    normalized: 'signingkey',
    pattern: 'signing[-_]?key',
    category: 'generic'
  })
]);
const REDACTION_MARKER_CANDIDATES = Object.freeze([
  DEFAULT_REDACTION_MARKER,
  '[MASKED]',
  '[FILTERED]',
  '[REMOVED]',
  '<MASKED>',
  '__MASKED__',
  '***',
  '###',
  '@@@',
  '%%%',
  '!!!',
  '~~~'
]);

function normalizeKeyName(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function familiesFor(category = null) {
  return category === null
    ? SENSITIVE_KEY_FAMILIES
    : SENSITIVE_KEY_FAMILIES.filter((family) => family.category === category);
}

function textSuffixPattern(category = null) {
  return familiesFor(category).map((family) => family.pattern).join('|');
}

function keyHasCategory(value, category) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const normalized = normalizeKeyName(value);
  return familiesFor(category).some(
    (family) => normalized.endsWith(family.normalized)
  );
}

function isSensitiveKey(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const normalized = normalizeKeyName(value);
  return SENSITIVE_KEY_FAMILIES.some(
    (family) => normalized.endsWith(family.normalized)
  );
}

function isAuthorizationKey(value) {
  return keyHasCategory(value, 'authorization');
}

function selectRedactionMarker(secrets) {
  return REDACTION_MARKER_CANDIDATES.find((candidate) => (
    secrets.every((secret) => (
      !candidate.includes(secret) && !secret.includes(candidate)
    ))
  )) || null;
}

module.exports = {
  DEFAULT_REDACTION_MARKER,
  REDACTION_BLOCKER,
  SENSITIVE_KEY_FAMILIES,
  textSuffixPattern,
  isSensitiveKey,
  isAuthorizationKey,
  selectRedactionMarker
};
