# Independent Quality And Security Review: 023-report-model

## Verdict

NOT_APPROVED

## Blockers

1. The Evidence Index can carry a foreign `change_id` or forged `source_raw`
   while preserving otherwise valid entries and still produce a green model.
2. Gate recomputation trusts caller-provided `stage` and `policy_version`, so a
   caller can replace a release gate with an archive gate and make lifecycle
   status appear archived.
3. Report projections copy runner `entrypoint`, `args`, and `cwd` without a
   trusted redaction boundary, exposing inline credentials and sensitive paths.

## Required Fixes

- Bind the Evidence Index and verifier receipt to the exact change, canonical
  raw artifact, source digest, entries digest, index version, record count, and
  entry ids.
- Resolve gate stage and policy version through an independent authority
  collaborator.
- Require a trusted `SecretRedactor` and redact both catalog runner metadata
  and per-case command projections.
- Add adversarial tests for foreign indexes, forged source paths, forged archive
  gates, credential-shaped arguments, and sensitive working directories.

## Evidence

- Existing focused tests passed 11/11 and the focused runner passed 21/21.
- Independent read-only reproductions still produced a green foreign-index
  model, a green archived lifecycle, and a report containing a CLI secret.
