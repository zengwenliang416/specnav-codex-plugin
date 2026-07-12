# Promote Check (Act -> reusable capability)

Read before distilling a promoted check.

## The idea

A postmortem records what was learned. A promoted check turns that learning into
a deterministic rule so the failure cannot silently recur. This mirrors the
article's "prune the trajectory, admit via dry-run, settle into the Highway"
loop — but stays inside SpecNav's governance: a promoted check is advisory until
a human admits it, and enforced only when the project opts into gating.

## Distilling: prune to a business variable

The rule must not name a one-off. Replace concrete identifiers with the variable
they represent:

- Bad: "order 8842190 double-charged when coupon applied"
- Good: "coupon application must be idempotent across retries for any order"

`promotion-dry-run.js` lints the statement and `deny_globs` for one-off tokens
(long hex, UUIDs, long digit runs, `uid=`/`order_id:` shapes). A placeholder like
`<order-id>` or `{orderId}` is accepted as already-generalized.

## Rule shape

`openspec/knowledge/promoted-checks/<id>.json` (schema
`specnav.knowledge.promotedCheck.v1`):

- `verify_via` — `guard` | `fixture` | `static`.
- `enforcement` — `advisory` (default) or `gate` (opt-in enforcement).
- `deny_globs` — path globs the rule protects. Under `gate`, an edit to a
  matching file is denied by the guard with `promoted-check:<id>` unless the
  standard override is present.
- `reason` — the postmortem-derived rationale.

## Lifecycle

`candidate` (advisory, never gates) -> dry-run passes + generalized + human
signoff -> `admitted`. Only admitted rules under `enforcement: gate` are enforced.
`declined` keeps a rejected check for the record. Admission is deliberate — never
automatic — matching the prototype `may_promote` rule.
