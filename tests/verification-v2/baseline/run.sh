#!/usr/bin/env bash
set -euo pipefail

BASELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ROOT="$BASELINE_ROOT"
VERIFY="$ROOT/plugins/specnav-verification"
CASES="$ROOT/tests/verification-v2/baseline/cases.json"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SPECNAV_FIXTURE_LIBRARY_ONLY=1 source "$ROOT/tests/run-verification-plugin-fixtures.sh"
ROOT="$BASELINE_ROOT"
VERIFY="$ROOT/plugins/specnav-verification"

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

file_size() {
  wc -c <"$1" | tr -d ' '
}

enrich_clean_control() {
  local project="$1"
  local change_dir="$project/openspec/changes/add-dashboard"
  local task_dir="$change_dir/development/tasks/001-dashboard-summary"
  local development_evidence="$change_dir/development/evidence"
  local verify="$change_dir/verify"
  local evidence_dir="$verify/evidence"
  local code_sha
  local test_sha

  mkdir -p "$development_evidence" "$evidence_dir" "$verify/e2e/screenshots"
  cat >"$change_dir/acceptance.json" <<'JSON'
{
  "schema_version": 2,
  "change_id": "add-dashboard",
  "assertions": [
    {
      "id": "AC-DASHBOARD-01",
      "statement": "Dashboard summary handles populated, loading, empty, and error states.",
      "verify_via": "e2e",
      "status": "passing",
      "evidence_ref": "verify/user-test-cases.json#utc-dashboard-summary"
    }
  ]
}
JSON

  printf 'npm test passed for dashboard summary fixture\n' \
    >"$development_evidence/001-dashboard-summary.log"
  cat >"$task_dir/acceptance.json" <<'JSON'
{
  "schema": "specnav.task-acceptance-evidence.v1",
  "generated_by": "specnav-development/task-acceptance-evidence",
  "task_id": "001-dashboard-summary",
  "recorded_at": "2026-07-03T00:00:00.000Z",
  "status": "approved",
  "assertions": [
    {
      "id": "AC-DASHBOARD-01",
      "parent_id": "AC-DASHBOARD-01",
      "status": "passing",
      "direct_evidence": [
        "development/tasks/001-dashboard-summary/report.md",
        "development/tasks/001-dashboard-summary/spec-review.md",
        "development/tasks/001-dashboard-summary/quality-review.md",
        "development/evidence/001-dashboard-summary.log"
      ],
      "reused_evidence": [],
      "claim": "Dashboard summary handles populated, loading, empty, and error states."
    }
  ],
  "fallback_used": false
}
JSON

  cat >>"$task_dir/spec-review.md" <<'MD'
## Acceptance Assertions Verified
- AC-DASHBOARD-01
MD

  jq '.cases[0].step_ids = ["step-open-dashboard", "step-wait-for-summary"]' \
    "$verify/user-test-cases.json" >"$TMP_DIR/control-cases.json"
  mv "$TMP_DIR/control-cases.json" "$verify/user-test-cases.json"

  printf 'runtime server ready\n' >"$verify/e2e/runtime-server.log"
  printf '{"status":"passed","tests":1}\n' >"$verify/e2e/playwright-report.json"
  printf 'fixture screenshot bytes\n' >"$verify/e2e/screenshots/dashboard-summary.png"

  code_sha="$(git -C "$project" rev-parse HEAD)"
  test_sha="$(sha256_file "$verify/user-test-cases.json")"
  : >"$verify/evidence-index.jsonl"
  : >"$verify/readings.jsonl"

  for domain in facticity static unit redteam e2e sensory; do
    local evidence_file="$evidence_dir/$domain.log"
    local evidence_rel="verify/evidence/$domain.log"
    local evidence_id="ev-$domain"
    local attempt_id="attempt-$domain-001"
    local digest
    local size

    printf '%s verified for utc-dashboard-summary\n' "$domain" >"$evidence_file"
    digest="$(sha256_file "$evidence_file")"
    size="$(file_size "$evidence_file")"

    jq -n -c \
      --arg id "$evidence_id" \
      --arg path "$evidence_rel" \
      --arg domain "$domain" \
      --arg attempt_id "$attempt_id" \
      --arg code_sha "$code_sha" \
      --arg test_sha "$test_sha" \
      --arg sha256 "$digest" \
      --argjson size "$size" \
      '{
        id: $id,
        path: $path,
        kind: "command",
        domain: $domain,
        producer: "specnav-command-runner",
        run_id: "run-control-001",
        case_id: "utc-dashboard-summary",
        attempt_id: $attempt_id,
        step_id: "step-open-dashboard",
        code_sha: $code_sha,
        test_sha: $test_sha,
        sha256: $sha256,
        size: $size,
        result: "pass"
      }' >>"$verify/evidence-index.jsonl"

    jq -n -c \
      --arg domain "$domain" \
      --arg attempt_id "$attempt_id" \
      --arg evidence_id "$evidence_id" \
      '{
        id: ("reading-" + $domain + "-001"),
        run_id: "run-control-001",
        case_id: "utc-dashboard-summary",
        attempt_id: $attempt_id,
        step_id: "step-open-dashboard",
        domain: $domain,
        assertion_id: "AC-DASHBOARD-01",
        expected: "dashboard state is handled",
        actual: "dashboard state is handled",
        oracle: {type: "deterministic", owner: "specnav-command-runner"},
        evidence_ids: [$evidence_id],
        verdict: "pass"
      }' >>"$verify/readings.jsonl"

    jq \
      --arg evidence "$evidence_rel" \
      --arg command "verify-$domain" \
      '.evidence = [$evidence] | .commands = [$command]' \
      "$verify/$domain/report.json" >"$TMP_DIR/control-domain.json"
    mv "$TMP_DIR/control-domain.json" "$verify/$domain/report.json"
  done
}

