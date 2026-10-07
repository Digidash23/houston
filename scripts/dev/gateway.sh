#!/bin/sh
# `pnpm dev` pane: the Go gateway (authoritative edge) from the sibling cloud
# checkout, on :9080. All GW_*/CP_* config comes from .env.development via the
# shared prelude; ANTHROPIC_API_KEY / COMPOSIO_API_KEY ride in from .env.local
# when present. Real GCIP (Firebase) sign-in — GW_DEV is deliberately NOT set.
# Boot migrations run against the pg pane's database, so wait for it first.
set -eu
. scripts/dev/env.sh

# The gateway serves /v1/catalog (and clamps models against it) from
# GW_CATALOG_PATH, falling back to a compiled-in snapshot that lags every pi
# bump. In the cluster the engine roll writes that file from the engine's own
# /v1/catalog; here the host pane IS the engine, so mirror its catalog. The
# gateway re-reads the file whenever its mtime changes, and the loop polls so a
# host restart with a new catalog lands too. `exec` keeps this shell's PID, so
# the loop ends with the gateway.
GW_CATALOG_PATH="${GW_CATALOG_PATH:-${HOUSTON_HOME:-$HOME/.dev-houston}/gateway-catalog.json}"
export GW_CATALOG_PATH
rm -f "$GW_CATALOG_PATH"
mirror_catalog() {
  gateway_pid=$1
  host_url="${VITE_NEW_ENGINE_URL:-http://127.0.0.1:4318}"
  tmp="$GW_CATALOG_PATH.next"
  while kill -0 "$gateway_pid" 2>/dev/null; do
    if curl -fsS -m 5 "$host_url/v1/catalog" -o "$tmp" 2>/dev/null &&
      ! cmp -s "$tmp" "$GW_CATALOG_PATH"; then
      mv "$tmp" "$GW_CATALOG_PATH"
      echo "[dev] gateway catalog mirrored from $host_url/v1/catalog"
    fi
    sleep 10
  done
  rm -f "$tmp"
}
mirror_catalog $$ &

wait_pg
cd "$CLOUD_DIR"
exec go run ./cmd/gateway
