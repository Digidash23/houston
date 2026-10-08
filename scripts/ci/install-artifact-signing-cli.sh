#!/usr/bin/env bash
# Install the pinned artifact-signing-cli (Azure Artifact Signing, formerly
# Trusted Signing) that release.yml wires into Tauri's `bundle.windows.signCommand`.
#
# This file is the single pin. Both release.yml and release-cache-warm.yml key
# the cached binary on this script's hash, so bumping the version here warms a
# new cache on the next main push and invalidates the old one on the next tag.
# `--locked` builds from the crate's own Cargo.lock, with crates.io checksums
# verified by cargo; the cached binary is the output of exactly this command.
set -euo pipefail

ARTIFACT_SIGNING_CLI_VERSION="0.11.0"

cargo install artifact-signing-cli --version "$ARTIFACT_SIGNING_CLI_VERSION" --locked
artifact-signing-cli --help > /dev/null
echo "artifact-signing-cli $ARTIFACT_SIGNING_CLI_VERSION installed at $(command -v artifact-signing-cli)"
