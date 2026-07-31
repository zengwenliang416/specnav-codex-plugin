# Independent Quality Re-review: 010-playwright-runner

## Verdict

NOT APPROVED

## Findings

1. CRITICAL: the VM context is not a security boundary when real Playwright
   host objects enter it. A scenario can use
   `page.constructor.constructor('return process')()` to recover the host
   process and then load `node:fs`. The independent reproduction returned
   `passed` and wrote `sandbox-escape.txt`.
2. MEDIUM: the reviewer started before the fixture budget update and reproduced
   a 30000ms happy-path timeout under concurrent browser load. A focused rerun
   passed in about 21.5 seconds.

## Confirmed Repairs

- Runtime destination symlink replacement no longer writes outside the project.
- Cancellation no longer permits the previous delayed marker side effect.
- First-stop-cause behavior remains correct.
- Raw browser candidates are Task 010 output; redaction before EvidenceStore
  persistence remains Task 014 ownership.

## Required Fix

Replace the VM-as-sandbox claim with an operating-system enforced process
boundary that denies writes outside the adapter-owned staging directory and
terminates the entire process group before returning a terminal attempt.
