#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');

const REQUIRED_FOUNDATION_SPECS = [
  {
    id: 'ui-design',
    path: 'openspec/specs/ui-design/design.md',
    requiredSections: [
      '# ',
      '## Overview',
      '## Colors',
      '## Typography',
      '## Layout',
      '## Elevation & Depth',
      '## Motion',
      '## Shapes',
      '## Components',
      '## Voice & Content',
      '## Theme & Internationalization',
      "## Do's and Don'ts"
    ],
    requiredFrontmatterKeys: ['version', 'name', 'description', 'colors', 'typography', 'spacing', 'rounded', 'components'],
    requiredFieldLabels: [
      { label: 'theme-capability', patterns: ['theme capability', 'theme support', 'theme mode', '主题能力', '主题模式', '明暗模式'] },
      { label: 'theme-toggle', patterns: ['theme toggle', 'theme switch', '主题切换', '明暗切换', 'toggle policy'] },
      { label: 'internationalization', patterns: ['internationalization', 'i18n', 'locale', 'language', '国际化', '多语言'] },
      { label: 'supported-locales', patterns: ['supported locale', 'supported language', 'locales', 'languages', '支持语言', '语言列表', '语种'] },
      { label: 'default-locale', patterns: ['default locale', 'default language', '默认语言', '默认 locale'] }
    ],
    requireFieldLabelsAlways: true
  },
  {
    id: 'system-architecture',
    path: 'openspec/specs/system-architecture/design.md',
    requiredSections: [
      '# System Architecture & Database Spec',
      '## Overview',
      '## Application Topology',
      '## Module Boundaries',
      '## Frontend Architecture',
      '## Backend Architecture',
      '## API Surface',
      '## Database Model',
      '## Permissions & Security',
      '## Integration Boundaries',
      '## Operational Constraints',
      "## Architecture Do's and Don'ts"
    ],
    requiredFrontmatterKeys: [],
    requiredFieldLabels: [
      { label: 'responsibility', patterns: ['responsibilit'] },
      { label: 'public-contract', patterns: ['public contract'] },
      { label: 'owned-data', patterns: ['owned data'] },
      { label: 'dependencies', patterns: ['dependenc'] },
      { label: 'forbidden-dependencies', patterns: ['forbidden'] },
      { label: 'extension-points', patterns: ['extension'] },
      { label: 'entity-purpose', patterns: ['purpose'] },
      { label: 'entity-owner', patterns: ['owner'] },
      { label: 'entity-fields', patterns: ['field'] },
      { label: 'entity-relationships', patterns: ['relationship'] },
      { label: 'entity-indexes', patterns: ['index'] },
      { label: 'entity-constraints', patterns: ['constraint'] },
      { label: 'entity-lifecycle', patterns: ['lifecycle'] },
      { label: 'entity-migration', patterns: ['migration'] },
      { label: 'entity-retention', patterns: ['retention', 'deletion'] }
    ]
  },
  {
    id: 'frontend-backend-data-flow',
    path: 'openspec/specs/frontend-backend-data-flow/design.md',
    requiredSections: [
      '# Frontend-Backend Data Flow Spec',
      '## Overview',
      '## Flow Index',
      '## Boundary Contracts',
      '## State Ownership',
      '## Validation Ownership',
      '## Error & Empty States',
      '## Loading / Optimistic / Retry Behavior',
      '## End-to-End Flow Details',
      '## Async / Realtime Flows',
      "## Flow Do's and Don'ts"
    ],
    requiredFrontmatterKeys: [],
    requireFlowId: true,
    requiredFieldLabels: [
      { label: 'user-trigger', patterns: ['trigger'] },
      { label: 'request', patterns: ['request'] },
      { label: 'response', patterns: ['response'] },
      { label: 'validation', patterns: ['validation', 'validate'] },
      { label: 'error', patterns: ['error'] },
      { label: 'retry-idempotency', patterns: ['retry', 'idempoten'] },
      { label: 'rollback', patterns: ['rollback'] }
    ]
  },
  {
    id: 'component-architecture',
    path: 'openspec/specs/component-architecture/design.md',
    requiredSections: [
      '# Component Architecture & Reuse Spec',
      '## Overview',
      '## Component Taxonomy',
      '## Cohesion Rules',
      '## Coupling Rules',
      '## Shared Component Extraction Rules',
      '## Component Public API Rules',
      '## State Ownership Rules',
      '## Composition Patterns',
      '## File & Naming Conventions',
      '## Testing Expectations',
      '## Refactor Triggers',
      "## Component Do's and Don'ts"
    ],
    requiredFrontmatterKeys: []
  }
];

