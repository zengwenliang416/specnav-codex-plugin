'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const kernel = require(path.join(ROOT, 'plugins/specnav-verification'));

const MARKER = '[REDACTED]';

function assertSafe(result, secrets = []) {
  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  for (const secret of secrets) {
    assert.doesNotMatch(JSON.stringify(result), new RegExp(
      secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ));
  }
}

test('public redactor removes exact configured secrets from stdout and stderr', () => {
  const secrets = ['provider-secret-long', 'provider-secret'];
  const redactor = kernel.createSecretRedactor({ secrets });

  const stdout = redactor.redactText(
    'request provider-secret-long then provider-secret',
    { field: 'stdout' }
  );
  const stderr = redactor.redactText(
    'failed with provider-secret-long',
    { field: 'stderr' }
  );

  assertSafe(stdout, secrets);
  assertSafe(stderr, secrets);
  assert.equal(stdout.value, `request ${MARKER} then ${MARKER}`);
  assert.equal(stderr.value, `failed with ${MARKER}`);
  assert.deepEqual(stdout.redaction, {
    status: 'redacted',
    redacted_fields: ['stdout']
  });
  assert.equal(stdout.redaction_count, 2);
});

test('credential-shaped text is redacted even when the value is not configured', () => {
  const redactor = kernel.createSecretRedactor({ secrets: [] });
  const text = [
    'Authorization: Bearer bearer-value',
    'x-api-key: key-value',
    'Cookie: session=session-value; theme=dark',
    'MIDSCENE_MODEL_API_KEY=env-value',
    'https://user:password@example.test/path?api_key=query-value&ok=1'
  ].join('\n');

  const result = redactor.redactText(text, { field: 'command_output' });

  assertSafe(result, [
    'bearer-value',
    'key-value',
    'session-value',
    'env-value',
    'password',
    'query-value'
  ]);
  assert.match(result.value, /Authorization: Bearer \[REDACTED\]/);
  assert.match(result.value, /x-api-key: \[REDACTED\]/);
  assert.match(result.value, /Cookie: \[REDACTED\]/);
  assert.match(result.value, /MIDSCENE_MODEL_API_KEY=\[REDACTED\]/);
  assert.match(result.value, /https:\/\/\[REDACTED\]:\[REDACTED\]@example\.test/);
  assert.match(result.value, /api_key=%5BREDACTED%5D&ok=1/);
  assert.equal(result.redaction.status, 'redacted');
  assert.ok(result.redaction_count >= 6);
});

test('structured provider metadata is cloned, recursively redacted, and path-labeled', () => {
  const secret = 'configured-provider-secret';
  const input = {
    provider: 'openai-compatible',
    apiKey: secret,
    headers: {
      Authorization: 'Bearer generated-bearer',
      'x-client-id': 'diagnostic-client'
    },
    attempts: [
      {
        model: 'ui-model',
        token: 'nested-token',
        message: `provider rejected ${secret}`
      }
    ]
  };
  const before = structuredClone(input);
  const redactor = kernel.createSecretRedactor({ secrets: [secret] });

  const result = redactor.redactValue(input, { field: 'provider_metadata' });

  assertSafe(result, [secret, 'generated-bearer', 'nested-token']);
  assert.deepEqual(input, before);
  assert.notEqual(result.value, input);
  assert.equal(result.value.apiKey, MARKER);
  assert.equal(result.value.headers.Authorization, `Bearer ${MARKER}`);
  assert.equal(result.value.attempts[0].token, MARKER);
  assert.equal(
    result.value.attempts[0].message,
    `provider rejected ${MARKER}`
  );
  assert.deepEqual(result.redaction.redacted_fields, [
    'provider_metadata.apiKey',
    'provider_metadata.attempts[0].message',
    'provider_metadata.attempts[0].token',
    'provider_metadata.headers.Authorization'
  ]);
});

