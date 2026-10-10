#!/usr/bin/env bash
# Refuses an OTA publish of a commit that is not current main code.
# Usage: ota-commit-guard.sh MAIN_REF CANDIDATE [LIVE_SHA]
#
# The daily cloud cut (daily-cloud-cut.yml) commits `release: v<version>` on top
# of the main tip and pushes it ONLY under its annotated cloud-v* tag, so a
# release commit is never on main: its first parent is. Every commit is compared
# through its "main base": itself when on main, else the first parent of a
# cloud-v*-tagged release commit. The candidate's base must not be older than
# the live bundle's base.
set -euo pipefail
main=$1
candidate=$2
live=${3:-}

main_base() {
  local commit parent
  commit=$(git rev-parse --verify --quiet "$1^{commit}") || {
    echo "::error::Commit $1 is not in this repository" >&2
    return 1
  }
  if git merge-base --is-ancestor "$commit" "$main"; then
    echo "$commit"
    return 0
  fi
  if ! git tag --points-at "$commit" --list 'cloud-v*' | grep -q .; then
    echo "::error::$1 is neither on main nor a cloud-v release commit" >&2
    return 1
  fi
  parent=$(git rev-parse --verify --quiet "$commit^1") || {
    echo "::error::Release commit $1 has no parent" >&2
    return 1
  }
  if ! git merge-base --is-ancestor "$parent" "$main"; then
    echo "::error::Release commit $1 was not cut from main" >&2
    return 1
  fi
  echo "$parent"
}

candidate_base=$(main_base "$candidate")
if [ -n "$live" ]; then
  live_base=$(main_base "$live")
  if ! git merge-base --is-ancestor "$live_base" "$candidate_base"; then
    echo "::error::$candidate is older than the live bundle's commit $live" >&2
    exit 1
  fi
fi
