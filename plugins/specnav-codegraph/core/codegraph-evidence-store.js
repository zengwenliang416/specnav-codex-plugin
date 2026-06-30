#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          return {
            schema: 'specnav.codegraph.evidence.v1',
            id: `invalid-${index + 1}`,
            confidence: 'missing',
            blockers: [`invalid-jsonl:${index + 1}`]
          };
        }
      });
  } catch {
    return [];
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function appendEvidence(file, record) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

function defaultChangeCodegraphDir(projectRoot, change) {
  return path.join(projectRoot, 'openspec', 'changes', change, 'codegraph');
}

function artifactPaths(projectRoot, change) {
  const dir = defaultChangeCodegraphDir(projectRoot, change);
  return {
    dir,
    status: path.join(dir, 'status.json'),
    decision: path.join(dir, 'decision.json'),
    guardReport: path.join(dir, 'guard-report.json'),
    evidenceRaw: path.join(dir, 'evidence.jsonl'),
    evidenceIndex: path.join(dir, 'evidence-index.json'),
    claimsMap: path.join(dir, 'claims-map.json'),
    claimsReport: path.join(dir, 'claims-report.json'),
    driftReport: path.join(dir, 'drift-report.json'),
    impactReport: path.join(dir, 'impact-report.json')
  };
}

function relativeArtifactPaths(change) {
  return {
    status: `openspec/changes/${change}/codegraph/status.json`,
    decision: `openspec/changes/${change}/codegraph/decision.json`,
    guard_report: `openspec/changes/${change}/codegraph/guard-report.json`,
    evidence_raw: `openspec/changes/${change}/codegraph/evidence.jsonl`,
    evidence_index: `openspec/changes/${change}/codegraph/evidence-index.json`,
    claims_map: `openspec/changes/${change}/codegraph/claims-map.json`,
    claims_report: `openspec/changes/${change}/codegraph/claims-report.json`,
    drift_report: `openspec/changes/${change}/codegraph/drift-report.json`,
    impact_report: `openspec/changes/${change}/codegraph/impact-report.json`
  };
}

function activeChange(projectRoot) {
  const envChange = process.env.SPECNAV_CHANGE;
  if (envChange && envChange.trim()) return envChange.trim();
  try {
    const value = fs.readFileSync(path.join(projectRoot, 'openspec', '.specnav', 'active-change'), 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function summarizeRecords(records, activeChange = null) {
  const byClaim = {};
  const byStage = {};
  const blockers = [];

  for (const record of records) {
    const claim = record.claim_id || record.claim || 'unmapped';
    const stage = record.stage || 'unknown';
    const confidence = record.confidence || 'missing';
    const files = Array.isArray(record.files) ? record.files : [];
    const symbols = files.flatMap((item) => Array.isArray(item.symbols) ? item.symbols : []);
    const filePaths = files.map((item) => item.path).filter(Boolean);

    if (!byClaim[claim]) {
      byClaim[claim] = {
        status: confidence,
        evidence_ids: [],
        files: [],
        symbols: [],
        blockers: []
      };
    }
    byClaim[claim].evidence_ids.push(record.id || record.evidence_id || `ev-${byClaim[claim].evidence_ids.length + 1}`);
    byClaim[claim].files.push(...filePaths);
    byClaim[claim].symbols.push(...symbols);
    byClaim[claim].blockers.push(...(Array.isArray(record.blockers) ? record.blockers : []));
    if (['missing', 'not-indexed', 'stale'].includes(confidence)) byClaim[claim].status = confidence === 'not-indexed' ? 'missing' : confidence;
    else if (byClaim[claim].status !== 'missing' && byClaim[claim].status !== 'stale') byClaim[claim].status = confidence;

    if (!byStage[stage]) {
      byStage[stage] = { verified: 0, partial: 0, missing: 0, stale: 0, blocking: 0 };
    }
    if (confidence === 'matched') byStage[stage].verified += 1;
    else if (confidence === 'partial') byStage[stage].partial += 1;
    else if (confidence === 'stale') byStage[stage].stale += 1;
    else byStage[stage].missing += 1;

    const recordBlockers = Array.isArray(record.blockers) ? record.blockers : [];
    if (recordBlockers.length) {
      byStage[stage].blocking += recordBlockers.length;
      blockers.push(...recordBlockers);
    }
  }

  for (const claim of Object.keys(byClaim)) {
    byClaim[claim].evidence_ids = Array.from(new Set(byClaim[claim].evidence_ids));
    byClaim[claim].files = Array.from(new Set(byClaim[claim].files));
    byClaim[claim].symbols = Array.from(new Set(byClaim[claim].symbols));
    byClaim[claim].blockers = Array.from(new Set(byClaim[claim].blockers));
  }

  return {
    schema: 'specnav.codegraph.evidence_index.v1',
    generated_at: new Date().toISOString(),
    active_change: activeChange,
    source_raw: null,
    by_claim: byClaim,
    by_stage: byStage,
    blockers: Array.from(new Set(blockers))
  };
}

function buildEvidenceIndex(rawFile, options = {}) {
  const rawExists = fileExists(rawFile);
  const records = parseJsonl(rawFile);
  const index = summarizeRecords(records, options.activeChange || null);
  index.source_raw = options.sourceRaw || rawFile;
  index.raw_exists = rawExists;
  index.record_count = records.length;
  return index;
}

function rawNewerThanIndex(rawFile, indexFile) {
  try {
    return fs.statSync(rawFile).mtimeMs > fs.statSync(indexFile).mtimeMs;
  } catch {
    return true;
  }
}

function loadOrBuildIndex(rawFile, indexFile, options = {}) {
  const existing = readJson(indexFile, null);
  const currentShape = existing
    && Object.prototype.hasOwnProperty.call(existing, 'raw_exists')
    && Object.prototype.hasOwnProperty.call(existing, 'record_count');
  if (existing && currentShape && !rawNewerThanIndex(rawFile, indexFile)) return existing;
  const index = buildEvidenceIndex(rawFile, options);
  writeJson(indexFile, index);
  return index;
}

module.exports = {
  activeChange,
  appendEvidence,
  artifactPaths,
  buildEvidenceIndex,
  defaultChangeCodegraphDir,
  ensureDir,
  fileExists,
  loadOrBuildIndex,
  parseJsonl,
  readJson,
  relativeArtifactPaths,
  writeJson
};
