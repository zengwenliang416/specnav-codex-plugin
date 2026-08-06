'use strict';

const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

const EVIDENCE_AUTHORITIES = new WeakSet();
const FACT_AUTHORITIES = new WeakSet();

function digestValue(value) {
  try {
    return sha256(canonicalJson(value === undefined ? null : value));
  } catch {
    return null;
  }
}

function stableEntries(records) {
  return [...records].sort((left, right) => (
    String(left.captured_at).localeCompare(String(right.captured_at))
    || String(left.id).localeCompare(String(right.id))
  ));
}

function parseRaw(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  const records = [];
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const value = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    records.push(value);
  }
  return records;
}

function createEvidenceIndexAuthority(options = {}) {
  const { readRaw } = options;
  if (typeof readRaw !== 'function') {
    throw new Error('verification-report:evidence-authority-config-invalid');
  }
  const authority = Object.freeze({
    verify(index) {
      let bytes;
      let records;
      try {
        bytes = readRaw({
          change_id: index.change_id,
          source_raw: index.source_raw
        });
        records = parseRaw(bytes);
      } catch {
        records = null;
      }
      const entries = records ? stableEntries(records) : null;
      const entryIds = entries?.map((entry) => entry.id);
      const uniqueIds = entryIds ? new Set(entryIds) : null;
      const sourceDigest = Buffer.isBuffer(bytes) ? sha256(bytes) : null;
      const entriesDigest = entries
        ? sha256(canonicalJson(entries))
        : null;
      const ok = Array.isArray(entries)
        && uniqueIds.size === entryIds.length
        && index.source_raw === 'raw.jsonl'
        && sourceDigest === index.source_digest
        && canonicalJson(entries) === canonicalJson(index.entries)
        && index.record_count === entries.length;
      return Object.freeze({
        ok,
        change_id: index.change_id,
        source_raw: index.source_raw,
        source_digest: sourceDigest,
        entries_digest: entriesDigest,
        index_version: index.index_version,
        record_count: entries?.length ?? -1,
        entry_ids: entryIds ? [...entryIds].sort() : []
      });
    }
  });
  EVIDENCE_AUTHORITIES.add(authority);
  return authority;
}

function isEvidenceIndexAuthority(value) {
  return EVIDENCE_AUTHORITIES.has(value)
    && typeof value?.verify === 'function';
}

function createReportFactAuthority(options = {}) {
  const {
    verifyIntegrity,
    verifyFreshness,
    verifyGateFacts
  } = options;
  if (
    typeof verifyIntegrity !== 'function'
    || typeof verifyFreshness !== 'function'
    || typeof verifyGateFacts !== 'function'
  ) {
    throw new Error('verification-report:fact-authority-config-invalid');
  }
  const authority = Object.freeze({
    verifyIntegrity(payload) {
      const ok = verifyIntegrity(structuredClone(payload)) === true;
      return Object.freeze({
        ok,
        change_id: payload.change_id,
        evidence_index_version: payload.evidence_index_version,
        evidence_index_digest: payload.evidence_index_digest,
        integrity_digest: digestValue(payload.integrity)
      });
    },
    verifyFreshness(payload) {
      const ok = verifyFreshness(structuredClone(payload)) === true;
      return Object.freeze({
        ok,
        change_id: payload.change_id,
        case_snapshot_hash: payload.case_snapshot_hash,
        run_ids: [...payload.run_ids].sort(),
        attempt_ids: [...payload.attempt_ids].sort(),
        freshness_digest: digestValue(payload.freshness)
      });
    },
    verifyGateFacts(payload) {
      const ok = verifyGateFacts(structuredClone(payload)) === true;
      return Object.freeze({
        ok,
        change_id: payload.change_id,
        failure_state_status: payload.failure_state_status,
        failure_state_digest: payload.failure_state_digest,
        authority_chain_digest: payload.authority_chain_digest
      });
    }
  });
  FACT_AUTHORITIES.add(authority);
  return authority;
}

function isReportFactAuthority(value) {
  return FACT_AUTHORITIES.has(value)
    && typeof value?.verifyIntegrity === 'function'
    && typeof value?.verifyFreshness === 'function'
    && typeof value?.verifyGateFacts === 'function';
}

module.exports = {
  createEvidenceIndexAuthority,
  createReportFactAuthority,
  isEvidenceIndexAuthority,
  isReportFactAuthority
};