const UI_REQUIRED_TOKEN_ROOTS = ['colors', 'typography', 'spacing', 'rounded', 'components'];

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripFencedCodeBlocks(text) {
  const lines = normalizeNewlines(text).split('\n');
  const kept = [];
  let fence = null;

  for (const line of lines) {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (match) {
      const marker = match[1][0];
      const length = match[1].length;
      if (!fence) {
        fence = { marker, length };
        continue;
      }
      if (marker === fence.marker && match[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (!fence) kept.push(line);
  }

  return kept.join('\n');
}

function markdownHasSection(text, heading) {
  const normalized = stripFencedCodeBlocks(text);
  if (heading === '# ') return /^#\s+\S+/m.test(normalized);
  return new RegExp(`^${escapeRegExp(heading)}\\s*$`, 'm').test(normalized);
}

const FLOW_ID_PATTERN = /\bFLOW-[A-Z0-9][A-Z0-9-]*\b/;

function specBodyText(text) {
  return stripFencedCodeBlocks(text).toLowerCase();
}

function specDeclaresContent(text) {
  const body = stripFencedCodeBlocks(text);
  return /^\s{0,3}#{3,6}\s+\S/m.test(body) || /^\s*\|.*\|\s*$/m.test(body);
}

function missingFieldLabels(text, requiredFieldLabels) {
  const body = specBodyText(text);
  return requiredFieldLabels
    .filter((field) => !field.patterns.some((pattern) => body.includes(pattern)))
    .map((field) => field.label);
}

function isYamlQuoteStart(value, index) {
  if (index === 0) return true;
  return /[\s:[{,]/.test(value[index - 1]);
}

function isYamlEscapedSingleQuote(value, index, single, double) {
  return single && !double && value[index] === "'" && value[index + 1] === "'";
}

function yamlHexColorLiteralLength(line, index) {
  const match = line.slice(index).match(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})(?=$|[\s,\]}])/);
  if (!match) return 0;

  const before = line.slice(0, index).trimEnd();
  const previousValueToken = before.slice(-1);
  if (before.trim() === '-' || [':', '[', ',', '{'].includes(previousValueToken)) return match[0].length;

  return 0;
}

function stripYamlComment(line) {
  let single = false;
  let double = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (double && character === '\\') {
      escaped = true;
      continue;
    }
    if (isYamlEscapedSingleQuote(line, index, single, double)) {
      index += 1;
      continue;
    }
    if (character === "'" && !double && (single || isYamlQuoteStart(line, index))) single = !single;
    if (character === '"' && !single && (double || isYamlQuoteStart(line, index))) double = !double;
    if (character === '#' && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) {
      const hexLiteralLength = yamlHexColorLiteralLength(line, index);
      if (hexLiteralLength) {
        index += hexLiteralLength - 1;
        continue;
      }
      return line.slice(0, index).trimEnd();
    }
  }

  return line.trimEnd();
}

function preprocessYamlLines(yaml) {
  const lines = [];
  for (const rawLine of yaml.split('\n')) {
    if (/^\s*\t/.test(rawLine)) return { ok: false, lines: [], error: 'tab-indentation' };
    const line = stripYamlComment(rawLine);
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    lines.push({ indent, text: line.slice(indent).trimEnd() });
  }
  return { ok: true, lines, error: null };
}

