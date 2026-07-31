# Prototype Handoff: verification-2-0

## Approved Branch Variant

- Branch: `ui-html`.
- Variant: approved three-page Verification 2.0 report workspace; runtime
  verification is green and the user explicitly requested development task
  planning from this design.

## Screens Or Flows

- Verification overview for aggregate verdict, six-domain state, blockers,
  evidence integrity, freshness, and repair-loop readiness.
- Test case catalog for approved cases, assertions, six-domain mapping, runner,
  and evidence policy.
- Test case results for runs, attempts, readings, evidence, failure
  classification, repair, retest, and regression.
- Flows represented: `FLOW-VERIFY-PLAN`, `FLOW-CASE-APPROVAL`,
  `FLOW-VERIFY-RUN`, `FLOW-EVIDENCE-INGEST`, `FLOW-FAILURE-REPAIR`,
  `FLOW-RETEST-REGRESSION`, `FLOW-REPORT`, and `FLOW-RELEASE-GATE`.

## Components To Create

- Shared report shell and navigation.
- Aggregate verdict band and metrics.
- Six-domain status table.
- Case catalog table and domain coverage markers.
- Case result detail, attempt timeline, reading comparison, and evidence viewer.
- Blocker panel, integrity badge, freshness badge, and repair-loop timeline.
- Loading, empty, error, disabled, permission, green, red, blocked, flaky, and
  pass-after-fix states.

## Components To Reuse

- Foundation UI tokens and warm editorial report direction.
- Existing six-domain names and domain rubrics.
- Existing aggregate report artifact vocabulary.
- Existing SpecNav active change, run, evidence, and blocker identifiers.

## Extraction Targets

- One report model shared by all pages.
- Shared status badge, integrity/freshness badge, blocker list, table, attempt,
  evidence, and navigation components.
- Shared responsive and print layout.
- Shared HTML escaping and artifact-link resolution utilities.

## API Contracts

- `verification aggregate` produces the validated report model.
- `verification report` renders all three pages from the same model.
- `verification gate` reads JSON/JSONL source artifacts and never trusts HTML.
- Report filters affect presentation only and do not mutate verification state.

## Data Flows

- Validated case/run/evidence/failure/gate artifacts feed the report model.
- The report model feeds overview, catalog, and result renderers.
- Evidence ids resolve through the EvidenceStore index to existing files.
- Rerun and repair append new attempts; they do not replace prior report facts.

## State Behavior

- Loading: show that verified case readings and the evidence index are loading.
- Empty: show that no approved cases exist and execution is blocked.
- Error: show exact report-model or evidence-integrity blocker ids.
- Disabled: explain that Verification 2.0 cannot be disabled or simplified.
- Permission: require reviewer approval when the case snapshot changes.
- Populated: show green, red, blocked, flaky, or pass-after-fix facts with
  preserved history.

## Theme And Locale Policy

- Theme support: `light-only`.
- Theme modes shown in prototype: `light`.
- Theme toggle: intentionally omitted.
- Internationalization: disabled at runtime.
- Locales shown in prototype: `none`.
- Default locale: `none`.
- Locale switcher: intentionally omitted.

## Out Of Scope Items

- Production renderer, runtime installer, runner adapters, real evidence, and
  release actions.
- Dark mode and runtime locale switching.
- Editing source verification artifacts from the report.

## Required Tests

- Desktop, mobile, keyboard, semantic table, and print rendering.
- All report views and state variants.
- Green, red, and blocked report generation.
- HTML escaping, secret redaction, and broken-evidence rendering.
- Evidence links, hashes, freshness, and attempt history.
- Cross-host rendering parity from one report model.

## Open Risks

- Dense evidence can become difficult to scan on mobile; use progressive
  disclosure without hiding verdicts or ids.
- A visually green page can be mistaken for source truth; keep source paths,
  integrity, freshness, renderer version, and projection disclaimer visible.
- Report facts may drift if pages read raw artifacts independently; all pages
  must consume one validated report model.
