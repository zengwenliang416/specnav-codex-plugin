# Quality Review Evidence: 023-report-model

## Verdict

not approved

## Blocking Findings

- Malformed freshness can be silently projected to the report generation
  timestamp and still produce a green report when the authority and candidate
  gate agree with the malformed source. Freshness must be structurally and
  semantically validated before projection; invalid timestamps must block.
- The report-model schema accepts evidence paths and href values that the
  runtime resolver rejects, including encoded traversal and URI schemes. The
  schema must independently enforce the controlled evidence-path contract.

## Verified Strengths

- The Evidence Index authority reads and hashes authoritative `raw.jsonl`
  bytes.
- Branded evidence and fact authorities cannot be replaced by ordinary caller
  objects.
- Duplicate evidence, caller-authored green state, separated CLI secrets,
  path resolution, RFC3339 offset ordering, and immutability tests pass.

## Required Fixes

- Add fail-closed freshness validation and preserve exact blocker evidence.
- Add schema-level evidence `path` and `href` patterns matching the runtime
  resolver.
- Add regression tests for both defects and rerun focused and full suites.
