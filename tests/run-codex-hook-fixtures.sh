#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$ROOT/plugins/specnav-core/hooks/hooks.json"
CORE="$ROOT/plugins/specnav-core"
PAYLOADS="$ROOT/tests/fixtures/hook-payloads"
PROJECT_FIXTURE="$ROOT/tests/fixtures/simple-project"
NO_STATE_FIXTURE="$ROOT/tests/fixtures/no-state"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
PROJECT="$TMP_DIR/simple-project"
NO_STATE="$TMP_DIR/no-state"
cp -R "$PROJECT_FIXTURE" "$PROJECT"
cp -R "$NO_STATE_FIXTURE" "$NO_STATE"

# run_case <payload> <project> <expected-exit> [expect-stdout] [strict]
run_case() {
  local name="$1"
  local project="$2"
  local expected="$3"
  local expect_stdout="${4:-}"
  local strict="${5:-}"
  local payload="$PAYLOADS/$name.json"
  local out="$TMP_DIR/$name.out"
  local err="$TMP_DIR/$name.err"

  set +e
  SPECNAV_STRICT="$strict" PROJECT_DIR="$project" node "$CORE/scripts/specnav-guard.js" <"$payload" >"$out" 2>"$err"
  local status=$?
  set -e

  if [[ "$status" != "$expected" ]]; then
    echo "codex hook fixture failed: $name (strict='$strict') expected=$expected actual=$status" >&2
    echo "--- stderr ---" >&2
    cat "$err" >&2
    echo "--- stdout ---" >&2
    cat "$out" >&2
    exit 1
  fi

  if [[ -n "$expect_stdout" ]] && ! grep -q "$expect_stdout" "$out"; then
    echo "codex hook fixture failed: $name stdout missing '$expect_stdout'" >&2
    cat "$out" >&2
    exit 1
  fi
}

jq -e '.hooks.SessionStart and .hooks.UserPromptSubmit and .hooks.PreToolUse and (.hooks | has("PostToolUse") | not)' "$HOOKS" >/dev/null
jq -e '
  (.hooks.PreToolUse | length) == 1
  and .hooks.PreToolUse[0].matcher == "Bash|apply_patch|Edit|Write"
  and (.hooks.PreToolUse[0].hooks | length) == 1
  and (.hooks.PreToolUse[0].hooks[0] | has("statusMessage") | not)
' "$HOOKS" >/dev/null
grep -Fq '${PLUGIN_ROOT}' "$HOOKS"
if grep -Fq 'CLAUDE_PLUGIN_ROOT' "$HOOKS"; then
  echo "hooks must use PLUGIN_ROOT, not CLAUDE_PLUGIN_ROOT" >&2
  exit 1
fi

node --check "$ROOT/plugins/specnav-core/scripts/specnav-session-start.js"
node --check "$ROOT/plugins/specnav-core/scripts/specnav-user-prompt-submit.js"
node --check "$ROOT/plugins/specnav-core/scripts/specnav-guard.js"
node --check "$ROOT/plugins/specnav-core/scripts/cross-repo-guard.js"
node --check "$ROOT/plugins/specnav-core/scripts/specnav-post-tool.js"
node --check "$ROOT/plugins/specnav-core/scripts/tasks-md.js"

# A resumed Codex task may retain the removed PostToolUse command in its hook
# snapshot. Keep an unregistered, silent tombstone so cache upgrades do not
# turn those historical snapshots into repeated hook failures.
LEGACY_POST_OUTPUT="$TMP_DIR/legacy-post-tool.out"
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"pwd"}}' \
  | node "$CORE/scripts/specnav-post-tool.js" >"$LEGACY_POST_OUTPUT"
[[ ! -s "$LEGACY_POST_OUTPUT" ]] || {
  echo "legacy PostToolUse tombstone must remain silent" >&2
  cat "$LEGACY_POST_OUTPUT" >&2
  exit 1
}

# Accounting-first default: legacy-entrypoint invocation warns; strict blocks.
run_case bash-openspec-propose "$PROJECT" 0 "SpecNav gate warning"
run_case bash-openspec-propose "$PROJECT" 2 "" 1
run_case bash-openspec-propose "$NO_STATE" 0

