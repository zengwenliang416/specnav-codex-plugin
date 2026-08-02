'use strict';

const {
  isSecretRedactor
} = require('../evidence/secret-redactor');

function escapeHtml(value) {
  if (typeof value !== 'string') {
    throw new Error('verification-reporting:html-value-invalid');
  }
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function blocked() {
  return Object.freeze({
    ok: false,
    blockers: Object.freeze([
      Object.freeze({
        id: 'verification-reporting:redaction-boundary-invalid',
        artifact: 'html',
        detail: null
      })
    ])
  });
}

function renderSafeHtmlText(redactor, value, options) {
  if (!isSecretRedactor(redactor)) return blocked();
  let redacted;
  try {
    redacted = redactor.redactText(value, options);
  } catch {
    return blocked();
  }
  if (
    !redacted
    || redacted.ok !== true
    || typeof redacted.value !== 'string'
    || !redacted.redaction
    || !['not_required', 'redacted'].includes(redacted.redaction.status)
    || !Array.isArray(redacted.redaction.redacted_fields)
    || !Number.isInteger(redacted.redaction_count)
    || redacted.redaction_count < 0
    || !Array.isArray(redacted.blockers)
    || redacted.blockers.length !== 0
  ) {
    return redacted?.ok === false ? redacted : blocked();
  }

  return Object.freeze({
    ...redacted,
    html: escapeHtml(redacted.value)
  });
}

function renderSafeHtmlAttribute(redactor, value, options) {
  const rendered = renderSafeHtmlText(redactor, value, options);
  if (rendered.ok !== true) return rendered;
  if (/[\u0000-\u001f\u007f]/.test(rendered.value)) return blocked();
  return rendered;
}

module.exports = {
  escapeHtml,
  renderSafeHtmlAttribute,
  renderSafeHtmlText
};
