#!/usr/bin/env bash
#
# ── THE PRE-REBUILD SMOKE TEST ──
#
#     ./scripts/smoke-labeling.sh
#
# Builds the commit that is about to be deployed, runs it on its OWN port, and
# drives the labelling page in a real browser. The rebuild of the labelling
# server does not happen unless this passes.
#
# ── WHY IT EXISTS ──
#
# Every defect in the autosave work reached the person labelling before it
# reached a test: a re-detect wiping the sheet, a restore handler reading a
# null state, an autosave overwriting the draft it was offering, and a
# leave-page warning that trapped the tab after a successful save. Four in one
# afternoon, on a feature whose whole purpose is that a reviewer does not lose
# work. All four were invisible to 13,000 unit tests and obvious within a
# minute of driving the page.
#
# ── THE TWO THINGS THAT MAKE IT SAFE TO RUN WHILE SOMEBODY IS LABELLING ──
#
# 1. ITS OWN BUILD DIRECTORY. `next build` and `next start` share `.next` and
#    the build wins, so building here would take the labelling server down
#    mid-sheet. `NEXT_DIST_DIR` sends this build to `.next-smoke`.
# 2. ITS OWN LABEL FOLDER. This test SAVES, and a save writes a label file.
#    Pointed at the real folder it would overwrite a reviewed sheet with a
#    handful of decisions made by a script. The refusals below are not
#    ceremony: that folder holds work nobody can redo.
#
set -e
set -o pipefail

cd "$(dirname "$0")/.."

PORT="${SMOKE_PORT:-3002}"
DIST="${NEXT_DIST_DIR:-.next-smoke}"
PLANS="${TAKEOFF_LOCAL_PLAN_DIR:-$HOME/Claude Folder/takeoff/real-plans}"
LOCAL_DB="${LOCAL_DATABASE_URL:-postgresql://${PGUSER:-$USER}@127.0.0.1:5432/prova_dev}"
REAL_LABELS="$HOME/Claude Folder/takeoff/labels"
SMOKE_LABELS="${SMOKE_LABELS:-$(mktemp -d "${TMPDIR:-/tmp}/smoke-labels-XXXXXX")}"
# ── THE LOGS DO NOT LIVE IN THE LABEL FOLDER ──
#
# The driver walks that folder the way the real one is walked — a directory
# per plan set — and a `build.log` sitting in it is not a directory. The first
# full run died on ENOTDIR scanning its own output. A test that pollutes what
# it inspects is measuring itself.
SMOKE_LOGS="${SMOKE_LOGS:-$(mktemp -d "${TMPDIR:-/tmp}/smoke-logs-XXXXXX")}"

# ── REFUSALS, BEFORE ANYTHING IS BUILT OR STARTED ──
if [ "$PORT" = "3001" ]; then
  echo "REFUSING: :3001 is the labelling server. Use another port." >&2
  exit 1
fi
if [ "$DIST" = ".next" ]; then
  echo "REFUSING: building into .next would take the running server down mid-sheet." >&2
  exit 1
fi
case "$SMOKE_LABELS" in
  "$REAL_LABELS"|"$REAL_LABELS"/*)
    echo "REFUSING: SMOKE_LABELS is inside the real label folder ($SMOKE_LABELS)." >&2
    echo "  This test SAVES. That folder holds work nobody can redo." >&2
    exit 1
    ;;
esac
if [ ! -d "$PLANS" ]; then
  echo "REFUSING: no plan directory at $PLANS" >&2
  exit 1
fi
mkdir -p "$SMOKE_LABELS"

COMMIT=$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
echo "commit     : $COMMIT"
echo "port       : $PORT  (the labelling server on 3001 is not touched)"
echo "build dir  : $DIST"
echo "labels to  : $SMOKE_LABELS  (temporary)"
echo "logs to    : $SMOKE_LOGS"
echo

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

echo "── building ──"
NEXT_DIST_DIR="$DIST" \
DATABASE_URL="$LOCAL_DB" DIRECT_URL="$LOCAL_DB" \
TAKEOFF_LOCAL_PLAN_DIR="$PLANS" TAKEOFF_LABEL_DIR="$SMOKE_LABELS" \
  npx next build > "$SMOKE_LOGS/build.log" 2>&1 || {
    echo "BUILD FAILED — see $SMOKE_LABELS/build.log" >&2
    tail -20 "$SMOKE_LOGS/build.log" >&2
    exit 1
  }

echo "── starting on :$PORT ──"
NEXT_DIST_DIR="$DIST" \
DATABASE_URL="$LOCAL_DB" DIRECT_URL="$LOCAL_DB" \
TAKEOFF_LOCAL_PLAN_DIR="$PLANS" TAKEOFF_LABEL_DIR="$SMOKE_LABELS" \
ALLOW_LOCAL_PLANS=1 HOSTNAME=localhost TAKEOFF_FINDER_VERSION="$COMMIT-smoke" \
  npx next start -p "$PORT" -H localhost > "$SMOKE_LOGS/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:$PORT/sign-in"; then break; fi
  sleep 2
done
if ! curl -sf -o /dev/null "http://localhost:$PORT/sign-in"; then
  echo "SERVER DID NOT START — see $SMOKE_LABELS/server.log" >&2
  tail -20 "$SMOKE_LOGS/server.log" >&2
  exit 1
fi

echo "── driving the labelling page ──"
set +e
SMOKE_BASE="http://localhost:$PORT" SMOKE_LABELS="$SMOKE_LABELS" \
  node e2e/smoke-labeling.mjs
STATUS=$?
set -e

echo
if [ "$STATUS" -eq 0 ]; then
  echo "SMOKE PASSED on $COMMIT — safe to rebuild :3001"
else
  echo "SMOKE FAILED on $COMMIT — do NOT rebuild :3001" >&2
  echo "  server log: $SMOKE_LABELS/server.log" >&2
fi
exit "$STATUS"