# An explicit project opt-out must take precedence over the presence of
# openspec/. Content automation uses openspec/runtime contracts but is not a
# SpecNav-managed software change.
DISABLED_PROJECT="$TMP_DIR/disabled-project"
cp -R "$PROJECT" "$DISABLED_PROJECT"
cat >"$DISABLED_PROJECT/.specnav.json" <<'JSON'
{
  "schema_version": 1,
  "enabled": false,
  "disabled_reason": "project-owned automation contracts do not use SpecNav lifecycle gates"
}
JSON
run_case bash-openspec-propose "$DISABLED_PROJECT" 0
run_case write-allowed "$DISABLED_PROJECT" 0
DISABLED_EXTERNAL="$TMP_DIR/disabled-external"
mkdir -p "$DISABLED_EXTERNAL/.codegraph"
DISABLED_CROSS_REPO_PAYLOAD="$TMP_DIR/disabled-cross-repo.json"
jq -n --arg target "$DISABLED_EXTERNAL" '{
  tool_name: "Bash",
  tool_input: {command: ("rg symbol " + $target)}
}' >"$DISABLED_CROSS_REPO_PAYLOAD"
PROJECT_DIR="$DISABLED_PROJECT" node "$CORE/scripts/specnav-guard.js" <"$DISABLED_CROSS_REPO_PAYLOAD" >"$TMP_DIR/disabled-cross-repo.out"
[[ ! -s "$TMP_DIR/disabled-cross-repo.out" ]] || {
  echo "disabled project must bypass the unified cross-repo guard" >&2
  cat "$TMP_DIR/disabled-cross-repo.out" >&2
  exit 1
}
DISABLED_STATE="$TMP_DIR/disabled-state.json"
PROJECT_DIR="$DISABLED_PROJECT" node "$CORE/scripts/workflow-state.js" --json >"$DISABLED_STATE"
jq -e '.ok == true and .status == "disabled" and .active_change == null and (.blockers | length == 0)' "$DISABLED_STATE" >/dev/null
DISABLED_AFFORDANCES="$TMP_DIR/disabled-affordances.json"
PROJECT_DIR="$DISABLED_PROJECT" node "$CORE/scripts/affordances.js" --json >"$DISABLED_AFFORDANCES"
jq -e '.state_source == "project-disabled" and (.blockers | length == 0) and (.actions[] | select(.id == "status" and .state == "ready"))' "$DISABLED_AFFORDANCES" >/dev/null
[[ -z "$(PROJECT_DIR="$DISABLED_PROJECT" node "$CORE/scripts/specnav-session-start.js")" ]]
[[ -z "$(printf '%s' "{\"cwd\":\"$DISABLED_PROJECT\"}" | node "$CORE/scripts/specnav-user-prompt-submit.js")" ]]

# Bash has one unified PreToolUse process. Active projects still redirect
# foreign indexed-repository searches through CodeGraph.
ACTIVE_EXTERNAL="$TMP_DIR/active-external"
mkdir -p "$ACTIVE_EXTERNAL/.codegraph"
ACTIVE_CROSS_REPO_PAYLOAD="$TMP_DIR/active-cross-repo.json"
jq -n --arg target "$ACTIVE_EXTERNAL" '{
  tool_name: "Bash",
  tool_input: {command: ("rg symbol " + $target)}
}' >"$ACTIVE_CROSS_REPO_PAYLOAD"
set +e
PROJECT_DIR="$PROJECT" node "$CORE/scripts/specnav-guard.js" <"$ACTIVE_CROSS_REPO_PAYLOAD" >"$TMP_DIR/active-cross-repo.out" 2>/dev/null
ACTIVE_CROSS_REPO_STATUS=$?
set -e
[[ "$ACTIVE_CROSS_REPO_STATUS" == "2" ]] || {
  echo "unified guard must deny indexed cross-repo grep, got $ACTIVE_CROSS_REPO_STATUS" >&2
  exit 1
}
grep -q "cross-repo-search" "$TMP_DIR/active-cross-repo.out" || {
  echo "unified guard cross-repo denial missing blocker id" >&2
  cat "$TMP_DIR/active-cross-repo.out" >&2
  exit 1
}

# Verification reports become stale before a possible edit. Read-only Bash
# commands stay quiet, while mutating Bash commands conservatively invalidate.
STALE_PROJECT="$TMP_DIR/stale-project"
cp -R "$PROJECT" "$STALE_PROJECT"
STALE_CHANGE="$(cat "$STALE_PROJECT/openspec/.specnav/active-change")"
STALE_DIR="$STALE_PROJECT/openspec/changes/$STALE_CHANGE"
printf '{}\n' >"$STALE_DIR/verify-report.json"
rm -f "$STALE_DIR/verify-report.stale"
PROJECT_DIR="$STALE_PROJECT" node "$CORE/scripts/specnav-guard.js" <"$PAYLOADS/bash-safe.json" >/dev/null
[[ ! -e "$STALE_DIR/verify-report.stale" ]] || {
  echo "read-only Bash must not mark verification stale" >&2
  exit 1
}
PROJECT_DIR="$STALE_PROJECT" node "$CORE/scripts/specnav-guard.js" <"$PAYLOADS/write-allowed.json" >/dev/null
[[ -e "$STALE_DIR/verify-report.stale" ]] || {
  echo "edit tool must mark verification stale before execution" >&2
  exit 1
}
rm -f "$STALE_DIR/verify-report.stale"
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"npm run format"}}' \
  | PROJECT_DIR="$STALE_PROJECT" node "$CORE/scripts/specnav-guard.js" >/dev/null
