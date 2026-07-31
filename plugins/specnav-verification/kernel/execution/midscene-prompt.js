'use strict';

const crypto = require('node:crypto');

function serializeMidscenePrompt(prompt) {
  if (
    typeof prompt !== 'string'
    || prompt.trim() === ''
    || prompt.length > 65536
    || /[\u0000]/.test(prompt)
  ) {
    return {
      value: null,
      hash: null,
      blocker: {
        id: 'verification-execution:midscene-prompt-invalid',
        artifact: 'prompt',
        detail: null
      }
    };
  }
  return {
    value: prompt,
    hash: crypto.createHash('sha256').update(prompt).digest('hex'),
    blocker: null
  };
}

module.exports = {
  serializeMidscenePrompt
};
