'use strict';

const crypto = require('node:crypto');
const { serviceContracts } = require('./contracts');

const name = '@specnav/verification-kernel';
const version = '2.0.0-alpha.2';
const apiVersion = 'specnav.verification.kernel.v1';
const contractVersion = 2;
const contractDigest = crypto
  .createHash('sha256')
  .update(JSON.stringify({
    name,
    version,
    apiVersion,
    contractVersion,
    serviceContracts
  }))
  .digest('hex');

const metadata = Object.freeze({
  name,
  version,
  apiVersion,
  contractVersion,
  contractDigest
});

module.exports = metadata;
