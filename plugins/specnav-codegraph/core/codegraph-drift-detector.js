#!/usr/bin/env node
'use strict';

function detectDrift(status, evidenceIndex = null) {
  const drift = [];
  if (status && status.index) {
    if (status.index.reindexRecommended) {
      drift.push({ type: 'stale-index', severity: 'blocking', message: 'CodeGraph recommends reindexing.' });
    }
    if (status.index.worktreeMismatch) {
      drift.push({ type: 'wrong-root', severity: 'blocking', message: 'CodeGraph project root does not match SpecNav project root.' });
    }
  }
  if (evidenceIndex && Array.isArray(evidenceIndex.blockers)) {
    for (const blocker of evidenceIndex.blockers) {
      drift.push({ type: 'evidence-blocker', severity: 'blocking', message: blocker });
    }
  }
  return {
    schema: 'specnav.codegraph.drift.v1',
    active_change: status && status.active_change || null,
    drift,
    blockers: Array.from(new Set(drift.filter((item) => item.severity === 'blocking').map((item) => `codegraph:${item.type}`)))
  };
}

module.exports = {
  detectDrift
};
