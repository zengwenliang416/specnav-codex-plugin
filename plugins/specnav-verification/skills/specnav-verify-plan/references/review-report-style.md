# Verification Review Report Style

SpecNav Verification 2.0 must produce a human-reviewable three-page HTML report
whenever finalization runs. The report is for stakeholders, not just agents, so
it must be readable without opening JSON.

## Visual Direction

Use the Codex warm editorial style:

- cream canvas `#faf9f5`;
- coral primary accent `#cc785c`;
- dark navy product/evidence surfaces `#181715`;
- light cream cards `#efe9de`;
- warm ink text `#141413`;
- serif display headings with humanist sans body;
- generous spacing, content cards no rounder than 8px, 8px controls, and
  compact status badges;
- color-block depth rather than heavy shadows.

## Required Content

The HTML report must show:

- active change and generated timestamp;
- release verdict and archive readiness;
- all six verification domains;
- blockers or an explicit empty state;
- approved case catalog, execution history, and artifact coverage;
- failure, repair, retry, retest, and regression history;
- machine-report paths for audit traceability.

## Required Files

Finalization must write both machine and review artifacts:

- `verify/v2/report-model.json`;
- `verify/v2/report-render-manifest.json`;
- `verify/reports/overview.html`;
- `verify/reports/test-case-catalog.html`;
- `verify/reports/test-case-results.html`.

The report model and gate decisions are machine authorities. The render
manifest proves that the three HTML projections came from the current report
model. Do not treat the HTML as optional when the user needs collaborator
review, and never treat edited HTML as a gate.
