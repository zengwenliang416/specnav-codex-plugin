---
name: specnav-verification-runtime-setup
description: Use this skill when the user explicitly asks to install or repair the locked SpecNav Verification Runtime, including Playwright, managed browser binaries, Midscene, and AJV.
---

# SpecNav Verification Runtime Setup

## Purpose

Install one exact Verification Runtime version outside the business repository.
This is the only Verification skill allowed to create or mutate the managed
runtime.

## Workflow

1. Resolve `SPECNAV_VERIFICATION_ROOT` with the owning plugin resolver.
2. Confirm the requested runtime version is explicit.
3. Run:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" install \
     --version "<version>" \
     --project "$PWD" \
     --json
   ```

4. Report the exact runtime root, package versions, browser revisions, and
   receipt path.
5. If installation blocks, report the returned blocker and failed-attempt
   directory. Do not use `npx`, global packages, a system browser, a global
   Playwright cache, or another runtime version.

## Required Output

- `~/.specnav/runtime/verification/<version>/install-receipt.json`
- Locked package tree and package lock.
- Locked browser directories with `INSTALLATION_COMPLETE` markers.
- Preserved `.failed-*` directory and failure receipt for every failed attempt.

## Stop Conditions

- Runtime version is missing or unsupported.
- Node, platform, or Kernel identity does not match the lock.
- The target runtime version directory already exists.
- A package or browser fails integrity validation.
- The business repository manifest or lockfile changes.

## Validation

- Run `specnav-verification-runtime-status` against the installed version.
- Confirm the install receipt, package lock, browser markers, executable probes, Kernel identity, and unchanged business-project manifests all pass with `fallback_used: false`.
