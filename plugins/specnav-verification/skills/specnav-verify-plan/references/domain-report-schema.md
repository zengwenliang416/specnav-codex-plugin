# Domain Report Schema

Read this before writing any domain report.

## Markdown Report

Each `verify/<domain>/report.md` must contain:

- Domain
- Verdict
- Inputs Reviewed
- Evidence
- Commands Run
- Findings
- Required Fixes
- Residual Risk
- Follow-up Domain Routing

## JSON Report

Each `verify/<domain>/report.json` must contain:

- `schema_version: 1`
- `domain`
- `verdict`: `green`, `red`, or `blocked`
- `required: true`
- `evidence: []`
- `commands: []`
- `findings: []`
- `required_fixes: []`
- `residual_risk: []`
- `blocker_class`: null or a known blocker class

Use `green` only when evidence is complete and required fixes are empty.