function splitTopLevel(value, delimiter) {
  const parts = [];
  let start = 0;
  let single = false;
  let double = false;
  let escaped = false;
  let squareDepth = 0;
  let curlyDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (double && character === '\\') {
      escaped = true;
      continue;
    }
    if (isYamlEscapedSingleQuote(value, index, single, double)) {
      index += 1;
      continue;
    }
    if (character === "'" && !double && (single || isYamlQuoteStart(value, index))) {
      single = !single;
      continue;
    }
    if (character === '"' && !single && (double || isYamlQuoteStart(value, index))) {
      double = !double;
      continue;
    }
    if (single || double) continue;
    if (character === '[') squareDepth += 1;
    if (character === ']') squareDepth -= 1;
    if (character === '{') curlyDepth += 1;
    if (character === '}') curlyDepth -= 1;
    if (squareDepth < 0 || curlyDepth < 0) return null;
    if (character === delimiter && squareDepth === 0 && curlyDepth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (single || double || squareDepth !== 0 || curlyDepth !== 0) return null;
  parts.push(value.slice(start).trim());
  return parts;
}

function unquoteYamlString(value) {
  const quote = value[0];
  if (value[value.length - 1] !== quote) return { ok: false, value: null };
  const inner = value.slice(1, -1);
  if (quote === "'") {
    let unquoted = '';
    for (let index = 0; index < inner.length; index += 1) {
      if (inner[index] !== "'") {
        unquoted += inner[index];
        continue;
      }
      if (inner[index + 1] !== "'") return { ok: false, value: null };
      unquoted += "'";
      index += 1;
    }
    return { ok: true, value: unquoted };
  }

  const simpleEscapes = {
    '0': '\0',
    a: '\x07',
    b: '\b',
    t: '\t',
    n: '\n',
    v: '\v',
    f: '\f',
    r: '\r',
    e: '\x1b',
    '"': '"',
    '/': '/',
    '\\': '\\',
    '_': '\u00a0',
    N: '\u0085',
    L: '\u2028',
    P: '\u2029'
  };
  const hexLengths = { x: 2, u: 4, U: 8 };
  let unquoted = '';

  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (character === '"') return { ok: false, value: null };
    if (character !== '\\') {
      unquoted += character;
      continue;
    }

    const escaped = inner[index + 1];
    if (Object.prototype.hasOwnProperty.call(simpleEscapes, escaped)) {
      unquoted += simpleEscapes[escaped];
      index += 1;
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(hexLengths, escaped)) return { ok: false, value: null };
    const hexLength = hexLengths[escaped];
    const hex = inner.slice(index + 2, index + 2 + hexLength);
    if (hex.length !== hexLength || !/^[0-9A-Fa-f]+$/.test(hex)) return { ok: false, value: null };
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return { ok: false, value: null };
    try {
      unquoted += String.fromCodePoint(codePoint);
    } catch (_error) {
      return { ok: false, value: null };
    }
    index += 1 + hexLength;
  }

  return { ok: true, value: unquoted };
}

function parseInlineArray(value) {
  if (!value.endsWith(']')) return { ok: false, value: null };
  const inner = value.slice(1, -1).trim();
  if (!inner) return { ok: true, value: [] };
  const parts = splitTopLevel(inner, ',');
  if (!parts || parts.some((part) => !part)) return { ok: false, value: null };
  const parsed = [];
  for (const part of parts) {
    const item = parseYamlScalar(part);
    if (!item.ok) return item;
    parsed.push(item.value);
  }
  return { ok: true, value: parsed };
}

function parseInlineObject(value) {
  if (!value.endsWith('}')) return { ok: false, value: null };
  const inner = value.slice(1, -1).trim();
  if (!inner) return { ok: true, value: {} };
  const parts = splitTopLevel(inner, ',');
  if (!parts || parts.some((part) => !part)) return { ok: false, value: null };
  const object = {};
  for (const part of parts) {
    const match = part.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) return { ok: false, value: null };
    const item = parseYamlScalar(match[2]);
    if (!item.ok) return item;
    object[match[1]] = item.value;
  }
  return { ok: true, value: object };
}

function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (/^(?:null|~)$/i.test(trimmed)) return { ok: true, value: null };
  if (trimmed === '{}') return { ok: true, value: {} };
  if (trimmed === '[]') return { ok: true, value: [] };
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return unquoteYamlString(trimmed);
  if (trimmed.startsWith('[')) return parseInlineArray(trimmed);
  if (trimmed.startsWith('{')) return parseInlineObject(trimmed);
  return { ok: true, value: trimmed };
}

function parseYamlPair(text) {
  const match = text.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
  if (!match) return null;
  return { key: match[1], rest: match[2] };
}

function parseYamlBlock(state, indent) {
  if (state.index >= state.lines.length) return { ok: true, value: null };
  const line = state.lines[state.index];
  if (line.indent !== indent) return { ok: false, value: null, error: 'unexpected-indentation' };
  if (line.text.startsWith('- ')) return parseYamlArray(state, indent);
  return parseYamlObject(state, indent);
}

