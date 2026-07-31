'use strict';

function freezeContract(methods) {
  return Object.freeze({ methods: Object.freeze([...methods]) });
}

const serviceContracts = Object.freeze({
  commandRunner: freezeContract(['execute']),
  playwrightRunner: freezeContract(['execute']),
  midsceneRunner: freezeContract(['interact']),
  evidenceStore: freezeContract(['append', 'rebuildIndex']),
  failureClassifier: freezeContract(['classify']),
  reportRenderer: freezeContract(['render'])
});

function createServices(adapters) {
  if (!adapters || typeof adapters !== 'object' || Array.isArray(adapters)) {
    throw new TypeError('verification-kernel:invalid-services');
  }

  const services = {};
  for (const [name, contract] of Object.entries(serviceContracts)) {
    const service = adapters[name];
    if (!service) {
      throw new Error(`verification-kernel:missing-service:${name}`);
    }
    if (typeof service !== 'object' && typeof service !== 'function') {
      throw new TypeError(`verification-kernel:invalid-service:${name}`);
    }
    for (const method of contract.methods) {
      if (typeof service[method] !== 'function') {
        throw new TypeError(`verification-kernel:missing-method:${name}:${method}`);
      }
    }
    services[name] = service;
  }

  return Object.freeze(services);
}

module.exports = {
  createServices,
  serviceContracts
};
