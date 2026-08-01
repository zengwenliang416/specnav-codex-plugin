'use strict';

const {
  createOracleRegistry
} = require('./oracle-registry');
const {
  createNotApplicableDecisionValidator
} = require('./not-applicable-validator');
const {
  createReadingEvaluator
} = require('./reading-evaluator');
const {
  createSixDomainAggregator
} = require('./six-domain-aggregator');
const {
  SIX_DOMAINS,
  TERMINAL_PRECEDENCE,
  TERMINAL_STATES
} = require('./terminal-state');

module.exports = {
  SIX_DOMAINS,
  TERMINAL_PRECEDENCE,
  TERMINAL_STATES,
  createNotApplicableDecisionValidator,
  createOracleRegistry,
  createReadingEvaluator,
  createSixDomainAggregator
};