aggregate() {
  local project="$1"
  local output="$2"
  shift 2
  local status

  set +e
  PROJECT_DIR="$project" node "$VERIFY/scripts/verify-domains.js" aggregate --json "$@" >"$output"
  status=$?
  set -e
  printf '%s' "$status"
}

assert_clean_control() {
  local project="$1"
  local output="$TMP_DIR/control.json"
  local status

  status="$(aggregate "$project" "$output")"
  [[ "$status" == "0" ]] || {
    echo "clean control did not aggregate green" >&2
    cat "$output" >&2
    exit 1
  }
  jq -e '.verdict == "green" and (.blockers | length == 0)' "$output" >/dev/null
  test -f "$project/openspec/changes/add-dashboard/acceptance.json"
  test -s "$project/openspec/changes/add-dashboard/verify/readings.jsonl"
}

case_field() {
  local id="$1"
  local field="$2"
  jq -er --arg id "$id" --arg field "$field" \
    '.cases[] | select(.id == $id) | .[$field]' "$CASES"
}

OBSERVATIONS="$TMP_DIR/observations.jsonl"

record_fake_green() {
  local id="$1"
  local project="$2"
  local output="$TMP_DIR/$id.json"
  local status
  local expected
  local blocker

  expected="$(case_field "$id" expected_v2)"
  blocker="$(case_field "$id" required_blocker)"
  [[ "$expected" == "blocked" ]]
  status="$(aggregate "$project" "$output")"
  [[ "$status" == "0" ]] || {
    echo "expected V1 fake green for $id, got exit $status" >&2
    cat "$output" >&2
    exit 1
  }
  jq -e '.verdict == "green" and (.blockers | length == 0)' "$output" >/dev/null
  jq -n -c \
    --arg id "$id" \
    --arg blocker "$blocker" \
    '{id: $id, kind: "fake-green", observed_v1: "green", expected_v2: "blocked", required_blocker: $blocker}' \
    >>"$OBSERVATIONS"
}

