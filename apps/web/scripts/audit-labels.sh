#!/usr/bin/env bash
#
# ── AUDIT THE SAVED LABEL FILES ──
#
#     ./scripts/audit-labels.sh              # every sheet
#     ./scripts/audit-labels.sh E_Street     # one set
#     ./scripts/audit-labels.sh E_Street/A2.1
#
# READ-ONLY. It opens label files and writes nothing — the one thing an audit
# must never do is edit what it is auditing. It needs no database, no PDF and
# no server, so it is safe to run while somebody is labelling the next sheet,
# which is when it is wanted.
#
# What it flags, and why each one costs something:
#
#   overlapping accepts   the estimate bills the same feet twice, and both
#                         runs look right on their own
#   trace over an accept  double-counted KEY footage, which inflates a
#                         held-out score in the flattering direction
#   undecided             candidates nobody judged become confident NEGATIVES
#                         in training if the sheet is marked complete
#   not sure              reported with footage; excluded from training
#   scale                 accepted feet against the sheet's own width. A scale
#                         wrong by ten does not look wrong on screen — every
#                         wall is still a wall — and only the total gives it
#                         away
#   finder                `-dirty`, missing, or different from the build now
#                         running: rows built by a finder nobody can get back
#
set -e
set -o pipefail

cd "$(dirname "$0")/.."

LABELS="${TAKEOFF_LABEL_DIR:-$HOME/Claude Folder/takeoff/labels}"
if [ ! -d "$LABELS" ]; then
  echo "REFUSING: no label directory at $LABELS" >&2
  exit 1
fi

# The finder version is computed the same way the server computes it, so
# "differs from the build now running" compares like with like.
if [ -z "${TAKEOFF_FINDER_VERSION:-}" ]; then
  if SHA=$(git rev-parse --short=12 HEAD 2>/dev/null); then
    if [ -n "$(git status --porcelain -- ../../apps/web ../../packages 2>/dev/null | grep -v "^??")" ]; then
      SHA="$SHA-dirty"
    fi
    TAKEOFF_FINDER_VERSION="$SHA"
  else
    TAKEOFF_FINDER_VERSION="unknown"
  fi
fi
export TAKEOFF_FINDER_VERSION

TAKEOFF_LABEL_DIR="$LABELS" AUDIT_ONLY="${1:-}" \
  npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzAudit.eval.ts