test('Markdown structure remains inspectable while secrets are removed', () => {
  const secret = 'markdown-provider-secret';
  const redactor = kernel.createSecretRedactor({ secrets: [secret] });
  const markdown = [
    '# Provider failure',
    '',
    `- token: \`${secret}\``,
    '- status: 401',
    '',
    '```text',
    `Authorization: Bearer ${secret}`,
    '```'
  ].join('\n');

  const result = redactor.redactText(markdown, { field: 'failure.md' });

  assertSafe(result, [secret]);
  assert.match(result.value, /# Provider failure/);
  assert.match(result.value, /- status: 401/);
  assert.match(result.value, /```text/);
  assert.equal(result.redaction.status, 'redacted');
});

test('JSON text keeps its shape while quoted credential fields are redacted', () => {
  const redactor = kernel.createSecretRedactor({ secrets: [] });
  const source = JSON.stringify({
    api_key: 'json-api-key',
    nested: {
      password: 'json-password',
      status: 401
    }
  });

  const result = redactor.redactText(source, { field: 'provider.json' });

  assertSafe(result, ['json-api-key', 'json-password']);
  assert.deepEqual(JSON.parse(result.value), {
    api_key: MARKER,
    nested: {
      password: MARKER,
      status: 401
    }
  });
});

test('HTML projection redacts first and escapes hostile artifact content', () => {
  const secret = 'html-provider-secret';
  const redactor = kernel.createSecretRedactor({ secrets: [secret] });
  const source = [
    '<script>window.exfiltrate()</script>',
    `<img src=x onerror="send('${secret}')">`,
    `Authorization: Bearer ${secret}`
  ].join('\n');

  const result = kernel.renderSafeHtmlText(redactor, source, {
    field: 'artifact.html'
  });

  assertSafe(result, [secret]);
  assert.doesNotMatch(result.html, /<script|<img/i);
  assert.match(result.html, /&lt;script&gt;window\.exfiltrate\(\)&lt;\/script&gt;/);
  assert.match(result.html, /&lt;img src=x onerror=&quot;send\(&#39;\[REDACTED\]&#39;\)&quot;&gt;/);
  assert.match(result.html, /Authorization: Bearer \[REDACTED\]/);
  assert.equal(result.redaction.status, 'redacted');
});

test('clean text remains not_required but detected credentials never do', () => {
  const redactor = kernel.createSecretRedactor({ secrets: [] });

  const clean = redactor.redactText('status=401 model=ui-model', {
    field: 'stdout'
  });
  const credential = redactor.redactText(
    'Authorization: Bearer runtime-token',
    { field: 'stdout' }
  );

  assert.deepEqual(clean.redaction, {
    status: 'not_required',
    redacted_fields: []
  });
  assert.equal(clean.redaction_count, 0);
  assert.equal(credential.redaction.status, 'redacted');
  assert.equal(credential.redaction_count, 1);
});

test('duplicate and overlapping configured secrets produce deterministic metadata', () => {
  const redactor = kernel.createSecretRedactor({
    secrets: ['secret-long', 'secret', 'secret-long']
  });

  const first = redactor.redactText('secret-long secret', { field: 'stderr' });
  const second = redactor.redactText('secret-long secret', { field: 'stderr' });

  assert.deepEqual(first, second);
  assert.equal(first.value, `${MARKER} ${MARKER}`);
  assert.equal(first.redaction_count, 2);
  assert.deepEqual(first.redaction.redacted_fields, ['stderr']);
});

test('invalid secret configuration fails closed without embedding secret values', () => {
  for (const secrets of [null, {}, [''], ['valid', 42]]) {
    assert.throws(
      () => kernel.createSecretRedactor({ secrets }),
      /verification-redaction:config-invalid/
    );
  }
});

test('configured secrets that overlap the default marker use a safe marker', () => {
  for (const secret of ['RED', 'ACT', '[']) {
    const redactor = kernel.createSecretRedactor({ secrets: [secret] });
    const result = redactor.redactText(`value=${secret}`, {
      field: 'stdout'
    });

    assert.equal(result.ok, true);
    assert.equal(result.redaction.status, 'redacted');
    assert.equal(result.redaction_count, 1);
    assert.doesNotMatch(result.value, new RegExp(
      secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ));
  }
});

test('cyclic, accessor, symbol-keyed, and hostile Proxy values fail closed', () => {
  const redactor = kernel.createSecretRedactor({ secrets: ['known-secret'] });
  const cyclic = {};
  cyclic.self = cyclic;
  let getterCalled = false;
  const accessor = {};
  Object.defineProperty(accessor, 'token', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'known-secret';
    }
  });
  const symbolKeyed = { safe: true };
  symbolKeyed[Symbol('secret')] = 'known-secret';
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error('proxy-ownKeys-failure');
    }
  });

  for (const value of [cyclic, accessor, symbolKeyed, hostile]) {
    const result = redactor.redactValue(value, { field: 'metadata' });
    assert.equal(result.ok, false);
    assert.equal(
      result.blockers[0].id,
      'verification-redaction:value-invalid'
    );
    assert.equal(result.blockers[0].artifact, 'metadata');
    assert.doesNotMatch(JSON.stringify(result), /known-secret/);
  }
  assert.equal(getterCalled, false);
});

test('structured redaction treats __proto__ as data without prototype mutation', () => {
  const input = JSON.parse(
    '{"__proto__":{"polluted":"known-secret"},"token":"nested-token"}'
  );
  const redactor = kernel.createSecretRedactor({ secrets: ['known-secret'] });

  const result = redactor.redactValue(input, { field: 'metadata' });

  assertSafe(result, ['known-secret', 'nested-token']);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(result.value, '__proto__'), true);
  assert.deepEqual(result.value.__proto__, { polluted: MARKER });
  assert.equal(result.value.token, MARKER);
});

test('HTML projection rejects forged or hostile redactor collaborators', () => {
  const fake = {
    redactText() {
      return {
        ok: true,
        value: '<script>unsafe()</script>',
        redaction: {
          status: 'not_required',
          redacted_fields: []
        },
        redaction_count: 0,
        blockers: []
      };
    },
    redactValue() {}
  };

  const result = kernel.renderSafeHtmlText(
    fake,
    'Authorization: Bearer untrusted',
    { field: 'artifact.html' }
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers[0].id,
    'verification-reporting:redaction-boundary-invalid'
  );
});

test('redaction metadata contains paths and counts but no reversible secret material', () => {
  const secret = 'metadata-secret-value';
  const redactor = kernel.createSecretRedactor({ secrets: [secret] });
  const result = redactor.redactText(`failure=${secret}`, {
    field: 'stderr'
  });
  const metadata = JSON.stringify({
    redaction: result.redaction,
    redaction_count: result.redaction_count
  });

  assert.doesNotMatch(metadata, new RegExp(secret));
  assert.doesNotMatch(metadata, /sha|digest|hash|original|replacement/i);
  assert.equal(metadata, JSON.stringify({
    redaction: {
      status: 'redacted',
      redacted_fields: ['stderr']
    },
    redaction_count: 1
  }));
});

test('raw JSON authorization and cookie variants never reach HTML', () => {
  const redactor = kernel.createSecretRedactor({ secrets: [] });
  const source = JSON.stringify({
    authorization: 'Bearer json-auth-secret',
    proxyAuthorization: 'Basic json-proxy-secret',
    cookie: 'session=json-cookie-secret',
    setCookie: 'session=json-set-cookie-secret'
  });

  const text = redactor.redactText(source, { field: 'provider.json' });
  const html = kernel.renderSafeHtmlText(redactor, source, {
    field: 'provider.json'
  });

  assertSafe(text, [
    'json-auth-secret',
    'json-proxy-secret',
    'json-cookie-secret',
    'json-set-cookie-secret'
  ]);
  assertSafe(html, [
    'json-auth-secret',
    'json-proxy-secret',
    'json-cookie-secret',
    'json-set-cookie-secret'
  ]);
  assert.equal(text.redaction.status, 'redacted');
  assert.equal(html.redaction.status, 'redacted');
});

test('authorization schemes redact credentials without a scheme allowlist', () => {
  const redactor = kernel.createSecretRedactor({ secrets: [] });
  const source = [
    'Authorization: Digest username="u", response="digest-secret"',
    'Authorization: ApiKey api-key-secret',
    'Proxy-Authorization=Custom proxy-secret'
  ].join('\n');

  const result = redactor.redactText(source, { field: 'headers' });

  assertSafe(result, ['digest-secret', 'api-key-secret', 'proxy-secret']);
  assert.match(result.value, /Authorization: Digest \[REDACTED\]/);
  assert.match(result.value, /Authorization: ApiKey \[REDACTED\]/);
  assert.match(result.value, /Proxy-Authorization=Custom \[REDACTED\]/);
});

test('lowercase environment values, CLI flags, and prefixed keys are redacted', () => {
  const redactor = kernel.createSecretRedactor({ secrets: [] });
  const source = [
    'midscene_model_api_key=lower-secret',
    'OPENAI_API_KEY: colon-secret',
    'tool --api-key cli-secret --token=cli-token --model ui',
    'https://provider.test/run?openai_api_key=query-prefixed-secret&ok=1'
  ].join('\n');

  const result = redactor.redactText(source, { field: 'command_output' });

  assertSafe(result, [
    'lower-secret',
    'colon-secret',
    'cli-secret',
    'cli-token',
    'query-prefixed-secret'
  ]);
  assert.match(result.value, /midscene_model_api_key=\[REDACTED\]/);
  assert.match(result.value, /OPENAI_API_KEY: \[REDACTED\]/);
  assert.match(result.value, /--api-key \[REDACTED\]/);
  assert.match(result.value, /--token=\[REDACTED\]/);
  assert.match(result.value, /--model ui/);
  assert.match(
    result.value,
    /openai_api_key=%5BREDACTED%5D&ok=1/
  );
});

test('configured secrets in URL query values use the encoded redaction marker', () => {
  const secret = 'query-prefixed-secret';
  const redactor = kernel.createSecretRedactor({ secrets: [secret] });
  const result = redactor.redactText(
    `https://provider.test/run?openai_api_key=${secret}&ok=1`,
    { field: 'command_output' }
  );

  assertSafe(result, [secret]);
  assert.match(
    result.value,
    /openai_api_key=%5BREDACTED%5D&ok=1/
  );
});

test('configured encoded marker text in URL query values is normalized safely', () => {
  const encodedMarker = encodeURIComponent(MARKER);
  const redactor = kernel.createSecretRedactor({ secrets: [encodedMarker] });
  const result = redactor.redactText(
    `https://provider.test/run?api_key=${encodedMarker}&ok=1`,
    { field: 'command_output' }
  );

  assert.equal(
    result.value,
    `https://provider.test/run?api_key=${encodedMarker}&ok=1`
  );
  assert.equal(result.redaction.status, 'redacted');
});

test('structured sensitive keys are normalized across naming conventions', () => {
  const input = {
    proxyAuthorization: 'Basic camel-auth-secret',
    setCookie: 'session=camel-cookie-secret',
    xApiKey: 'camel-api-secret',
    apiToken: 'camel-token-secret',
    sessionCookie: 'session=camel-session-secret',
    privateKey: 'camel-private-secret',
    aws_secret_access_key: 'camel-aws-secret'
  };
  const redactor = kernel.createSecretRedactor({ secrets: [] });

  const result = redactor.redactValue(input, { field: 'provider_metadata' });

  assertSafe(result, [
    'camel-auth-secret',
    'camel-cookie-secret',
    'camel-api-secret',
    'camel-token-secret',
    'camel-session-secret',
    'camel-private-secret',
    'camel-aws-secret'
  ]);
  assert.equal(result.value.proxyAuthorization, `Basic ${MARKER}`);
  assert.equal(result.value.setCookie, MARKER);
  assert.equal(result.value.xApiKey, MARKER);
  assert.equal(result.value.apiToken, MARKER);
  assert.equal(result.value.sessionCookie, MARKER);
  assert.equal(result.value.privateKey, MARKER);
  assert.equal(result.value.aws_secret_access_key, MARKER);
});

test('caller field labels and object keys cannot smuggle configured secrets', () => {
  const secret = 'metadata-path-secret';
  const redactor = kernel.createSecretRedactor({ secrets: [secret] });
  const keyed = {};
  keyed[secret] = 'diagnostic';

  const fieldResult = redactor.redactText(secret, { field: secret });
  const keyResult = redactor.redactValue(keyed, { field: 'metadata' });

  for (const result of [fieldResult, keyResult]) {
    assert.equal(result.ok, false);
    assert.equal(
      result.blockers[0].id,
      'verification-redaction:value-invalid'
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  }
});
