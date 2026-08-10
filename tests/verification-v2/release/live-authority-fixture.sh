#!/usr/bin/env bash

specnav_verification_prepare_live_authority() {
  local authority_root="$1"
  local source_root="${ROOT:?ROOT must point to the canonical repository}"
  local lock_file="$source_root/tests/verification-v2/cross-host/host-lock.json"
  local fixture_root="$source_root/tests/verification-v2/contracts/fixtures"
  local claude_root="$source_root/../specnav-claude-plugin"
  local codefree_root="$source_root/../specnav-codefree-o-plugin"
  local source_commit
  local claude_commit
  local codefree_commit

  source_commit="$(jq -er '.source.commit' "$lock_file")"
  claude_commit="$(jq -er '.hosts["claude-code"].commit' "$lock_file")"
  codefree_commit="$(jq -er '.hosts["codefree-o"].commit' "$lock_file")"

  mkdir -p "$authority_root"
  git clone -q --no-checkout "$source_root" "$authority_root/codex"
  git -C "$authority_root/codex" checkout -q --detach "$source_commit"
  git clone -q --no-checkout "$claude_root" "$authority_root/claude-code"
  git -C "$authority_root/claude-code" checkout -q --detach "$claude_commit"
  git clone -q --no-checkout "$codefree_root" "$authority_root/codefree-o"
  git -C "$authority_root/codefree-o" checkout -q --detach "$codefree_commit"

  export SPECNAV_VERIFICATION_HOST_LOCK="$lock_file"
  export SPECNAV_VERIFICATION_FIXTURE_ROOT="$fixture_root"
  export SPECNAV_CODEX_REPOSITORY_ROOT="$authority_root/codex"
  export SPECNAV_CLAUDE_REPOSITORY_ROOT="$authority_root/claude-code"
  export SPECNAV_CODEFREE_O_REPOSITORY_ROOT="$authority_root/codefree-o"
}
