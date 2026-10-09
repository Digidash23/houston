#!/usr/bin/env bash
# Usage: write-train-json.sh <out-file>
# Renders train.json: what train cloud-v<VERSION> shipped. For the engine and
# the agentstore it records the image promoted to prod (sha, digest, image ref)
# and whether the matching label/ tag could be stamped. ship-train.yml uploads
# it as a release asset, so the train -> image mapping exists even when a label
# push is refused.
#
# Env, required: TAG, VERSION, REGISTRY.
# Env, optional (an empty *_SHA makes that half `null`: its image never resolved):
#   BASE_SHA, RUN_URL
#   ENGINE_SHA, ENGINE_DIGEST, ENGINE_LABEL_STAMPED, ENGINE_LABEL_REASON
#   AGENTSTORE_SHA, AGENTSTORE_DIGEST, AGENTSTORE_LABEL_STAMPED, AGENTSTORE_LABEL_REASON
# *_LABEL_STAMPED is the stamp script's outcome (true | unchanged | false);
# both `true` and `unchanged` mean the label exists at this sha.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <out-file>" >&2
  exit 2
fi
OUT="$1"
: "${TAG:?TAG is required}"
: "${VERSION:?VERSION is required}"
: "${REGISTRY:?REGISTRY is required}"

half() { # <image repo> <label> <sha> <digest> <stamped> <reason>
  if [ -z "$3" ]; then
    echo null
    return
  fi
  jq -n --arg repo "$1" --arg label "$2" --arg sha "$3" --arg digest "$4" \
    --arg stamped "$5" --arg reason "$6" '{
      sha: $sha,
      digest: $digest,
      image: ($repo + "@" + $digest),
      label: {
        name: $label,
        stamped: ($stamped == "true" or $stamped == "unchanged"),
        reason: (if $reason == "" then null else $reason end)
      }
    }'
}

ENGINE=$(half "${REGISTRY}/engine-pod" "label/engine-pod-v${VERSION}" \
  "${ENGINE_SHA:-}" "${ENGINE_DIGEST:-}" "${ENGINE_LABEL_STAMPED:-}" "${ENGINE_LABEL_REASON:-}")
AGENTSTORE=$(half "${REGISTRY}/agentstore" "label/agentstore-v${VERSION}" \
  "${AGENTSTORE_SHA:-}" "${AGENTSTORE_DIGEST:-}" "${AGENTSTORE_LABEL_STAMPED:-}" "${AGENTSTORE_LABEL_REASON:-}")

jq -n \
  --arg tag "$TAG" \
  --arg version "$VERSION" \
  --arg base "${BASE_SHA:-}" \
  --arg run "${RUN_URL:-}" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson engine "$ENGINE" \
  --argjson agentstore "$AGENTSTORE" '{
    schema: 1,
    tag: $tag,
    version: $version,
    base_sha: (if $base == "" then null else $base end),
    recorded_at: $at,
    run_url: (if $run == "" then null else $run end),
    engine: $engine,
    agentstore: $agentstore
  }' > "$OUT"
