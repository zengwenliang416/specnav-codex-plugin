'use strict';

const flow = [
  'ui:event',
  'client:state',
  'api:request',
  'server:validate',
  'database:effect',
  'api:response',
  'ui:render'
];

process.stdout.write(`${JSON.stringify({ flow }, null, 2)}\n`);
