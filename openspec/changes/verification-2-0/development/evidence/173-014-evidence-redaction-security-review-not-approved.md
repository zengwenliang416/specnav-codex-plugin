# Security Review Evidence: 014-evidence-redaction

## Verdict

NOT APPROVED

## Finding

Configured secret replacement could place the raw redaction marker inside a
sensitive URL query parameter. The later query rule treated that marker as
already canonical and did not convert it to the URL-encoded marker, so query
structure was not preserved consistently.

## Preserved Reproductions

- A configured secret used as `openai_api_key` became `[REDACTED]` instead of
  `%5BREDACTED%5D`.
- A configured secret equal to `%5BREDACTED%5D` also became the raw marker.

## Required Repair

- Canonicalize raw markers in sensitive query values to the encoded marker.
- Preserve an already encoded marker.
- Add both reproductions as permanent regression tests.

## System Evidence

- `development/evidence/173-014-evidence-redaction.log`