record_report_state() {
  local id="$1"
  local project="$2"
  local expected_domain="$3"
  local output="$TMP_DIR/$id.json"
  local status
  local blocker

  blocker="$(case_field "$id" required_blocker)"
  status="$(aggregate "$project" "$output" --render)"
  [[ "$status" == "2" ]] || {
    echo "expected rendered red aggregate for $id, got exit $status" >&2
    cat "$output" >&2
    exit 1
  }
  jq -e --arg domain "$expected_domain" \
    '.verdict == "red" and (.domains | to_entries[] | select(.value == $domain))' \
    "$output" >/dev/null
  test -f "$project/openspec/changes/add-dashboard/verify/aggregate-report.html"
  test -f "$project/openspec/changes/add-dashboard/verify-report.html"
  test ! -e "$project/openspec/changes/add-dashboard/verify/overview.html"
  test ! -e "$project/openspec/changes/add-dashboard/verify/test-case-catalog.html"
  test ! -e "$project/openspec/changes/add-dashboard/verify/test-case-results.html"
  grep -Fq 'Six-domain verification' \
    "$project/openspec/changes/add-dashboard/verify/aggregate-report.html"
  jq -n -c \
    --arg id "$id" \
    --arg state "$expected_domain" \
    --arg blocker "$blocker" \
    '{id: $id, kind: "report-state", observed_v1: "rendered-aggregate-only", expected_v2: "three-pages", domain_state: $state, required_blocker: $blocker}' \
    >>"$OBSERVATIONS"
}

BASE="$TMP_DIR/control"
write_base_project "$BASE"
write_verify_artifacts "$BASE"
enrich_clean_control "$BASE"
assert_clean_control "$BASE"

MISSING_ACCEPTANCE="$TMP_DIR/missing-acceptance"
cp -R "$BASE" "$MISSING_ACCEPTANCE"
rm "$MISSING_ACCEPTANCE/openspec/changes/add-dashboard/acceptance.json"
record_fake_green "missing-acceptance-contract" "$MISSING_ACCEPTANCE"

EMPTY_EVIDENCE="$TMP_DIR/empty-evidence"
cp -R "$BASE" "$EMPTY_EVIDENCE"
jq '.evidence = [] | .commands = []' \
  "$EMPTY_EVIDENCE/openspec/changes/add-dashboard/verify/static/report.json" \
  >"$TMP_DIR/empty-evidence.json"
mv "$TMP_DIR/empty-evidence.json" \
  "$EMPTY_EVIDENCE/openspec/changes/add-dashboard/verify/static/report.json"
record_fake_green "empty-domain-evidence" "$EMPTY_EVIDENCE"

MISSING_FILE="$TMP_DIR/missing-file"
cp -R "$BASE" "$MISSING_FILE"
jq '.evidence[0] = "verify/evidence/does-not-exist.log"' \
  "$MISSING_FILE/openspec/changes/add-dashboard/verify/e2e/report.json" \
  >"$TMP_DIR/missing-file-report.json"
mv "$TMP_DIR/missing-file-report.json" \
  "$MISSING_FILE/openspec/changes/add-dashboard/verify/e2e/report.json"
jq -c 'select(.domain == "e2e") | .path = "verify/evidence/does-not-exist.log"' \
  "$MISSING_FILE/openspec/changes/add-dashboard/verify/evidence-index.jsonl" \
  >"$TMP_DIR/missing-e2e-entry.jsonl"
jq -c 'select(.domain != "e2e")' \
  "$MISSING_FILE/openspec/changes/add-dashboard/verify/evidence-index.jsonl" \
  >"$TMP_DIR/non-e2e-entries.jsonl"
cat "$TMP_DIR/non-e2e-entries.jsonl" "$TMP_DIR/missing-e2e-entry.jsonl" \
  >"$MISSING_FILE/openspec/changes/add-dashboard/verify/evidence-index.jsonl"
record_fake_green "missing-evidence-file" "$MISSING_FILE"

HASH_MISMATCH="$TMP_DIR/hash-mismatch"
cp -R "$BASE" "$HASH_MISMATCH"
printf 'tampered after indexing\n' \
  >"$HASH_MISMATCH/openspec/changes/add-dashboard/verify/evidence/static.log"
record_fake_green "evidence-hash-mismatch" "$HASH_MISMATCH"