function parseYamlObject(state, indent) {
  const object = {};
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.indent < indent) break;
    if (line.indent > indent || line.text.startsWith('- ')) {
      return { ok: false, value: null, error: 'unexpected-indentation' };
    }

    const pair = parseYamlPair(line.text);
    if (!pair) return { ok: false, value: null, error: 'unparseable-frontmatter' };
    state.index += 1;

    if (pair.rest.trim()) {
      const scalar = parseYamlScalar(pair.rest);
      if (!scalar.ok) return { ok: false, value: null, error: 'unparseable-frontmatter' };
      object[pair.key] = scalar.value;
      continue;
    }

    if (state.index < state.lines.length && state.lines[state.index].indent > indent) {
      const child = parseYamlBlock(state, state.lines[state.index].indent);
      if (!child.ok) return child;
      object[pair.key] = child.value;
    } else {
      object[pair.key] = null;
    }
  }
  return { ok: true, value: object };
}

function parseYamlArray(state, indent) {
  const array = [];
  const itemKeyIndent = indent + 2;

  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.indent < indent) break;
    if (line.indent > indent || !line.text.startsWith('- ')) {
      return { ok: false, value: null, error: 'unexpected-indentation' };
    }

    const itemText = line.text.slice(2).trim();
    state.index += 1;

    if (!itemText) {
      if (state.index < state.lines.length && state.lines[state.index].indent > indent) {
        const child = parseYamlBlock(state, state.lines[state.index].indent);
        if (!child.ok) return child;
        array.push(child.value);
      } else {
        array.push(null);
      }
      continue;
    }

    const pair = parseYamlPair(itemText);
    if (pair) {
      const object = {};
      if (pair.rest.trim()) {
        const scalar = parseYamlScalar(pair.rest);
        if (!scalar.ok) return { ok: false, value: null, error: 'unparseable-frontmatter' };
        object[pair.key] = scalar.value;
      } else if (state.index < state.lines.length && state.lines[state.index].indent > itemKeyIndent) {
        const child = parseYamlBlock(state, state.lines[state.index].indent);
        if (!child.ok) return child;
        object[pair.key] = child.value;
      } else {
        object[pair.key] = null;
      }

      if (state.index < state.lines.length && state.lines[state.index].indent > indent) {
        if (state.lines[state.index].indent !== itemKeyIndent) {
          return { ok: false, value: null, error: 'unexpected-indentation' };
        }
        const rest = parseYamlObject(state, itemKeyIndent);
        if (!rest.ok || !rest.value || Array.isArray(rest.value)) return { ok: false, value: null, error: 'unparseable-frontmatter' };
        Object.assign(object, rest.value);
      }
      array.push(object);
      continue;
    }

    const scalar = parseYamlScalar(itemText);
    if (!scalar.ok) return { ok: false, value: null, error: 'unparseable-frontmatter' };
    if (state.index < state.lines.length && state.lines[state.index].indent > indent) {
      return { ok: false, value: null, error: 'unexpected-indentation' };
    }
    array.push(scalar.value);
  }

  return { ok: true, value: array };
}

function parseYamlSubset(yaml) {
  const prepared = preprocessYamlLines(yaml);
  if (!prepared.ok) return { ok: false, value: null, error: prepared.error };
  if (!prepared.lines.length) return { ok: true, value: {} };
  if (prepared.lines[0].indent !== 0) return { ok: false, value: null, error: 'unexpected-indentation' };
  const state = { lines: prepared.lines, index: 0 };
  const parsed = parseYamlBlock(state, 0);
  if (!parsed.ok) return parsed;
  if (state.index !== prepared.lines.length) return { ok: false, value: null, error: 'unparseable-frontmatter' };
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return { ok: false, value: null, error: 'unparseable-frontmatter' };
  }
  return { ok: true, value: parsed.value, error: null };
}

function isValidRequiredFrontmatterValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^(?:null|~)$/i.test(trimmed)) return false;
  }
  return true;
}

function collectInvalidFrontmatterValuePaths(value, prefix, paths = []) {
  if (!isValidRequiredFrontmatterValue(value)) {
    paths.push(prefix);
    return paths;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectInvalidFrontmatterValuePaths(value[index], `${prefix}[${index}]`, paths);
    }
    return paths;
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      collectInvalidFrontmatterValuePaths(value[key], `${prefix}.${key}`, paths);
    }
  }

  return paths;
}

