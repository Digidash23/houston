#!/usr/bin/env bash
# Verify that each file carries a build-provenance attestation signed by
# release-cache-warm.yml running on main (or on CACHE_PROVENANCE_SOURCE_REF).
#
# The release legs restore whisper-cli (a shipped, Authenticode-signed binary)
# and artifact-signing-cli (which receives the Azure signing credentials) from
# caches written on main. Anything that runs on main can write such a cache,
# including npm lifecycle scripts of CI's `pnpm install`, so a restored file
# is only trusted once its attestation names the warm workflow and the main
# ref. A leg that gets a non-zero exit here discards the restored files and
# builds from source.
#
# Usage: scripts/ci/verify-cache-provenance.sh <file>...
# Needs GH_TOKEN (contents: read) and GITHUB_REPOSITORY.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
SOURCE_REF="${CACHE_PROVENANCE_SOURCE_REF:-refs/heads/main}"
SIGNER_WORKFLOW="$REPO/.github/workflows/release-cache-warm.yml"

if [ "$#" -eq 0 ]; then
  echo "ERROR: no files to verify" >&2
  exit 1
fi

status=0
for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "provenance FAILED: $file does not exist" >&2
    status=1
    continue
  fi
  if gh attestation verify "$file" \
      --repo "$REPO" \
      --signer-workflow "$SIGNER_WORKFLOW" \
      --source-ref "$SOURCE_REF"; then
    echo "provenance OK: $file (signed by $SIGNER_WORKFLOW on $SOURCE_REF)"
  else
    echo "provenance FAILED: $file is not attested by $SIGNER_WORKFLOW on $SOURCE_REF" >&2
    status=1
  fi
done
exit "$status"
