#!/usr/bin/env bash
# Refuses an OTA publish of a commit that is not current main code.
# Usage: ota-commit-guard.sh MAIN_REF CANDIDATE [LIVE_SHA]
#
# A cloud-v* release commit is never on main: the daily cut commits
# `release: v<version>` on the main tip and pushes it only under its tag, and
# hand cuts add release-notes commits, CI fixes or cherry-picked hotfixes on top.
# So every commit is compared through its "main base": itself when on main, else
# (only for a commit a cloud-v* tag points at; tags are pushed only by admins and
# the release token) its merge base with main, at most MAX_RELEASE_COMMITS away.
# The candidate's base must not be strictly older than the live bundle's base.
set -euo pipefail
main=$1
candidate=$2
live=${3:-}

MAX_RELEASE_COMMITS=20

main_base() {
  local commit base distance
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
  base=$(git merge-base "$commit" "$main") || {
    echo "::error::Release commit $1 shares no history with main" >&2
    return 1
  }
  distance=$(git rev-list --count "$base..$commit")
  if [ "$distance" -gt "$MAX_RELEASE_COMMITS" ]; then
    echo "::error::Release commit $1 is $distance commits off main (max $MAX_RELEASE_COMMITS)" >&2
    return 1
  fi
  echo "$base"
}

candidate_base=$(main_base "$candidate")
if [ -n "$live" ]; then
  live_base=$(main_base "$live")
  if [ "$live_base" != "$candidate_base" ] &&
    git merge-base --is-ancestor "$candidate_base" "$live_base"; then
    echo "::error::$candidate is older than the live bundle's commit $live" >&2
    exit 1
  fi
  # Neither base contains the other when a release-notes commit cut off main
  # only reached main later (cloud-v1.0.0): not provably older, so it passes.
  if ! git merge-base --is-ancestor "$live_base" "$candidate_base"; then
    echo "::notice::$candidate and the live bundle $live branch from main separately"
  fi
fi