function invalidRequiredFrontmatterValuePaths(frontmatterValue, requiredValueKeys = []) {
  const paths = [];
  for (const key of requiredValueKeys) {
    if (frontmatterValue && Object.prototype.hasOwnProperty.call(frontmatterValue, key)) {
      paths.push(...collectInvalidFrontmatterValuePaths(frontmatterValue[key], key));
    }
  }
  return unique(paths);
}

function parseFrontmatterKeys(text, requiredKeys = [], requiredValueKeys = []) {
  const normalized = normalizeNewlines(text);
  if (!normalized.startsWith('---\n')) {
    return { ok: false, parse_ok: false, keys: [], invalidKeys: [], invalidValues: [], value: null, error: 'missing-frontmatter' };
  }

  const closeMatch = normalized.slice(4).match(/\n---\s*(?:\n|$)/);
  if (!closeMatch || typeof closeMatch.index !== 'number') {
    return { ok: false, parse_ok: false, keys: [], invalidKeys: [], invalidValues: [], value: null, error: 'unterminated-frontmatter' };
  }

  const frontmatter = normalized.slice(4, 4 + closeMatch.index);
  const parsed = parseYamlSubset(frontmatter);
  if (!parsed.ok) {
    return { ok: false, parse_ok: false, keys: [], invalidKeys: [], invalidValues: [], value: null, error: parsed.error || 'unparseable-frontmatter' };
  }

  const keys = Object.keys(parsed.value);
  const invalidKeys = requiredKeys.filter((key) => Object.prototype.hasOwnProperty.call(parsed.value, key) && !isValidRequiredFrontmatterValue(parsed.value[key]));
  const invalidValues = invalidRequiredFrontmatterValuePaths(parsed.value, requiredValueKeys);

  return {
    ok: invalidKeys.length === 0 && invalidValues.length === 0,
    parse_ok: true,
    keys: unique(keys),
    invalidKeys: unique(invalidKeys),
    invalidValues,
    value: parsed.value,
    error: invalidKeys.length || invalidValues.length ? 'invalid-frontmatter-value' : null
  };
}

function specById(id) {
  return REQUIRED_FOUNDATION_SPECS.find((spec) => spec.id === id) || null;
}

function readRequiredSpecText(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { ok: false, text: '', error: 'not-file' };
    return { ok: true, text: fs.readFileSync(file, 'utf8'), error: null };
  } catch (error) {
    return { ok: false, text: '', error: error && error.code ? error.code : 'read-error' };
  }
}

function labelValue(label, value) {
  return label ? `${label}:${value}` : value;
}

function hasDotPath(root, dotPath) {
  let cursor = root;
  for (const part of dotPath.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return false;
    }
    cursor = cursor[part];
  }
  return true;
}

function collectTokenReferences(value, references = []) {
  if (typeof value === 'string') {
    const pattern = /\{([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)\}/g;
    let match = pattern.exec(value);
    while (match) {
      references.push(match[1]);
      match = pattern.exec(value);
    }
    return references;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTokenReferences(item, references);
    return references;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectTokenReferences(item, references);
  }
  return references;
}

function invalidTokenReferences(frontmatterValue) {
  return unique(collectTokenReferences(frontmatterValue)).filter((reference) => !hasDotPath(frontmatterValue, reference));
}

function collectShapePaths(value, prefix) {
  const paths = prefix ? [prefix] : [];
  if (Array.isArray(value)) {
    const arrayPrefix = `${prefix}[]`;
    paths.push(arrayPrefix);
    for (const item of value) paths.push(...collectShapePaths(item, arrayPrefix));
    return unique(paths).sort();
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      paths.push(...collectShapePaths(value[key], childPrefix));
    }
  }
  return unique(paths).sort();
}

function themeContractShape(frontmatterValue) {
  const shapeKeys = ['colors', 'typography', 'spacing', 'rounded', 'components'];
  const paths = [];
  for (const key of shapeKeys) {
    if (frontmatterValue && Object.prototype.hasOwnProperty.call(frontmatterValue, key)) {
      paths.push(...collectShapePaths(frontmatterValue[key], key));
    } else {
      paths.push(`${key}:<missing>`);
    }
  }
  return unique(paths).sort();
}

