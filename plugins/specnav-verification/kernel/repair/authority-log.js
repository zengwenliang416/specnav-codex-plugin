'use strict';

const {
  canonicalJson,
  sha256
} = require('../evidence/identity');

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function envelopeDigest(envelope) {
  return sha256(canonicalJson(envelope));
}

function baseBindings(bindings) {
  const value = { ...bindings };
  delete value.log_sequence;
  delete value.previous_envelope_digest;
  return value;
}

function logHead(relativePath, kind, validation) {
  const values = validation?.value || [];
  const terminal = values.at(-1) || null;
  return {
    kind,
    path: relativePath,
    sequence: values.length,
    latest_digest: validation?.latest_digest || null,
    terminal_envelope_id: terminal?.id || null
  };
}

function createAuthorityLog(options = {}) {
  const { store, authority } = options;
  if (
    !store
    || typeof store.readJsonl !== 'function'
    || typeof store.appendDerivedJsonl !== 'function'
    || !authority
    || typeof authority.seal !== 'function'
    || typeof authority.verify !== 'function'
  ) {
    throw new Error('verification-authority-log:config-invalid');
  }

  function validate(relativePath, expectedKind) {
    const read = store.readJsonl(relativePath);
    if (!read.ok) return read;
    let previousDigest = null;
    const values = [];
    for (let index = 0; index < read.value.length; index += 1) {
      const envelope = read.value[index];
      const verification = authority.verify(envelope);
      if (
        !verification.ok
        || envelope.kind !== expectedKind
        || envelope.bindings.log_sequence !== index + 1
        || envelope.bindings.previous_envelope_digest !== previousDigest
      ) {
        return {
          ok: false,
          value: [],
          blockers: [blocker(
            'verification-authority-log:chain-invalid',
            relativePath,
            envelope?.id || `line-${index + 1}`
          )]
        };
      }
      values.push(envelope);
      previousDigest = envelopeDigest(envelope);
    }
    return {
      ok: true,
      value: values,
      latest_digest: previousDigest,
      blockers: []
    };
  }

  function append(relativePath, kind, payload, bindings) {
    const result = store.appendDerivedJsonl(
      relativePath,
      (existing) => {
        let previousDigest = null;
        for (let index = 0; index < existing.length; index += 1) {
          const envelope = existing[index];
          const verification = authority.verify(envelope);
          if (
            !verification.ok
            || envelope.kind !== kind
            || envelope.bindings.log_sequence !== index + 1
            || envelope.bindings.previous_envelope_digest !== previousDigest
          ) {
            return null;
          }
          previousDigest = envelopeDigest(envelope);
        }
        const replay = existing.find((envelope) => (
          envelope.kind === kind
          && canonicalJson(envelope.payload) === canonicalJson(payload)
          && canonicalJson(baseBindings(envelope.bindings))
            === canonicalJson(bindings)
        ));
        if (replay) return replay;
        if (
          kind === 'attempt_fact'
          && existing.some((envelope) => (
            envelope.kind === kind
            && canonicalJson(baseBindings(envelope.bindings))
              === canonicalJson(bindings)
          ))
        ) {
          return null;
        }
        return authority.seal(kind, payload, {
          ...bindings,
          log_sequence: existing.length + 1,
          previous_envelope_digest: previousDigest
        });
      }
    );
    if (!result.ok) return result;
    const validated = validate(relativePath, kind);
    if (!validated.ok) return validated;
    return {
      ok: true,
      appended: result.appended,
      envelope: result.value,
      values: validated.value,
      latest_digest: validated.latest_digest,
      blockers: []
    };
  }

  function validateAnchor(anchor, expectedChangeId, logs) {
    const verified = authority.verifyChainAnchor(anchor);
    if (
      verified?.ok !== true
      || verified.anchor.change_id !== expectedChangeId
    ) {
      return {
        ok: false,
        blockers: [blocker(
          'verification-authority-log:anchor-invalid',
          'v2/authority-chain-anchor.json'
        )]
      };
    }
    for (const [name, validation] of Object.entries(logs)) {
      const expected = verified.anchor.logs[name];
      const values = validation?.value || [];
      if (
        !validation?.ok
        || !expected
        || values.length < expected.sequence
      ) {
        return {
          ok: false,
          blockers: [blocker(
            'verification-authority-log:anchor-regressed',
            expected?.path || name
          )]
        };
      }
      if (expected.sequence === 0) {
        if (
          expected.latest_digest !== null
          || expected.terminal_envelope_id !== null
        ) {
          return {
            ok: false,
            blockers: [blocker(
              'verification-authority-log:anchor-invalid',
              expected.path
            )]
          };
        }
        continue;
      }
      const terminal = values[expected.sequence - 1];
      if (
        !terminal
        || envelopeDigest(terminal) !== expected.latest_digest
        || terminal.id !== expected.terminal_envelope_id
      ) {
        return {
          ok: false,
          blockers: [blocker(
            'verification-authority-log:anchor-regressed',
            expected.path
          )]
        };
      }
    }
    return {
      ok: true,
      anchor: verified.anchor,
      blockers: []
    };
  }

  return Object.freeze({
    append,
    logHead,
    validate,
    validateAnchor
  });
}

module.exports = {
  baseBindings,
  createAuthorityLog,
  envelopeDigest,
  logHead
};
