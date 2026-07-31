'use strict';

const { deepFreeze } = require('../contracts/schema-registry');

function createEventSequence(options = {}) {
  const clock = options.clock;
  const onEvent = typeof options.onEvent === 'function'
    ? options.onEvent
    : () => {};
  const events = [];

  function emit(type, payload = {}) {
    const event = deepFreeze({
      sequence: events.length + 1,
      type,
      at: clock.now(),
      ...structuredClone(payload)
    });
    events.push(event);
    onEvent(event);
    return event;
  }

  function values() {
    return [...events];
  }

  return Object.freeze({
    emit,
    values
  });
}

module.exports = {
  createEventSequence
};
