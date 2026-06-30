---
name: specnav-codegraph-setup
description: Use this skill when the user explicitly asks to install, repair, or inspect CodeGraph MCP wiring for SpecNav evidence collection in Claude Code or Codex.
---

# SpecNav CodeGraph Setup

## Purpose

Set up or inspect the host-agent CodeGraph MCP connection as an explicit user
action. This skill must not run setup from a hook or as an implied fallback.

## Workflow

1. Resolve the installed `specnav-codegraph` plugin root with the SpecNav runtime
   resolver.
2. Run `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-setup.js" --target claude`
   or `node "$SPECNAV_CODEGRAPH_ROOT/scripts/codegraph-setup.js" --target codex`
   first to show the intended config and confirmation blocker.
3. Only when the user explicitly confirms setup, run the same command with
   `--yes --json`.
4. Report `codegraph:restart-required` after any successful config change.
5. Tell the user that the current session may not see the MCP tool until the
   host agent restarts.

## Stop Conditions

- The target is not `claude` or `codex`.
- The CodeGraph CLI is missing.
- The user has not explicitly confirmed setup.
- The official installer fails.

## Validation

- Setup is valid only when the script returns JSON with `ok: true` or the exact
  blocker is reported.
- Never silently edit global config from this skill.
- Never alter CodeGraph telemetry preferences.
