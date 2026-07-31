'use strict';

const crypto = require('node:crypto');

const PROVIDER_KEYS = Object.freeze([
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_FAMILY',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_INIT_CONFIG_JSON',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'MIDSCENE_OPENAI_INIT_CONFIG_JSON'
]);

const SECRET_KEYS = new Set([
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_INIT_CONFIG_JSON',
  'OPENAI_API_KEY',
  'MIDSCENE_OPENAI_INIT_CONFIG_JSON'
]);

function selectProviderEnvironment(source) {
  const output = {};
  for (const name of PROVIDER_KEYS) {
    try {
      if (typeof source?.[name] === 'string' && source[name].trim() !== '') {
        output[name] = source[name];
      }
    } catch {
      return null;
    }
  }
  return output;
}

function providerMetadata(environment) {
  const credentialSource = [
    'MIDSCENE_MODEL_API_KEY',
    'MIDSCENE_MODEL_INIT_CONFIG_JSON',
    'OPENAI_API_KEY',
    'MIDSCENE_OPENAI_INIT_CONFIG_JSON'
  ].find((name) => typeof environment?.[name] === 'string') || null;
  const baseUrl = environment?.MIDSCENE_MODEL_BASE_URL
    || environment?.OPENAI_BASE_URL
    || null;
  return {
    name: environment?.MIDSCENE_MODEL_NAME || null,
    family: environment?.MIDSCENE_MODEL_FAMILY || null,
    base_url: baseUrl,
    credential_source: credentialSource,
    secret_values_exposed: false
  };
}

function providerConfigurationFingerprint(environment) {
  const metadata = providerMetadata(environment);
  if (
    !metadata.name
    || !metadata.credential_source
    || !metadata.base_url
    || (
      !metadata.family
      && ![
        'OPENAI_API_KEY',
        'MIDSCENE_OPENAI_INIT_CONFIG_JSON'
      ].includes(metadata.credential_source)
    )
  ) {
    return null;
  }
  let normalizedBaseUrl;
  try {
    const parsed = new URL(metadata.base_url);
    if (
      parsed.protocol !== 'https:'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.hash !== ''
    ) {
      return null;
    }
    normalizedBaseUrl = parsed.toString();
  } catch {
    return null;
  }
  return crypto.createHash('sha256').update(JSON.stringify({
    schema: 'specnav.verification.provider-configuration.v1',
    name: metadata.name,
    family: metadata.family,
    base_url: normalizedBaseUrl,
    credential_source: metadata.credential_source
  })).digest('hex');
}

function probeProvider(source = {}) {
  const environment = selectProviderEnvironment(source);
  const metadata = environment ? providerMetadata(environment) : {};
  const fingerprint = environment
    ? providerConfigurationFingerprint(environment)
    : null;
  return {
    configured: fingerprint !== null,
    model_name_present: typeof metadata.name === 'string',
    model_family_present: typeof metadata.family === 'string',
    credential_source: metadata.credential_source || null,
    base_url_present: typeof metadata.base_url === 'string',
    configuration_fingerprint: fingerprint,
    secret_values_exposed: false
  };
}

function configuredSecrets(environment) {
  return Object.entries(environment || {})
    .filter(([name]) => SECRET_KEYS.has(name))
    .map(([, value]) => value);
}

module.exports = {
  PROVIDER_KEYS,
  configuredSecrets,
  probeProvider,
  providerConfigurationFingerprint,
  providerMetadata,
  selectProviderEnvironment
};
