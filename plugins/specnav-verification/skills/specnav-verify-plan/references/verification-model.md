# Verification Model

Read this before creating a verification plan.

SpecNav verification has six required domains in this order:

1. facticity
2. static
3. unit
4. redteam
5. e2e
6. sensory

Before any domain can claim green, verification must pass the user-aligned test
case gate:

1. `verify/user-test-cases.json` defines the user-visible cases under review.
2. `verify/user-test-case-signoff.json` records explicit user approval.
3. `verify/domain-case-matrix.json` maps every approved case to all six domains.

The approved user test cases are the verification object. The six domains are
the lenses used to evaluate those cases. Do not invent additional scope inside a
domain unless it is added back to the user test case contract or recorded as a
new blocker.

Verification also requires executable runtime evidence:

1. `verify/runtime-evidence.json` must include a passing `runtime` surface.
2. `verify/runtime-evidence.json` must include a passing `browser` surface with
   screenshot, trace, transcript, or equivalent artifact refs.
3. If `development/migrations/manifest.json` has `required=true`,
   `verify/runtime-evidence.json` must include a passing `database` surface.
4. `plan.changed_files` must be non-empty and each file must appear in
   `traceability-matrix.json`.

The plan must preserve the user's six-stage model. Do not collapse domains into
one generic test pass.

## Evidence Rule

Every green verdict must cite direct evidence: files, command output, logs,
screenshots, traces, schemas, or manual review notes. Summaries and prior chat
are claims, not proof.

## Blocker Rule

Use blocker classes:

- `tool-unavailable`
- `env-auth`
- `env-runtime`
- `contract-regression`
- `insufficient-evidence`
- `product-ambiguity`
- `scope-drift`