[[ -e "$STALE_DIR/verify-report.stale" ]] || {
  echo "mutating Bash must mark verification stale before execution" >&2
  exit 1
}
rm -f "$STALE_DIR/verify-report.stale"
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"printf changed > src/ui/theme.ts"}}' \
  | PROJECT_DIR="$STALE_PROJECT" node "$CORE/scripts/specnav-guard.js" >/dev/null
[[ -e "$STALE_DIR/verify-report.stale" ]] || {
  echo "redirected shell output must mark verification stale before execution" >&2
  exit 1
}

LEGACY_OPENSPEC_PROJECT="$TMP_DIR/legacy-openspec-project"
cp -R "$PROJECT" "$LEGACY_OPENSPEC_PROJECT"
mkdir -p "$LEGACY_OPENSPEC_PROJECT/.claude/skills/openspec-propose" "$LEGACY_OPENSPEC_PROJECT/.claude/commands/opsx"
cat >"$LEGACY_OPENSPEC_PROJECT/.claude/skills/openspec-propose/SKILL.md" <<'MD'
# OpenSpec Propose

Legacy OpenSpec proposal entrypoint.
MD
cat >"$LEGACY_OPENSPEC_PROJECT/.claude/commands/opsx/propose.md" <<'MD'
# OPSX Propose

Legacy OpenSpec command.
MD
run_case write-allowed "$LEGACY_OPENSPEC_PROJECT" 0 "SpecNav gate warning"
run_case write-allowed "$LEGACY_OPENSPEC_PROJECT" 2 "" 1
run_case openspec-allowed "$LEGACY_OPENSPEC_PROJECT" 0

SPECNAV_DISABLE_OPENSPEC=1 PROJECT_DIR="$LEGACY_OPENSPEC_PROJECT" node "$CORE/scripts/affordances.js" --json >"$TMP_DIR/legacy-affordances.json"
jq -e '.blockers | index("legacy-openspec-workflow")' "$TMP_DIR/legacy-affordances.json" >/dev/null
jq -e '.legacy_openspec_entrypoints[] | select(.name == "openspec-propose")' "$TMP_DIR/legacy-affordances.json" >/dev/null
jq -e '.legacy_openspec_entrypoints[] | select(.name == "opsx/propose")' "$TMP_DIR/legacy-affordances.json" >/dev/null
jq -e '.actions[] | select(.id == "requirements" and (.blocked_by | index("legacy-openspec-workflow")))' "$TMP_DIR/legacy-affordances.json" >/dev/null


