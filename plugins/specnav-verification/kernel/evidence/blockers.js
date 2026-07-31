'use strict';

function evidenceBlocker(id, artifact = 'evidence', detail = null) {
  return Object.freeze({ id, artifact, detail });
}

function blocked(id, artifact = 'evidence', detail = null, extra = {}) {
  return Object.freeze({
    ok: false,
    blockers: Object.freeze([evidenceBlocker(id, artifact, detail)]),
    ...extra
  });
}

module.exports = {
  evidenceBlocker,
  blocked
};
