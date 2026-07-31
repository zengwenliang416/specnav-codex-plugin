'use strict';

const registerSuites = [
  require('./cross-reference/baseline.suite'),
  require('./cross-reference/identity-bindings.suite'),
  require('./cross-reference/artifact-bindings.suite'),
  require('./cross-reference/fail-closed.suite'),
  require('./cross-reference/retry.suite'),
  require('./cross-reference/schema-and-immutability.suite'),
  require('./cross-reference/reference-utils.suite')
];

for (const registerSuite of registerSuites) {
  registerSuite();
}