# Graduated enforcement: hit 1 warns, hit 2 is silent, hit 3 denies.
DEDUP_PROJECT="$TMP_DIR/dedup-project"
mkdir -p "$DEDUP_PROJECT/openspec/.specnav" "$DEDUP_PROJECT/openspec/changes/d"
printf 'd\n' >"$DEDUP_PROJECT/openspec/.specnav/active-change"
DEDUP_PAYLOAD='{"session_id":"s-dedup-1","tool_name":"Write","tool_input":{"file_path":"src/app.ts","content":"x"}}'
OUT1="$(printf '%s' "$DEDUP_PAYLOAD" | PROJECT_DIR="$DEDUP_PROJECT" node "$CORE/scripts/specnav-guard.js")"
echo "$OUT1" | grep -q "SpecNav gate warning" || { echo "escalation: first warn missing"; exit 1; }
OUT2="$(printf '%s' "$DEDUP_PAYLOAD" | PROJECT_DIR="$DEDUP_PROJECT" node "$CORE/scripts/specnav-guard.js")"
if echo "$OUT2" | grep -q "SpecNav gate warning"; then
  echo "escalation: second identical warn should be silent"; exit 1
fi
set +e
printf '%s' "$DEDUP_PAYLOAD" | PROJECT_DIR="$DEDUP_PROJECT" node "$CORE/scripts/specnav-guard.js" >/dev/null 2>&1
ESC_STATUS=$?
set -e
[[ "$ESC_STATUS" == "2" ]] || { echo "escalation: third hit should deny, got $ESC_STATUS"; exit 1; }
OUT4="$(printf '%s' "${DEDUP_PAYLOAD/s-dedup-1/s-dedup-2}" | PROJECT_DIR="$DEDUP_PROJECT" node "$CORE/scripts/specnav-guard.js")"
echo "$OUT4" | grep -q "SpecNav gate warning" || { echo "escalation: new session should warn again"; exit 1; }

# Repo suitability: bootstrap refuses tooling-shaped repos unless --force.
TOOLING_REPO="$TMP_DIR/tooling-repo"
mkdir -p "$TOOLING_REPO/plugins/x" "$TOOLING_REPO/.codex-plugin"
set +e
PROJECT_DIR="$TOOLING_REPO" node "$CORE/scripts/specnav-bootstrap.js" --json "$TOOLING_REPO" >"$TMP_DIR/boot-tooling.json" 2>/dev/null
BOOT_STATUS=$?
set -e
[[ "$BOOT_STATUS" == "2" ]] || { echo "suitability: tooling repo should be refused, got $BOOT_STATUS"; exit 1; }
grep -q "repo-profile:tooling" "$TMP_DIR/boot-tooling.json" || { echo "suitability: blocker id missing"; exit 1; }

# Requirements-stage awareness: docs/markdown edits under a change that has
# requirements.md but no tasks.md yet are silent; source edits still warn.
REQ_STAGE_PROJECT="$TMP_DIR/req-stage-project"
mkdir -p "$REQ_STAGE_PROJECT/openspec/.specnav" "$REQ_STAGE_PROJECT/openspec/changes/r"
printf 'r\n' >"$REQ_STAGE_PROJECT/openspec/.specnav/active-change"
printf '# Requirements\n' >"$REQ_STAGE_PROJECT/openspec/changes/r/requirements.md"
OUT="$(printf '%s' '{"session_id":"s-req","tool_name":"Write","tool_input":{"file_path":"docs/design/plan.md","content":"x"}}' | PROJECT_DIR="$REQ_STAGE_PROJECT" node "$CORE/scripts/specnav-guard.js")"
if echo "$OUT" | grep -q "SpecNav gate warning"; then
  echo "req-stage: docs edit should be silent during requirements stage"; exit 1
fi
OUT="$(printf '%s' '{"session_id":"s-req","tool_name":"Write","tool_input":{"file_path":"src/app.ts","content":"x"}}' | PROJECT_DIR="$REQ_STAGE_PROJECT" node "$CORE/scripts/specnav-guard.js")"
echo "$OUT" | grep -q "missing-tasks" || { echo "req-stage: source edit should still warn"; exit 1; }

echo "codex hook fixtures ok"