function sameStringList(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function validateSpecText(text, contract, label = null) {
  const missingSections = contract.requiredSections
    .filter((heading) => !markdownHasSection(text, heading))
    .map((heading) => labelValue(label, heading));
  const missingKeys = [];
  const blockers = [];
  const invalidReferences = [];
  const invalidFrontmatterValues = [];
  let frontmatter = null;

  if (contract.requiredFrontmatterKeys.length) {
    const requiredValueKeys = contract.id === 'ui-design' ? UI_REQUIRED_TOKEN_ROOTS : [];
    frontmatter = parseFrontmatterKeys(text, contract.requiredFrontmatterKeys, requiredValueKeys);
    if (frontmatter.parse_ok) {
      missingKeys.push(
        ...contract.requiredFrontmatterKeys
          .filter((key) => !frontmatter.keys.includes(key))
          .map((key) => labelValue(label, key))
      );
    }
    invalidFrontmatterValues.push(...frontmatter.invalidValues.map((value) => labelValue(label, value)));
    if (!frontmatter.ok || missingKeys.length) blockers.push(`invalid-foundation-spec-frontmatter:${contract.id}`);

    if (frontmatter.parse_ok && frontmatter.value) {
      invalidReferences.push(...invalidTokenReferences(frontmatter.value).map((reference) => labelValue(label, reference)));
      if (invalidReferences.length) blockers.push(`invalid-foundation-spec-token-reference:${contract.id}`);
    }
  }

  if (missingSections.length) blockers.push(`invalid-foundation-spec-sections:${contract.id}`);

  const missingFieldLabelValues = [];
  const missingFlowIds = [];
  const declaresContent = contract.requireFieldLabelsAlways
    ? true
    : (contract.requiredFieldLabels || contract.requireFlowId) ? specDeclaresContent(text) : false;
  if (declaresContent) {
    if (contract.requiredFieldLabels) {
      missingFieldLabelValues.push(
        ...missingFieldLabels(text, contract.requiredFieldLabels).map((field) => labelValue(label, field))
      );
      if (missingFieldLabelValues.length) blockers.push(`invalid-foundation-spec-fields:${contract.id}`);
    }
    if (contract.requireFlowId && !FLOW_ID_PATTERN.test(text)) {
      missingFlowIds.push(labelValue(label, 'FLOW-ID'));
      blockers.push(`missing-flow-id:${contract.id}`);
    }
  }

  const unresolvedMarkers = [];
  if (/<decision-required>/i.test(text)) unresolvedMarkers.push(labelValue(label, '<decision-required>'));
  if (/\bdecision-required\b/i.test(text)) unresolvedMarkers.push(labelValue(label, 'decision-required'));
  if (/\b(?:TODO|TBD)\b/i.test(text)) unresolvedMarkers.push(labelValue(label, 'TODO/TBD'));
  if (unresolvedMarkers.length) blockers.push(`unresolved-foundation-spec-decisions:${contract.id}`);

  return {
    ok: blockers.length === 0,
    blockers: unique(blockers),
    missingSections,
    missingKeys,
    frontmatter,
    invalidReferences: unique(invalidReferences),
    invalidFrontmatterValues: unique(invalidFrontmatterValues),
    missingFieldLabels: unique(missingFieldLabelValues),
    missingFlowIds: unique(missingFlowIds),
    unresolvedMarkers: unique(unresolvedMarkers)
  };
}

function existingThemePairs(primaryFile) {
  const directory = path.dirname(primaryFile);
  const designLight = path.join(directory, 'design.light.md');
  const designDark = path.join(directory, 'design.dark.md');
  const light = path.join(directory, 'light.md');
  const dark = path.join(directory, 'dark.md');
  const pairs = [];
  const pairKeys = new Set();

  const addPair = (leftFile, rightFile) => {
    const key = `${leftFile}\0${rightFile}`;
    if (pairKeys.has(key)) return;
    pairKeys.add(key);
    pairs.push({ left: leftFile, right: rightFile });
  };

  if (fs.existsSync(designDark)) {
    addPair(fs.existsSync(designLight) ? designLight : primaryFile, designDark);
  }
  if (fs.existsSync(light) && fs.existsSync(dark)) {
    addPair(light, dark);
  }

  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (_error) {
    return pairs;
  }

  const markdownFiles = entries
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      file: path.join(directory, entry.name)
    }))
    .sort((leftEntry, rightEntry) => leftEntry.name.localeCompare(rightEntry.name));

  const exactFilesByName = new Map(markdownFiles.map((entry) => [entry.name, entry.file]));
  const normalizedFilesByName = new Map();
  for (const entry of markdownFiles) {
    const key = entry.name.toLowerCase();
    normalizedFilesByName.set(key, normalizedFilesByName.has(key) ? null : entry.file);
  }

  const findMarkdownFile = (filename) => {
    if (exactFilesByName.has(filename)) return exactFilesByName.get(filename);
    return normalizedFilesByName.get(filename.toLowerCase()) || null;
  };

  const companionFilename = (filename, fromTheme, toTheme) => {
    const stem = filename.replace(/\.md$/i, '');
    const parts = stem.split(/([^A-Za-z0-9]+)/).filter(Boolean);
    let themeTokens = 0;
    const replaced = parts.map((part) => {
      if (!/^[A-Za-z0-9]+$/.test(part) || part.toLowerCase() !== fromTheme) return part;
      themeTokens += 1;
      return toTheme;
    });
    return themeTokens === 1 ? `${replaced.join('')}.md` : null;
  };

  for (const entry of markdownFiles) {
    const darkName = companionFilename(entry.name, 'light', 'dark');
    if (!darkName) continue;
    const darkFile = findMarkdownFile(darkName);
    if (darkFile && darkFile !== entry.file) addPair(entry.file, darkFile);
  }

  return pairs;
}

