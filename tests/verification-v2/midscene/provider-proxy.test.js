'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');

const {
  ROOT
} = require('./test-helpers');
const {
  createRestrictedConnectProxy,
  parseConnectTarget,
  sandboxProviderNetworkRule
} = require(
  `${ROOT}/plugins/specnav-verification/kernel/execution/playwright-worker`
);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function connectRequest(proxyUrl, authority, payload = null) {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port), proxy.hostname);
    let response = Buffer.alloc(0);
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write([
        `CONNECT ${authority} HTTP/1.1`,
        `Host: ${authority}`,
        '',
        ''
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (
        payload
        && response.includes(Buffer.from('\r\n\r\n'))
        && !response.includes(Buffer.from(payload))
      ) {
        socket.write(payload);
        return;
      }
      if (
        response.includes(Buffer.from('403 Forbidden'))
        || (payload && response.includes(Buffer.from(payload)))
      ) {
        socket.end();
      }
    });
    socket.once('close', () => resolve(response.toString('utf8')));
  });
}

test('provider sandbox rule permits only an explicit loopback relay', () => {
  assert.equal(
    sandboxProviderNetworkRule('http://127.0.0.1:48123'),
    '(allow network-outbound (remote tcp "localhost:48123"))'
  );
  assert.throws(
    () => sandboxProviderNetworkRule('https://provider.example/v1'),
    /explicit loopback HTTP/
  );
  assert.deepEqual(parseConnectTarget('provider.example:443'), {
    hostname: 'provider.example',
    port: '443'
  });
  assert.equal(parseConnectTarget('provider.example'), null);
});

test('restricted relay tunnels only the approved provider authority', async () => {
  const upstream = net.createServer((socket) => socket.pipe(socket));
  const address = await listen(upstream);
  const authority = `127.0.0.1:${address.port}`;
  const proxy = await createRestrictedConnectProxy(
    `https://${authority}/v1`
  );

  try {
    const allowed = await connectRequest(proxy.url, authority, 'proof');
    assert.match(allowed, /200 Connection Established/);
    assert.match(allowed, /proof/);

    const denied = await connectRequest(proxy.url, 'example.com:443');
    assert.match(denied, /403 Forbidden/);
  } finally {
    await proxy.close();
    await closeServer(upstream);
  }
});
