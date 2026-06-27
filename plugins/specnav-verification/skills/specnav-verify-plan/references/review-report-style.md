# Verification Review Report Style

SpecNav verification must produce a human-reviewable HTML report whenever
aggregate verification runs. The report is for stakeholders, not just agents, so
it must be readable without opening JSON.

## Visual Direction

Use the Codex warm editorial style:

- cream canvas `#faf9f5`;
- coral primary accent `#cc785c`;
- dark navy product/evidence surfaces `#181715`;
- light cream cards `#efe9de`;
- warm ink text `#141413`;
- serif display headings with humanist sans body;
- generous spacing, 12px content cards, 8px controls, pill badges;
- color-block depth rather than heavy shadows.

## Required Content

The HTML report must show:

- active change and generated timestamp;
- aggregate verdict;
- all six verification domains;
- blockers or an explicit empty state;
- artifact coverage table;
- machine-report paths for audit traceability.

## Required Files

Aggregate must write both machine and review artifacts:

- `verify/aggregate-report.json`;
- `verify/aggregate-report.md`;
- `verify/aggregate-report.html`;
- `verify-report.json`;
- `verify-report.md`;
- `verify-report.html`.

Do not treat the HTML as optional if the user needs review with collaborators.
