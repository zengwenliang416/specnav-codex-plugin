'use strict';

function fail(id, artifact, detail = null) {
  const error = new Error(id);
  error.artifact = artifact;
  error.detail = detail;
  throw error;
}

function validateHostProofPointerChain(options) {
  const {
    changeId,
    pointer,
    pointerPath,
    readPointer,
    sha256,
    validatePointer
  } = options;
  const seen = new Set();
  let current = pointer;
  let currentPath = pointerPath;

  while (true) {
    if (
      current.change_id !== changeId
      || !Number.isInteger(current.generation)
      || current.generation < 1
    ) {
      fail(
        'verification-release:host-proof-pointer-chain-binding-mismatch',
        currentPath
      );
    }
    if (current.generation === 1) {
      if (current.previous_pointer !== null) {
        fail(
          'verification-release:host-proof-pointer-generation-invalid',
          currentPath
        );
      }
      return true;
    }
    const previous = current.previous_pointer;
    if (
      !previous
      || typeof previous.path !== 'string'
      || !/^[a-f0-9]{64}$/.test(previous.sha256 || '')
      || seen.has(previous.path)
    ) {
      fail(
        'verification-release:host-proof-pointer-generation-invalid',
        currentPath
      );
    }
    seen.add(previous.path);
    const read = readPointer(previous.path);
    if (!read?.bytes || sha256(read.bytes) !== previous.sha256) {
      fail(
        'verification-release:host-proof-pointer-predecessor-hash-mismatch',
        previous.path
      );
    }
    const predecessor = validatePointer(read.value, previous.path);
    const expectedPath = (
      `operations/host-proof-runs/${predecessor.run_id}/`
      + 'host-proof-pointer.json'
    );
    if (
      previous.path !== expectedPath
      || predecessor.change_id !== current.change_id
      || predecessor.generation !== current.generation - 1
    ) {
      fail(
        'verification-release:host-proof-pointer-chain-binding-mismatch',
        previous.path,
        {
          expected_generation: current.generation - 1,
          actual_generation: predecessor.generation,
          expected_path: expectedPath,
          actual_path: previous.path
        }
      );
    }
    current = predecessor;
    currentPath = previous.path;
  }
}

module.exports = {
  validateHostProofPointerChain
};