function validateThemeCompanions(primaryFile, primaryText, primaryValidation, contract) {
  const themePairs = existingThemePairs(primaryFile);
  const docs = new Map();
  docs.set(primaryFile, {
    label: path.basename(primaryFile),
    validation: primaryValidation,
    text: primaryText,
    unreadable: false
  });

  for (const pair of themePairs) {
    for (const file of [pair.left, pair.right]) {
      if (docs.has(file)) continue;
      const label = path.basename(file);
      const read = readRequiredSpecText(file);
      if (!read.ok) {
        docs.set(file, {
          label,
          validation: {
            blockers: [`unreadable-foundation-spec:${contract.id}`],
            missingSections: [],
            missingKeys: [],
            frontmatter: null,
            invalidReferences: [],
            invalidFrontmatterValues: []
          },
          text: '',
          unreadable: true
        });
        continue;
      }
      docs.set(file, {
        label,
        validation: validateSpecText(read.text, contract, label),
        text: read.text,
        unreadable: false
      });
    }
  }

  const blockers = [];
  const missingSections = [];
  const missingKeys = [];
  const invalidReferences = [];
  const invalidFrontmatterValues = [];
  const frontmatterErrors = [];
  for (const doc of docs.values()) {
    if (doc.label === path.basename(primaryFile)) continue;
    blockers.push(...doc.validation.blockers);
    missingSections.push(...doc.validation.missingSections);
    missingKeys.push(...doc.validation.missingKeys);
    invalidReferences.push(...doc.validation.invalidReferences);
    invalidFrontmatterValues.push(...doc.validation.invalidFrontmatterValues);
    if (doc.validation.frontmatter && doc.validation.frontmatter.parse_ok === false && doc.validation.frontmatter.error) {
      frontmatterErrors.push(labelValue(doc.label, doc.validation.frontmatter.error));
    }
  }

  for (const pair of themePairs) {
    const left = docs.get(pair.left);
    const right = docs.get(pair.right);
    if (!left || !right || left.unreadable || right.unreadable) continue;
    if (!left.validation.frontmatter || !right.validation.frontmatter) continue;
    if (!left.validation.frontmatter.parse_ok || !right.validation.frontmatter.parse_ok) continue;
    const leftShape = themeContractShape(left.validation.frontmatter.value);
    const rightShape = themeContractShape(right.validation.frontmatter.value);
    if (!sameStringList(leftShape, rightShape)) blockers.push(`invalid-foundation-spec-theme-parity:${contract.id}`);
  }

  return {
    blockers: unique(blockers),
    missingSections,
    missingKeys,
    invalidReferences: unique(invalidReferences),
    invalidFrontmatterValues: unique(invalidFrontmatterValues),
    frontmatterErrors: unique(frontmatterErrors)
  };
}

