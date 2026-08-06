# Verification Kernel Packaging

## Ownership

`plugins/specnav-verification` is the canonical package root for the
host-neutral Verification Kernel. Its public package name is
`@specnav/verification-kernel`, and the first contract version is
`2.0.0-alpha.2`.

Host integrations consume the package through its root export:

```js
const kernel = require('@specnav/verification-kernel');
```

They must not import files below `kernel/` directly.

## Public Contract

The root export contains:

- `metadata`: immutable package, API, contract version, and contract digest;
- `serviceContracts`: immutable method requirements for external services;
- `createServices(adapters)`: fail-fast adapter validation with no fallback.

The initial boundary defines explicit contracts for command execution,
browser execution, AI-assisted interaction, evidence storage, failure
classification, and report rendering. Their implementations are owned by
later Verification 2.0 tasks.

## Version And Drift Evidence

Every host installation and generated gate artifact must record:

```json
{
  "kernel_version": "2.0.0-alpha.2",
  "kernel_api_version": "specnav.verification.kernel.v1",
  "kernel_contract_digest": "<sha256>"
}
```

The digest is computed from the public version metadata and service contract
shape. A different version or digest is cross-host drift and must block
release once drift enforcement is enabled.

## Dependency Rules

- Kernel modules do not read host globals, manifests, prompts, or environment
  variables.
- Host adapters may resolve configuration and invoke the public package, but
  they may not redefine schema, blocker, freshness, aggregation, or gate
  semantics.
- Missing services and methods return exact errors. No service is inferred,
  substituted, or silently disabled.
- The package does not install Playwright, browsers, Midscene, or AJV. Managed
  runtime installation belongs to the explicit runtime tasks.

## Task Boundary

This package-boundary task intentionally does not implement:

- JSON Schema validation;
- execution adapters;
- EvidenceStore behavior;
- readings or aggregation;
- failure repair state;
- report models or HTML rendering;
- host discovery or installation.

Those capabilities are layered onto this public boundary by later tasks and
must preserve the same package identity.
