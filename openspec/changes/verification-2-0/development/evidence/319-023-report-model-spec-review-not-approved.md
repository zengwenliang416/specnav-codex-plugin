# Specification Review Evidence: 023-report-model

## Verdict

not approved

## Blocking Finding

- A completed repair accepts any existing `review_evidence_ids`. The current
  binding does not require those evidence records to belong to the same case,
  the post-fix retest or regression attempts, and successful readings. Failed
  pre-fix evidence can therefore close a `PASS AFTER FIX` report.

## Required Fixes

- Bind completed repair review evidence to the same repair case and the
  successful post-fix retest or regression attempts.
- Reject pre-fix, failed, foreign-case, foreign-run, and unrelated evidence.
- Add a regression proving failed-stage evidence cannot close the repair loop.