function validateOne(root, spec) {
  const contract = typeof spec === 'string' ? specById(spec) : spec;
  if (!contract || !contract.id || !contract.path) {
    return {
      id: contract && contract.id ? contract.id : 'unknown',
      path: contract && contract.path ? contract.path : null,
      ok: false,
      blockers: ['invalid-foundation-spec-contract'],
      missing_sections: [],
      missing_frontmatter_keys: []
    };
  }

  const file = path.join(root, contract.path);
  if (!fs.existsSync(file)) {
    return {
      id: contract.id,
      path: contract.path,
      ok: false,
      blockers: [`missing-foundation-spec:${contract.id}`],
      missing_sections: contract.requiredSections.slice(),
      missing_frontmatter_keys: contract.requiredFrontmatterKeys.slice()
    };
  }

  const read = readRequiredSpecText(file);
  if (!read.ok) {
    return {
      id: contract.id,
      path: contract.path,
      ok: false,
      blockers: [`unreadable-foundation-spec:${contract.id}`],
      missing_sections: [],
      missing_frontmatter_keys: []
    };
  }

  const primary = validateSpecText(read.text, contract);
  const missingSections = primary.missingSections.slice();
  const missingKeys = primary.missingKeys.slice();
  const blockers = primary.blockers.slice();
  const invalidReferences = primary.invalidReferences.slice();
  const invalidFrontmatterValues = primary.invalidFrontmatterValues.slice();
  const missingFieldLabelValues = primary.missingFieldLabels.slice();
  const missingFlowIds = primary.missingFlowIds.slice();
  const frontmatterErrors = [];
  const frontmatter_error = primary.frontmatter ? primary.frontmatter.error : null;

  if (contract.id === 'ui-design') {
    const theme = validateThemeCompanions(file, read.text, primary, contract);
    blockers.push(...theme.blockers);
    missingSections.push(...theme.missingSections);
    missingKeys.push(...theme.missingKeys);
    invalidReferences.push(...theme.invalidReferences);
    invalidFrontmatterValues.push(...theme.invalidFrontmatterValues);
    frontmatterErrors.push(...theme.frontmatterErrors);
  }

  return {
    id: contract.id,
    path: contract.path,
    ok: blockers.length === 0,
    blockers: unique(blockers),
    missing_sections: missingSections,
    missing_frontmatter_keys: missingKeys,
    ...(frontmatter_error ? { frontmatter_error } : {}),
    ...(frontmatterErrors.length ? { frontmatter_errors: unique(frontmatterErrors) } : {}),
    ...(invalidReferences.length ? { invalid_token_references: unique(invalidReferences) } : {}),
    ...(invalidFrontmatterValues.length ? { invalid_frontmatter_values: unique(invalidFrontmatterValues) } : {}),
    ...(missingFieldLabelValues.length ? { missing_field_labels: unique(missingFieldLabelValues) } : {}),
    ...(missingFlowIds.length ? { missing_flow_ids: unique(missingFlowIds) } : {})
  };
}

function validateFoundationSpecs(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const specs = REQUIRED_FOUNDATION_SPECS.map((spec) => validateOne(projectRoot, spec));
  const blockers = specs.flatMap((spec) => spec.blockers);
  if (!fs.existsSync(lib.openspecDir(projectRoot))) blockers.unshift('openspec-missing');

  return {
    ok: blockers.length === 0,
    project_root: projectRoot,
    blockers: unique(blockers),
    specs
  };
}

function markdown(result) {
  const lines = [];
  lines.push('# SpecNav Foundation Specs');
  lines.push('');
  lines.push(`- project: \`${result.project_root}\``);
  lines.push(`- ok: ${result.ok}`);
  if (result.blockers.length) lines.push(`- blockers: ${result.blockers.join(', ')}`);
  lines.push('');
  lines.push('| Spec | Status | Blockers | Missing |');
  lines.push('| --- | --- | --- | --- |');
  for (const spec of result.specs) {
    const missing = [
      ...spec.missing_sections,
      ...spec.missing_frontmatter_keys.map((key) => `frontmatter:${key}`)
    ];
    lines.push(`| ${spec.id} | ${spec.ok ? 'pass' : 'blocked'} | ${spec.blockers.join('<br>') || '-'} | ${missing.join('<br>') || '-'} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const result = validateFoundationSpecs();
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : markdown(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { validateFoundationSpecs, validateOne, markdown };
