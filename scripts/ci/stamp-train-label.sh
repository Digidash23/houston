#!/usr/bin/env bash
# Usage: stamp-train-label.sh <label> <commit> <message>
# Creates the annotated tag refs/tags/<label> at <commit> and pushes it to
# origin (override with TRAIN_LABEL_REMOTE). Run from the checkout.
#
# A train label is cosmetic: train.json on the release is the record of what
# shipped (see ship-train.yml). So this script NEVER fails the train: every
# refusal is a ::warning:: plus exit 0, and only a usage error exits non-zero.
#
# Outcome, appended to $GITHUB_OUTPUT when set as `stamped=` and `reason=`:
#   true       created and pushed now
#   unchanged  already points at <commit> (release re-published)
#   false      left alone: the label exists at ANOTHER commit (a train label
#              never moves), or the remote refused the push. The known refusal:
#              GITHUB_TOKEN has no `workflows` permission, and GitHub rejects
#              any ref push whose target commit's .github/workflows/* differ
#              from the default branch's, which is every image commit older
#              than a workflow change on main.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 <label> <commit> <message>" >&2
  exit 2
fi
LABEL="$1"
TARGET="$2"
MESSAGE="$3"
REMOTE="${TRAIN_LABEL_REMOTE:-origin}"

emit() { # <stamped> <reason>
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'stamped=%s\nreason=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
}

# One line, no newlines or `%`: GitHub parses annotation messages literally.
one_line() {
  sed -e 's/^remote: //' -e 's/^[[:space:]]*//' -e 's/%/%25/g' \
    | grep -v '^$' | tr '\n' ' ' | sed -e 's/ *$//'
}

if EXISTING=$(git rev-parse -q --verify "refs/tags/${LABEL}^{commit}" 2>/dev/null); then
  if [ "$EXISTING" = "$TARGET" ]; then
    echo "::notice::${LABEL} already points at ${TARGET} (release re-published), nothing to do."
    emit unchanged "already at ${TARGET}"
    exit 0
  fi
  REASON="${LABEL} already exists at ${EXISTING}, but this train resolves to ${TARGET}; a train label never moves"
  echo "::warning::${REASON}. Left untouched, investigate before re-tagging."
  emit false "$REASON"
  exit 0
fi

git config user.name "houston-release-bot"
git config user.email "release-bot@users.noreply.github.com"

if ! TAG_LOG=$(git tag -a "$LABEL" -m "$MESSAGE" "$TARGET" 2>&1); then
  REASON=$(printf '%s\n' "$TAG_LOG" | one_line || true)
  echo "::warning::${LABEL} not created at ${TARGET}: ${REASON}"
  emit false "$REASON"
  exit 0
fi

if PUSH_LOG=$(git push "$REMOTE" "refs/tags/${LABEL}" 2>&1); then
  echo "::notice::Stamped ${LABEL} at ${TARGET}"
  emit true pushed
  exit 0
fi

printf '%s\n' "$PUSH_LOG"
# Drop the local tag so a retry in the same checkout starts clean.
git tag -d "$LABEL" >/dev/null 2>&1 || true
REASON=$(printf '%s\n' "$PUSH_LOG" | one_line || true)
echo "::warning::${LABEL} not stamped at ${TARGET}: ${REASON}"
emit false "$REASON"
exit 0
