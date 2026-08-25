'use strict';

const crypto = require('node:crypto');

const { deepFreeze } = require('../contracts/schema-registry');
const { canonicalJson, sha256 } = require('../evidence/identity');

const COLLECTIONS = Object.freeze([
  'runs',
  'attempts',
  'executions',
  'readings',
  'failures',
  'repair_links',
  'evidence',
  'transition_proposals',
  'transition_receipts',
  'attempt_facts'
]);

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function keyBytes(value) {
  const bytes = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : null;
  return bytes && bytes.length >= 32 ? bytes : null;
}

function signature(key, value) {
  const unsigned = structuredClone(value);
  delete unsigned.signature;
  return crypto.createHmac('sha256', key)
    .update(canonicalJson(unsigned))
    .digest('hex');
}

function stableIds(values) {
  return [...new Set(values)].sort();
}

function collectionInventory(values) {
  if (!Array.isArray(values)) {
    throw new Error('verification-generation:collection-invalid');
  }
  const records = values.map((value) => {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || typeof value.id !== 'string'
      || value.id.length === 0
    ) {
      throw new Error('verification-generation:record-invalid');
    }
    return {
      id: value.id,
      sha256: sha256(canonicalJson(value))
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(records.map((entry) => entry.id)).size !== records.length) {
    throw new Error('verification-generation:record-duplicate');
  }
  return {
    count: records.length,
    digest: sha256(canonicalJson(records)),
    records
  };
}

function createBaseline(collections) {
  return Object.fromEntries(COLLECTIONS.map((name) => [
    name,
    collectionInventory(collections?.[name] || [])
  ]));
}

function reviewSemantic(review) {
  const value = structuredClone(review);
  delete value.id;
  delete value.review_sha256;
  return value;
}

function reviewIdentity(review) {
  const digest = sha256(canonicalJson(reviewSemantic(review)));
  return {
    id: `generation-review-${digest.slice(0, 24)}`,
    digest
  };
}

function sameCurrentState(review, current) {
  return review.change_id === current.change_id
    && review.reviewer_id === current.reviewer_id
    && review.snapshot_id === current.snapshot_id
    && review.snapshot_hash === current.snapshot_hash
    && review.parent_generation_id === current.parent_generation_id
    && canonicalJson(review.fingerprints) === canonicalJson(current.fingerprints)
    && canonicalJson(review.historical_break_loop_failure_ids)
      === canonicalJson(current.historical_break_loop_failure_ids)
    && canonicalJson(review.baseline)
      === canonicalJson(createBaseline(current.collections));
}

function verifyBaseline(baseline, collections) {
  const blockers = [];
  for (const name of COLLECTIONS) {
    const frozen = baseline?.[name];
    let current;
    try {
      current = collectionInventory(collections?.[name] || []);
    } catch (error) {
      blockers.push(blocker(
        'verification-generation:baseline-current-invalid',
        name,
        error instanceof Error ? error.message : String(error)
      ));
      continue;
    }
    const currentById = new Map(current.records.map((entry) => [
      entry.id,
      entry.sha256
    ]));
    const frozenIds = Array.isArray(frozen?.records)
      ? frozen.records.map((entry) => entry.id)
      : [];
    const frozenSelfValid = frozen
      && frozen.count === frozen.records.length
      && new Set(frozenIds).size === frozenIds.length
      && frozen.digest === sha256(canonicalJson(frozen.records));
    if (
      !frozenSelfValid
      || current.count < frozen.count
      || frozen.records.some((entry) => (
        currentById.get(entry.id) !== entry.sha256
      ))
    ) {
      blockers.push(blocker(
        'verification-generation:baseline-drift',
        name
      ));
    }
  }
  return deepFreeze({ ok: blockers.length === 0, blockers });
}

function readJsonArray(store, relativePath, blockers) {
  const read = store.readBytes(relativePath);
  if (!read.ok) {
    blockers.push(...read.blockers);
    return [];
  }
  if (read.missing) return [];
  try {
    const value = JSON.parse(read.bytes.toString('utf8'));
    if (!Array.isArray(value)) throw new Error('array-required');
    return value;
  } catch (error) {
    blockers.push(blocker(
      'verification-generation:projection-invalid',
      relativePath,
      error instanceof Error ? error.message : String(error)
    ));
    return [];
  }
}

function readOptionalJson(store, relativePath, blockers) {
  const read = store.readBytes(relativePath);
  if (!read.ok) {
    blockers.push(...read.blockers);
    return null;
  }
  if (read.missing) return null;
  try {
    return JSON.parse(read.bytes.toString('utf8'));
  } catch (error) {
    blockers.push(blocker(
      'verification-generation:projection-invalid',
      relativePath,
      error instanceof Error ? error.message : String(error)
    ));
    return null;
  }
}

function readJsonl(store, relativePath, blockers) {
  const read = store.readJsonl(relativePath);
  if (!read.ok) {
    blockers.push(...read.blockers);
    return [];
  }
  return read.value;
}

function collectGenerationState(options = {}) {
  const {
    store,
    changeId,
    reviewerId,
    snapshot,
    currentFingerprints,
    parentGenerationId = null
  } = options;
  if (
    !store
    || typeof store.readBytes !== 'function'
    || typeof changeId !== 'string'
    || typeof reviewerId !== 'string'
    || !snapshot
    || !currentFingerprints
  ) {
    return {
      ok: false,
      state: null,
      blockers: [blocker(
        'verification-generation:state-config-invalid',
        'generation-state'
      )]
    };
  }
  const blockers = [];
  const evidenceIndex = readOptionalJson(
    store,
    'evidence/index.json',
    blockers
  );
  const failureState = readOptionalJson(
    store,
    'v2/failure-state.json',
    blockers
  );
  const collections = {
    runs: readJsonArray(store, 'v2/runs.json', blockers),
    attempts: readJsonArray(store, 'v2/attempts.json', blockers),
    executions: readJsonArray(store, 'v2/executions.json', blockers),
    readings: readJsonArray(store, 'v2/readings.json', blockers),
    failures: readJsonArray(store, 'v2/failures.json', blockers),
    repair_links: readJsonArray(store, 'v2/repair-links.json', blockers),
    evidence: Array.isArray(evidenceIndex?.entries)
      ? evidenceIndex.entries
      : [],
    transition_proposals: readJsonl(
      store,
      'v2/transition-proposals.jsonl',
      blockers
    ),
    transition_receipts: readJsonl(
      store,
      'v2/transition-receipts.jsonl',
      blockers
    ),
    attempt_facts: readJsonl(
      store,
      'v2/attempt-facts.jsonl',
      blockers
    )
  };
  const historicalBreakLoopFailureIds = stableIds(
    Array.isArray(failureState?.states)
      ? failureState.states.filter((entry) => (
          entry?.logical_status === 'break_loop'
          && typeof entry.failure_id === 'string'
        )).map((entry) => entry.failure_id)
      : []
  );
  return deepFreeze({
    ok: blockers.length === 0,
    state: {
      change_id: changeId,
      reviewer_id: reviewerId,
      snapshot_id: snapshot.id,
      snapshot_hash: snapshot.snapshot_hash,
      parent_generation_id: parentGenerationId,
      fingerprints: structuredClone(currentFingerprints),
      historical_break_loop_failure_ids: historicalBreakLoopFailureIds,
      collections
    },
    blockers
  });
}

function createVerificationGenerationAuthority(options = {}) {
  const {
    schemaRegistry,
    key,
    clock = () => new Date().toISOString()
  } = options;
  const authorityKey = keyBytes(key);
  if (
    !schemaRegistry
    || typeof schemaRegistry.validate !== 'function'
    || !authorityKey
    || typeof clock !== 'function'
  ) {
    throw new Error('verification-generation:config-invalid');
  }

  function prepare(request) {
    const candidate = {
      schema: 'specnav.verification.generation-review.v1',
      change_id: request?.change_id,
      reviewer_id: request?.reviewer_id,
      snapshot_id: request?.snapshot_id,
      snapshot_hash: request?.snapshot_hash,
      parent_generation_id: request?.parent_generation_id ?? null,
      fingerprints: structuredClone(request?.fingerprints),
      historical_break_loop_failure_ids: stableIds(
        request?.historical_break_loop_failure_ids || []
      ),
      baseline: createBaseline(request?.collections),
      prepared_at: clock()
    };
    const identity = reviewIdentity(candidate);
    const review = {
      ...candidate,
      id: identity.id,
      review_sha256: identity.digest
    };
    const validation = schemaRegistry.validate(
      'verification-generation-review',
      review
    );
    return validation.ok
      ? deepFreeze({ ok: true, review: validation.value, blockers: [] })
      : deepFreeze({ ok: false, review: null, blockers: validation.blockers });
  }

  function verifyReview(rawReview) {
    const validation = schemaRegistry.validate(
      'verification-generation-review',
      rawReview
    );
    if (!validation.ok) return { ok: false, blockers: validation.blockers };
    const identity = reviewIdentity(validation.value);
    if (
      validation.value.id !== identity.id
      || validation.value.review_sha256 !== identity.digest
    ) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-generation:review-identity-invalid',
          validation.value.id
        )]
      };
    }
    return { ok: true, review: validation.value, blockers: [] };
  }

  function verify(rawGeneration) {
    const validation = schemaRegistry.validate(
      'verification-generation',
      rawGeneration
    );
    if (!validation.ok) return { ok: false };
    const generation = validation.value;
    const actual = Buffer.from(generation.signature, 'hex');
    const expected = Buffer.from(signature(authorityKey, generation), 'hex');
    if (
      generation.id
        !== `generation-${generation.review_sha256.slice(0, 24)}`
      || actual.length !== expected.length
      || !crypto.timingSafeEqual(actual, expected)
    ) {
      return { ok: false };
    }
    return { ok: true, generation };
  }

  function validateLog(values, expectedChangeId = null) {
    if (!Array.isArray(values)) {
      return {
        ok: false,
        values: [],
        blockers: [blocker(
          'verification-generation:log-invalid',
          'v2/generations.jsonl'
        )]
      };
    }
    const verified = [];
    let previousDigest = null;
    let parentId = null;
    for (let index = 0; index < values.length; index += 1) {
      const result = verify(values[index]);
      const generation = result.generation;
      if (
        !result.ok
        || generation.log_sequence !== index + 1
        || generation.previous_generation_digest !== previousDigest
        || generation.parent_generation_id !== parentId
        || (
          expectedChangeId !== null
          && generation.change_id !== expectedChangeId
        )
      ) {
        return {
          ok: false,
          values: [],
          blockers: [blocker(
            'verification-generation:log-chain-invalid',
            'v2/generations.jsonl',
            generation?.id || `line-${index + 1}`
          )]
        };
      }
      verified.push(generation);
      parentId = generation.id;
      previousDigest = sha256(canonicalJson(generation));
    }
    return {
      ok: true,
      values: verified,
      active: verified.at(-1) || null,
      latest_digest: previousDigest,
      blockers: []
    };
  }

  function append(store, reviewValue, current, approved) {
    if (approved !== true) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-generation:approval-required',
          reviewValue?.id || 'generation-review'
        )]
      };
    }
    const reviewed = verifyReview(reviewValue);
    if (!reviewed.ok) return reviewed;
    if (!sameCurrentState(reviewed.review, current)) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-generation:review-stale',
          reviewed.review.id
        )]
      };
    }
    const appended = store.appendDerivedJsonl(
      'v2/generations.jsonl',
      (existing) => {
        const chain = validateLog(existing, reviewed.review.change_id);
        if (!chain.ok) return null;
        const replay = chain.values.find((entry) => (
          entry.review_id === reviewed.review.id
          && entry.review_sha256 === reviewed.review.review_sha256
        ));
        if (replay) return replay;
        if (
          reviewed.review.parent_generation_id
            !== (chain.active?.id || null)
        ) {
          return null;
        }
        const unsigned = {
          schema: 'specnav.verification.generation.v1',
          id: `generation-${reviewed.review.review_sha256.slice(0, 24)}`,
          change_id: reviewed.review.change_id,
          review_id: reviewed.review.id,
          review_sha256: reviewed.review.review_sha256,
          reviewer_id: reviewed.review.reviewer_id,
          snapshot_id: reviewed.review.snapshot_id,
          snapshot_hash: reviewed.review.snapshot_hash,
          parent_generation_id: reviewed.review.parent_generation_id,
          fingerprints: structuredClone(reviewed.review.fingerprints),
          historical_break_loop_failure_ids: [
            ...reviewed.review.historical_break_loop_failure_ids
          ],
          baseline: structuredClone(reviewed.review.baseline),
          activated_at: clock(),
          log_sequence: existing.length + 1,
          previous_generation_digest: chain.latest_digest,
          signature_algorithm: 'hmac-sha256'
        };
        return {
          ...unsigned,
          signature: signature(authorityKey, unsigned)
        };
      }
    );
    if (!appended.ok) return appended;
    const read = store.readJsonl('v2/generations.jsonl');
    if (!read.ok) return read;
    const validated = validateLog(read.value, reviewed.review.change_id);
    if (!validated.ok) return validated;
    const value = validated.values.find((entry) => (
      entry.review_id === reviewed.review.id
      && entry.review_sha256 === reviewed.review.review_sha256
    ));
    if (!value) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-generation:activation-missing',
          reviewed.review.id
        )]
      };
    }
    return {
      ok: true,
      appended: appended.appended,
      value,
      values: validated.values,
      latest_digest: validated.latest_digest,
      blockers: []
    };
  }

  function validateActive(generation, current) {
    const verified = verify(generation);
    if (!verified.ok) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-generation:active-invalid',
          generation?.id || 'generation'
        )]
      };
    }
    const value = verified.generation;
    const bindingsMatch = value.change_id === current.change_id
      && value.snapshot_id === current.snapshot_id
      && value.snapshot_hash === current.snapshot_hash
      && canonicalJson(value.fingerprints)
        === canonicalJson(current.fingerprints);
    const baseline = verifyBaseline(value.baseline, current.collections);
    return deepFreeze({
      ok: bindingsMatch && baseline.ok,
      generation: value,
      blockers: [
        ...(bindingsMatch ? [] : [blocker(
          'verification-generation:active-binding-mismatch',
          value.id
        )]),
        ...baseline.blockers
      ]
    });
  }

  return Object.freeze({
    append,
    prepare,
    validateActive,
    validateLog,
    verify,
    verifyReview
  });
}

module.exports = {
  COLLECTIONS,
  collectGenerationState,
  collectionInventory,
  createBaseline,
  createVerificationGenerationAuthority,
  verifyBaseline
};
