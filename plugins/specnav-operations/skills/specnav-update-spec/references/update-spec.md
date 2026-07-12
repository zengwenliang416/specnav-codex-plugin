# Update Spec

Read this before writing `operations/update-spec.json`.

Classify operational learning as:

- `no_writeback_needed`;
- `written_back`;
- `deferred`.

Unresolved learning blocks archive unless explicitly signed off.

## Promoted checks (Act -> reusable capability)

Prose writeback records *what was learned*. A **promoted check** goes one step
further: it turns a resolved bad case into a *reusable deterministic check* so the
next occurrence is caught automatically instead of re-investigated. This is
optional — omit `promoted_checks` entirely when a case yields no reusable check.

Each entry in `promoted_checks[]`:

- `id` — stable kebab-case identifier.
- `statement` — the rule, **generalized**. Prune one-off specifics: replace a
  concrete UID / order id / session id with the business variable it stands for.
  A statement that still names a one-off token is not promotable.
- `verify_via` — `guard` | `fixture` | `static`.
- `candidate_artifact` — path to the check or fixture the statement maps to.
- `generalized` — boolean; must be `true` before admission.
- `status` — lifecycle:
  - `candidate` — distilled, advisory only, **never blocks archive**.
  - `admitted` — passed a dry-run and human signoff; may become an enforced
    guard rule. Requires `dry_run_ref` + `generalized: true` + signoff.
  - `declined` — evaluated and rejected; kept for the record.
- `dry_run_ref` — path to the `operations/promotion/<id>/dry-run.json` produced by
  `promotion-dry-run.js`.
- `evidence_ref` — postmortem or bad-case reference the check came from.

Admission is a deliberate opt-in (mirrors the prototype `may_promote` rule). A
candidate never gates anything; only an admitted check, once written to
`openspec/knowledge/promoted-checks/`, can be enforced by the guard — and only
when the project opts into enforcement.
