'use strict';

const {
  textSuffixPattern,
  isAuthorizationKey
} = require('./redaction-constants');

const AUTHORIZATION_SUFFIX = textSuffixPattern('authorization');
const COOKIE_SUFFIX = textSuffixPattern('cookie');
const GENERIC_SUFFIX = textSuffixPattern('generic');
const ALL_SENSITIVE_SUFFIX = textSuffixPattern();
const PREFIXED_AUTHORIZATION = `[A-Za-z0-9_.-]*(?:${AUTHORIZATION_SUFFIX})`;
const PREFIXED_COOKIE = `[A-Za-z0-9_.-]*(?:${COOKIE_SUFFIX})`;
const PREFIXED_GENERIC = `[A-Za-z0-9_.-]*(?:${GENERIC_SUFFIX})`;
const PREFIXED_SENSITIVE = `[A-Za-z0-9_.-]*(?:${ALL_SENSITIVE_SUFFIX})`;

function regex(source, flags = 'gi') {
  return new RegExp(source, flags);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceMatches(text, expression, replacer, state) {
  return text.replace(expression, (...args) => {
    const replacement = replacer(...args);
    if (replacement === args[0]) return args[0];
    state.count += 1;
    return replacement;
  });
}

function createCredentialRules(marker) {
  const encodedMarker = encodeURIComponent(marker);
  const markerGuard = `(?!${escapeRegExp(marker)}|${escapeRegExp(encodedMarker)})`;

  function redactAuthorization(match, name, separator, value) {
    if (value.includes(marker)) return match;
    const parsed = value.trim().match(
      /^([A-Za-z][A-Za-z0-9._-]*)(\s+)(.+)$/
    );
    return parsed
      ? `${name}${separator}${parsed[1]}${parsed[2]}${marker}`
      : `${name}${separator}${marker}`;
  }

  return Object.freeze([
    {
      expression: regex(
        `\\b(${PREFIXED_AUTHORIZATION})(\\s*[:=]\\s*)([^\\r\\n]+)`
      ),
      replace: redactAuthorization
    },
    {
      expression: regex(
        `\\b(${PREFIXED_COOKIE})(\\s*[:=]\\s*)([^\\r\\n]+)`
      ),
      replace: (match, name, separator, value) => (
        value === marker ? match : `${name}${separator}${marker}`
      )
    },
    {
      expression: regex(
        `([?&]${PREFIXED_SENSITIVE}=)([^&#\\s]*)`
      ),
      replace: (match, prefix, value) => (
        value === encodedMarker
          ? match
          : `${prefix}${encodedMarker}`
      )
    },
    {
      expression: regex(
        `\\b([A-Za-z_][A-Za-z0-9_]*(?:${GENERIC_SUFFIX}))(\\s*[:=]\\s*)((?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s\\r\\n&#]+))`
      ),
      replace: (match, name, separator, value) => (
        value === marker || value === encodedMarker
          ? match
          : `${name}${separator}${marker}`
      )
    },
    {
      expression: regex(
        `(--${PREFIXED_SENSITIVE}(?:\\s+|=))((?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s\\r\\n]+))`
      ),
      replace: (match, prefix, value) => (
        value === marker ? match : `${prefix}${marker}`
      )
    },
    {
      expression: /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
      replace: (match, scheme, username, password) => (
        username === marker && password === marker
          ? match
          : `${scheme}${marker}:${marker}@`
      )
    },
    {
      expression: regex(
        `((?:"|')?${PREFIXED_SENSITIVE}(?:"|')?\\s*[:=]\\s*)(["'])${markerGuard}([^"'\\r\\n]*)\\2`
      ),
      replace: (match, prefix, quote, value) => (
        value === marker || value === encodedMarker
          ? match
          : `${prefix}${quote}${marker}${quote}`
      )
    },
    {
      expression: regex(
        `((?:"|')?${PREFIXED_GENERIC}(?:"|')?\\s*[:=]\\s*)${markerGuard}(?!["'])([^\\s,;}&\\]]+)`
      ),
      replace: (match, prefix, value) => (
        value === marker || value === encodedMarker
          ? match
          : `${prefix}${marker}`
      )
    }
  ]);
}

function createTextRedactor(secrets, marker) {
  const credentialRules = createCredentialRules(marker);

  function replaceConfiguredSecrets(input, state) {
    let output = input;
    for (const secret of secrets) {
      output = replaceMatches(
        output,
        new RegExp(escapeRegExp(secret), 'g'),
        (match) => match === marker ? match : marker,
        state
      );
    }
    return output;
  }

  function redactTextValue(input) {
    const state = { count: 0 };
    let value = replaceConfiguredSecrets(input, state);
    for (const rule of credentialRules) {
      value = replaceMatches(value, rule.expression, rule.replace, state);
    }
    return {
      value,
      count: state.count
    };
  }

  function redactSensitiveString(key, value) {
    if (value === marker) return { value, count: 0 };
    if (isAuthorizationKey(key)) {
      const rule = credentialRules[0];
      const redacted = rule.replace('', '', '', value);
      return {
        value: redacted,
        count: redacted === value ? 0 : 1
      };
    }
    const generic = redactTextValue(value);
    return generic.count > 0
      ? generic
      : { value: marker, count: 1 };
  }

  return Object.freeze({
    marker,
    redactTextValue,
    redactSensitiveString
  });
}

module.exports = {
  createTextRedactor
};
