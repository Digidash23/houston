#!/usr/bin/env bash
# Usage: assert-gatekeeper-notarized.sh <spctl assess args...> <path>
# Runs `spctl -a <args>` and fails unless Gatekeeper accepts the item AS
# NOTARIZED. The exit code alone is not enough: with assessments disabled
# (some CI images) spctl accepts everything with `override=security disabled`.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <spctl args...> <path>" >&2
  exit 2
fi
TARGET="${*: -1}"

if ! OUT=$(spctl -a "$@" 2>&1); then
  echo "$OUT"
  echo "::error::Gatekeeper rejected $TARGET"
  exit 1
fi
echo "$OUT"
if ! grep -qx 'source=Notarized Developer ID' <<<"$OUT"; then
  echo "::error::Gatekeeper did not assess $TARGET as a notarized Developer ID item"
  exit 1
fi
