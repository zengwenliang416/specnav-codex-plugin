---
name: specnav-verification-runtime-status
description: Use this skill when a user asks to inspect, diagnose, or explain locked SpecNav Verification Runtime readiness, including packages, browsers, install receipt, permissions, Kernel identity, and redacted Midscene provider configuration.
---

# SpecNav Verification Runtime Status

## Purpose

Run a read-only doctor against one exact managed runtime version. The doctor
reports facts only; case execution and stage gates decide whether a provider
warning applies to the selected cases.

## Workflow

1. Resolve `SPECNAV_VERIFICATION_ROOT` with the owning plugin resolver.
2. Run:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" doctor \
     --version "<version>" \
     --project "$PWD" \
     --json
   ```

3. Add `--requires-midscene` only when an approved selected case requires
   Midscene.
4. Report `readiness`, every exact blocker, warning, affected artifact, and
   explicit action.
5. Never install, repair, mutate, or select another runtime during doctor.
6. When doctor returns a `repair` action, present the exact command and require
   an explicit user action before invoking it. Repair preserves the prior
   runtime under the managed runtime root and restores it if replacement fails.

## Provider Privacy

- Report only whether model name, model family, base URL, and credentials are
  present.
- Report the credential environment variable name, never its value.
- Never print model names, API keys, base URLs, init JSON, or proxy values.

## Stop Conditions

- Lock, runtime, receipt, package lock, package load, browser marker,
  executable, browser probe, or permission check fails.
- A selected Midscene case requires provider configuration and the redacted
  provider probe is incomplete.
- Any suggested path would use global packages, `npx`, system browsers, global
  Playwright caches, or another runtime version.

## Validation

- Run the doctor command again with the same runtime version and project root.
- Confirm it reports `fallback_used: false`, exact Kernel identity, and either `ok: true` or stable blocker ids with explicit repair actions.
