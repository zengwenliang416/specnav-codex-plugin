#!/usr/bin/env bash

specnav_verification_prepare_live_authority() {
  local authority_root="$1"
  local source_root="${ROOT:?ROOT must point to the canonical repository}"
  local manifest_file="$authority_root.json"

  node \
    "$source_root/tests/verification-v2/release/materialize-live-authority.js" \
    "$authority_root" \
    >"$manifest_file"

  export SPECNAV_VERIFICATION_HOST_LOCK
  SPECNAV_VERIFICATION_HOST_LOCK="$(jq -er '.host_lock' "$manifest_file")"
  export SPECNAV_VERIFICATION_FIXTURE_ROOT
  SPECNAV_VERIFICATION_FIXTURE_ROOT="$(jq -er '.fixture_root' "$manifest_file")"
  export SPECNAV_CODEX_REPOSITORY_ROOT
  SPECNAV_CODEX_REPOSITORY_ROOT="$(jq -er '.roots.codex' "$manifest_file")"
  export SPECNAV_CLAUDE_REPOSITORY_ROOT
  SPECNAV_CLAUDE_REPOSITORY_ROOT="$(
    jq -er '.roots["claude-code"]' "$manifest_file"
  )"
  export SPECNAV_CODEFREE_O_REPOSITORY_ROOT
  SPECNAV_CODEFREE_O_REPOSITORY_ROOT="$(
    jq -er '.roots["codefree-o"]' "$manifest_file"
  )"
  export SPECNAV_DSH_REPOSITORY_ROOT
  SPECNAV_DSH_REPOSITORY_ROOT="$(jq -er '.roots.dsh' "$manifest_file")"
}
