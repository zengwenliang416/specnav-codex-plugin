'use strict';

function invalidOrigins() {
  return new Error('approved browser origins are invalid');
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.trim() !== value || value === '') {
    throw invalidOrigins();
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidOrigins();
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.origin !== value
  ) {
    throw invalidOrigins();
  }
  return parsed.origin;
}

function accessTarget(value) {
  try {
    const parsed = new URL(value);
    if (['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      return parsed.origin;
    }
    return parsed.protocol;
  } catch {
    return 'invalid-url';
  }
}

function createBrowserAccessPolicy(origins) {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw invalidOrigins();
  }
  const normalized = origins.map(normalizeOrigin);
  if (new Set(normalized).size !== normalized.length) {
    throw invalidOrigins();
  }
  const allowed = new Set(normalized);

  return Object.freeze({
    origins: Object.freeze([...normalized]),
    allows(value) {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        return false;
      }
      if (parsed.protocol === 'about:') return value === 'about:blank';
      if (parsed.protocol === 'data:') return true;
      if (parsed.protocol === 'blob:') return allowed.has(parsed.origin);
      if (['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
        const protocol = parsed.protocol === 'ws:'
          ? 'http:'
          : parsed.protocol === 'wss:'
            ? 'https:'
            : parsed.protocol;
        return allowed.has(`${protocol}//${parsed.host}`);
      }
      return false;
    },
    target(value) {
      return accessTarget(value);
    }
  });
}

module.exports = {
  createBrowserAccessPolicy
};
