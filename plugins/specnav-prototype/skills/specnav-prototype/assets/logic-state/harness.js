'use strict';

const states = ['idle', 'loading', 'ready', 'empty', 'error', 'permission'];

function transition(state, event) {
  if (!states.includes(state)) throw new Error(`Unknown state: ${state}`);
  if (event === 'request') return 'loading';
  if (event === 'success') return 'ready';
  if (event === 'empty') return 'empty';
  if (event === 'fail') return 'error';
  if (event === 'deny') return 'permission';
  if (event === 'reset') return 'idle';
  throw new Error(`Unknown event: ${event}`);
}

module.exports = { states, transition };

if (require.main === module) {
  const flow = ['request', 'success', 'reset', 'request', 'fail'];
  let state = 'idle';
  for (const event of flow) {
    state = transition(state, event);
    process.stdout.write(`${event} -> ${state}\n`);
  }
}
