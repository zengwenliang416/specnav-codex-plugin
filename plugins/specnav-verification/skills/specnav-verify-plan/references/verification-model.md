# Verification Model

Read this before creating a verification plan.

SpecNav verification has six required domains in this order:

1. facticity
2. static
3. unit
4. redteam
5. e2e
6. sensory

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
