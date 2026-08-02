'use strict';

const crypto = require('node:crypto');

const path = require('node:path');

const REPORT_SCRIPTS = require('./report-script-assets');
const SECURITY_CONTRACT = require(path.resolve(
  __dirname,
  '../../assets/report/report-security-contract.json'
));

const ACTIVE_CONTENT = Object.freeze([
  /<\s*(?:script|style|meta|base|object|embed|iframe|frame|applet)\b/i,
  /<[^>]+\son[a-z]+\s*=\s*["']/i,
  /<[^>]+\son[a-z]+\s*=\s*(?!&(?:quot|#39);)[^\s>]+/i,
  /<[^>]+\b(?:href|src)\s*=\s*["']?\s*javascript\s*:/i,
  /<\s*link\b[^>]*\brel\s*=\s*["']?\s*(?:stylesheet|preload|modulepreload)/i
]);

function scriptHash(source) {
  return crypto.createHash('sha256').update(source).digest('base64');
}

function verifyPinnedScript(id, source) {
  return (
    typeof id === 'string'
    && typeof source === 'string'
    && SECURITY_CONTRACT.scripts[id] === scriptHash(source)
  );
}

function resolveReportScripts(scriptIds = [], scriptRegistry = REPORT_SCRIPTS) {
  if (
    !Array.isArray(scriptIds)
    || scriptIds.some((id) => (
      typeof id !== 'string'
      || !Object.hasOwn(scriptRegistry, id)
    ))
  ) {
    return Object.freeze({
      ok: false,
      scripts: Object.freeze([]),
      blockers: Object.freeze([Object.freeze({
        id: 'verification-report-renderer:script-not-approved',
        artifact: 'html',
        detail: null
      })])
    });
  }
  const scripts = [];
  for (const id of [...new Set(scriptIds)]) {
    const source = scriptRegistry[id];
    const actual = scriptHash(source);
    if (!verifyPinnedScript(id, source)) {
      return Object.freeze({
        ok: false,
        scripts: Object.freeze([]),
        blockers: Object.freeze([Object.freeze({
          id: 'verification-report-renderer:script-pin-mismatch',
          artifact: id,
          detail: null
        })])
      });
    }
    scripts.push(Object.freeze({ id, source, sha256: actual }));
  }
  return Object.freeze({
    ok: true,
    scripts: Object.freeze(scripts),
    blockers: Object.freeze([])
  });
}

function validateReportBody(body) {
  if (
    typeof body !== 'string'
    || body.trim().length === 0
    || ACTIVE_CONTENT.some((pattern) => pattern.test(body))
  ) {
    return Object.freeze({
      ok: false,
      blocker: Object.freeze({
        id: 'verification-report-renderer:body-active-content',
        artifact: 'html',
        detail: null
      })
    });
  }
  return Object.freeze({ ok: true, blocker: null });
}

function validateReportStylesheet(stylesheet) {
  const actual = typeof stylesheet === 'string'
    ? crypto.createHash('sha256').update(stylesheet).digest('hex')
    : null;
  if (actual !== SECURITY_CONTRACT.stylesheet_sha256) {
    return Object.freeze({
      ok: false,
      blocker: Object.freeze({
        id: 'verification-report-renderer:stylesheet-pin-mismatch',
        artifact: 'report.css',
        detail: null
      })
    });
  }
  return Object.freeze({ ok: true, blocker: null });
}

function contentSecurityPolicy(resolvedScripts) {
  const scriptPolicy = resolvedScripts.length === 0
    ? "'none'"
    : resolvedScripts.map((script) => (
        `'sha256-${script.sha256}'`
      )).join(' ');
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "font-src 'none'",
    "form-action 'none'",
    "img-src 'none'",
    "object-src 'none'",
    `script-src ${scriptPolicy}`,
    "style-src 'unsafe-inline'"
  ].join('; ');
}

function renderInlineScripts(resolvedScripts) {
  return resolvedScripts.map((script) => (
    `<script data-specnav-report-script="${script.id}">${script.source}</script>`
  )).join('\n');
}

module.exports = {
  contentSecurityPolicy,
  renderInlineScripts,
  resolveReportScripts,
  scriptHash,
  validateReportBody,
  validateReportStylesheet,
  verifyPinnedScript
};
