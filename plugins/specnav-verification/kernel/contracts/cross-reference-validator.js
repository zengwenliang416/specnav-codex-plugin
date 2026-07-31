'use strict';

const {
  createBlockerCollector,
  createEntityLookup,
  graphShapeBlocker
} = require('./reference-utils');
const {
  createRetryIdentityValidator
} = require('./retry-identity-validator');
const {
  addActiveChangeBindings,
  addRunBindings
} = require('./graph-binding-validator');
const {
  addCaseInternalBindings
} = require('./case-internal-validator');
const {
  addAttemptBindings,
  addRetryBindings
} = require('./attempt-binding-validator');
const {
  addArtifactBindings
} = require('./artifact-binding-validator');

const GRAPH_ARRAY_FIELDS = Object.freeze([
  'attempts',
  'readings',
  'evidence'
]);

function validateGraphShape(graph) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    return {
      ok: false,
      blockers: [
        graphShapeBlocker(
          '/',
          'verification graph object',
          Array.isArray(graph) ? 'array' : typeof graph
        )
      ]
    };
  }

  const collector = createBlockerCollector();
  if (
    typeof graph.activeChangeId !== 'string'
    || graph.activeChangeId.length === 0
  ) {
    collector.add(graphShapeBlocker(
      '/activeChangeId',
      'non-empty active change id',
      graph.activeChangeId,
      graph.activeChangeId
    ));
  }
  for (const field of GRAPH_ARRAY_FIELDS) {
    if (Array.isArray(graph[field])) continue;
    collector.add(graphShapeBlocker(
      `/${field}`,
      'array',
      graph[field] === null ? 'null' : typeof graph[field],
      graph.activeChangeId
    ));
  }
  return collector.result();
}

function validateEntities(schemaRegistry, graph) {
  const values = {
    caseSnapshot: null,
    run: null,
    attempts: [],
    readings: [],
    evidence: []
  };
  const groups = [
    ['case-snapshot', [graph.caseSnapshot], 'caseSnapshot'],
    ['verification-run', [graph.run], 'run'],
    ['attempt', graph.attempts, 'attempts'],
    ['reading', graph.readings, 'readings'],
    ['evidence', graph.evidence, 'evidence']
  ];

  for (const [entityType, entities, target] of groups) {
    for (const value of entities) {
      const schemaResult = schemaRegistry.validate(entityType, value);
      if (!schemaResult.ok) {
        return {
          ok: false,
          blockers: schemaResult.blockers
        };
      }
      if (target === 'caseSnapshot' || target === 'run') {
        values[target] = schemaResult.value;
      } else {
        values[target].push(schemaResult.value);
      }
    }
  }

  return {
    ok: true,
    value: Object.freeze({
      activeChangeId: graph.activeChangeId,
      ...values
    })
  };
}

function validateReferenceGraph(graph) {
  const collector = createBlockerCollector();
  const caseLookup = createEntityLookup(
    graph.caseSnapshot.cases,
    'test-case',
    collector
  );
  const attemptLookup = createEntityLookup(
    graph.attempts,
    'attempt',
    collector
  );
  createEntityLookup(graph.readings, 'reading', collector);
  const evidenceLookup = createEntityLookup(
    graph.evidence,
    'evidence',
    collector
  );
  const lookupResult = collector.result();
  if (!lookupResult.ok) return lookupResult;

  addActiveChangeBindings(graph, collector);
  addRunBindings(graph, caseLookup, collector);
  addCaseInternalBindings(graph, collector);
  addAttemptBindings(graph, caseLookup, collector);
  addArtifactBindings(
    graph,
    caseLookup,
    attemptLookup,
    evidenceLookup,
    collector
  );
  addRetryBindings(graph, attemptLookup, collector);
  return collector.result();
}

function createCrossReferenceValidator(options = {}) {
  const { schemaRegistry } = options;
  if (!schemaRegistry || typeof schemaRegistry.validate !== 'function') {
    throw new Error('verification-contract:schema-registry-required');
  }

  const validateRetryIdentity = createRetryIdentityValidator({
    schemaRegistry
  });

  function validateCrossReferences(graph) {
    const shapeResult = validateGraphShape(graph);
    if (!shapeResult.ok) return shapeResult;

    const schemaResult = validateEntities(schemaRegistry, graph);
    if (!schemaResult.ok) return schemaResult;

    return validateReferenceGraph(schemaResult.value);
  }

  return Object.freeze({
    validateCrossReferences,
    validateRetryIdentity
  });
}

module.exports = {
  createCrossReferenceValidator
};
