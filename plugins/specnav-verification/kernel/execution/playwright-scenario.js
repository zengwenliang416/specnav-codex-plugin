'use strict';

const crypto = require('node:crypto');
const vm = require('node:vm');

function scenarioHash(source) {
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function serializePlaywrightScenario(scenario) {
  if (typeof scenario !== 'function') {
    return {
      blocker: {
        id: 'verification-execution:playwright-scenario-required',
        artifact: 'scenario'
      }
    };
  }
  const source = Function.prototype.toString.call(scenario);
  try {
    const compiled = new vm.Script(`(${source})`, {
      filename: 'approved-playwright-scenario.js'
    }).runInNewContext({}, {
      timeout: 1000,
      contextCodeGeneration: {
        strings: false,
        wasm: false
      }
    });
    if (typeof compiled !== 'function') throw new Error('not a function');
  } catch (error) {
    return {
      blocker: {
        id: 'verification-execution:playwright-scenario-invalid',
        artifact: 'scenario',
        detail: error instanceof Error ? error.message : String(error)
      }
    };
  }
  return {
    blocker: null,
    hash: scenarioHash(source),
    source
  };
}

module.exports = {
  scenarioHash,
  serializePlaywrightScenario
};