SIZE_MISMATCH="$TMP_DIR/size-mismatch"
cp -R "$BASE" "$SIZE_MISMATCH"
jq -c 'if .domain == "unit" then .size += 1 else . end' \
  "$SIZE_MISMATCH/openspec/changes/add-dashboard/verify/evidence-index.jsonl" \
  >"$TMP_DIR/size-mismatch-index.jsonl"
mv "$TMP_DIR/size-mismatch-index.jsonl" \
  "$SIZE_MISMATCH/openspec/changes/add-dashboard/verify/evidence-index.jsonl"
record_fake_green "evidence-size-mismatch" "$SIZE_MISMATCH"

STALE_SHA="$TMP_DIR/stale-sha"
cp -R "$BASE" "$STALE_SHA"
jq -c 'if .domain == "facticity" then .code_sha = "0000000000000000000000000000000000000000" else . end' \
  "$STALE_SHA/openspec/changes/add-dashboard/verify/evidence-index.jsonl" \
  >"$TMP_DIR/stale-sha-index.jsonl"
mv "$TMP_DIR/stale-sha-index.jsonl" \
  "$STALE_SHA/openspec/changes/add-dashboard/verify/evidence-index.jsonl"
record_fake_green "stale-code-sha" "$STALE_SHA"

BAD_PRODUCER="$TMP_DIR/bad-producer"
cp -R "$BASE" "$BAD_PRODUCER"
jq -c 'if .domain == "redteam" then .producer = "unknown-agent-narrative" else . end' \
  "$BAD_PRODUCER/openspec/changes/add-dashboard/verify/evidence-index.jsonl" \
  >"$TMP_DIR/bad-producer-index.jsonl"
mv "$TMP_DIR/bad-producer-index.jsonl" \
  "$BAD_PRODUCER/openspec/changes/add-dashboard/verify/evidence-index.jsonl"
record_fake_green "unrecognized-evidence-producer" "$BAD_PRODUCER"

BAD_CASE="$TMP_DIR/bad-case"
cp -R "$BASE" "$BAD_CASE"
jq -c 'if .domain == "sensory" then .case_id = "missing-case" else . end' \
  "$BAD_CASE/openspec/changes/add-dashboard/verify/evidence-index.jsonl" \
  >"$TMP_DIR/bad-case-index.jsonl"
mv "$TMP_DIR/bad-case-index.jsonl" \
  "$BAD_CASE/openspec/changes/add-dashboard/verify/evidence-index.jsonl"
record_fake_green "broken-case-reference" "$BAD_CASE"

BAD_STEP="$TMP_DIR/bad-step"
cp -R "$BASE" "$BAD_STEP"
jq -c 'if .domain == "e2e" then .step_id = "missing-step" else . end' \
  "$BAD_STEP/openspec/changes/add-dashboard/verify/evidence-index.jsonl" \
  >"$TMP_DIR/bad-step-index.jsonl"
mv "$TMP_DIR/bad-step-index.jsonl" \
  "$BAD_STEP/openspec/changes/add-dashboard/verify/evidence-index.jsonl"
record_fake_green "broken-step-reference" "$BAD_STEP"

MISSING_RUNTIME="$TMP_DIR/missing-runtime"
cp -R "$BASE" "$MISSING_RUNTIME"
rm \
  "$MISSING_RUNTIME/openspec/changes/add-dashboard/verify/e2e/runtime-server.log" \
  "$MISSING_RUNTIME/openspec/changes/add-dashboard/verify/e2e/playwright-report.json"
record_fake_green "missing-runtime-artifacts" "$MISSING_RUNTIME"

MANUAL_GREEN="$TMP_DIR/manual-green"
cp -R "$BASE" "$MANUAL_GREEN"
jq -c 'if .domain == "redteam" then .verdict = "blocked" | .actual = "oracle could not verify" else . end' \
  "$MANUAL_GREEN/openspec/changes/add-dashboard/verify/readings.jsonl" \
  >"$TMP_DIR/manual-green-readings.jsonl"
mv "$TMP_DIR/manual-green-readings.jsonl" \
  "$MANUAL_GREEN/openspec/changes/add-dashboard/verify/readings.jsonl"
record_fake_green "manual-green-overrides-blocked-reading" "$MANUAL_GREEN"

MTIME_BYPASS="$TMP_DIR/mtime-bypass"
cp -R "$BASE" "$MTIME_BYPASS"
CHANGE_DIR="$MTIME_BYPASS/openspec/changes/add-dashboard"
touch -t 202601010000 "$CHANGE_DIR/verify-report.stale"
for domain in facticity static unit redteam e2e sensory; do
  touch "$CHANGE_DIR/verify/$domain/report.json"
done
record_fake_green "mtime-only-stale-bypass" "$MTIME_BYPASS"
test ! -f "$CHANGE_DIR/verify-report.stale"

GREEN_HTML="$TMP_DIR/green-html"
cp -R "$BASE" "$GREEN_HTML"
rm "$GREEN_HTML/openspec/changes/add-dashboard/verify/readings.jsonl"
record_fake_green "green-html-from-unverified-data" "$GREEN_HTML"
aggregate "$GREEN_HTML" "$TMP_DIR/green-html-render.json" --render >/dev/null
test -f "$GREEN_HTML/openspec/changes/add-dashboard/verify/aggregate-report.html"

RED_REPORT="$TMP_DIR/red-report"
cp -R "$BASE" "$RED_REPORT"
jq '.verdict = "red" | .findings = ["deterministic assertion failed"]' \
  "$RED_REPORT/openspec/changes/add-dashboard/verify/static/report.json" \
  >"$TMP_DIR/red-domain-report.json"
mv "$TMP_DIR/red-domain-report.json" \
  "$RED_REPORT/openspec/changes/add-dashboard/verify/static/report.json"
record_report_state "red-report-generated" "$RED_REPORT" "red"

BLOCKED_REPORT="$TMP_DIR/blocked-report"
cp -R "$BASE" "$BLOCKED_REPORT"
jq '.verdict = "blocked" | .blocker_class = "environment" | .findings = ["browser unavailable"]' \
  "$BLOCKED_REPORT/openspec/changes/add-dashboard/verify/e2e/report.json" \
  >"$TMP_DIR/blocked-domain-report.json"
mv "$TMP_DIR/blocked-domain-report.json" \
  "$BLOCKED_REPORT/openspec/changes/add-dashboard/verify/e2e/report.json"
record_report_state "blocked-domain-report-generated" "$BLOCKED_REPORT" "blocked"

jq -s '.' "$OBSERVATIONS" >"$TMP_DIR/observations.json"
EXPECTED_COUNT="$(jq '.cases | length' "$CASES")"
OBSERVED_COUNT="$(jq 'length' "$TMP_DIR/observations.json")"

[[ "$OBSERVED_COUNT" == "$EXPECTED_COUNT" ]] || {
  echo "expected $EXPECTED_COUNT observations, got $OBSERVED_COUNT" >&2
  cat "$TMP_DIR/observations.json" >&2
  exit 1
}

jq -e --slurpfile observed "$TMP_DIR/observations.json" '
  all(.cases[]; .id as $id | any($observed[0][]; .id == $id))
' "$CASES" >/dev/null
jq -e '
  all(.[] | select(.kind == "fake-green");
    .observed_v1 == "green"
    and .expected_v2 == "blocked"
    and (.required_blocker | length > 0)
  )
' "$TMP_DIR/observations.json" >/dev/null
jq -e '
  all(.[] | select(.kind == "report-state");
    .observed_v1 == "rendered-aggregate-only"
    and .expected_v2 == "three-pages"
    and .required_blocker == "report-center:pages-missing"
  )
' "$TMP_DIR/observations.json" >/dev/null

FAKE_GREEN_COUNT="$(jq '[.[] | select(.kind == "fake-green")] | length' "$TMP_DIR/observations.json")"
REPORT_STATE_COUNT="$(jq '[.[] | select(.kind == "report-state")] | length' "$TMP_DIR/observations.json")"
echo "verification v2 baseline reproduced: $FAKE_GREEN_COUNT fake-green cases, $REPORT_STATE_COUNT report states"
