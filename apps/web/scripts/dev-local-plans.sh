#!/usr/bin/env bash
#
# ── THE DEV SERVER, POINTED AT A LOCAL DATABASE AND LOCAL PLAN FILES ──
#
# For reviewing a client's issued drawings. The sheets stay on this machine:
# the plan row records `local:<filename>` and the bytes are read from
# TAKEOFF_LOCAL_PLAN_DIR, so nothing is uploaded to blob storage and nothing
# is written to the demo project that preview deployments read.
#
# `scripts/dev-demo.sh` is the way back.
#
set -e
set -o pipefail

cd "$(dirname "$0")/.."

PLANS="${TAKEOFF_LOCAL_PLAN_DIR:-$HOME/Claude Folder/takeoff/real-plans}"
LABELS="${TAKEOFF_LABEL_DIR:-$HOME/Claude Folder/takeoff/labels}"
# ── THE PORT IS NAMED, BECAUSE AN UNNAMED ONE IS A WRONG LINK ──
#
# This had no -p, so it took Next's default 3000 while the instructions around
# it said 3001. The server was up the whole time and every check against 3001
# reported it dead — three separate "it keeps dying" diagnoses, a rebuilt
# .next, and an afternoon, for a port nobody had written down.
PORT="${PORT:-3000}"
LOCAL_DB="${LOCAL_DATABASE_URL:-postgresql://postgres@127.0.0.1:5432/prova_dev}"

# ── The two refusals, before anything starts ──
#
# A plan directory that does not exist gives a dev server that 404s every
# sheet with nothing to say why, and the misspelling is the likely cause.
if [ ! -d "$PLANS" ]; then
  echo "REFUSING: no plan directory at $PLANS" >&2
  echo "  set TAKEOFF_LOCAL_PLAN_DIR to the folder holding the PDFs." >&2
  exit 1
fi

# A remote host here is the whole failure this arrangement exists to avoid:
# a client's plan set recorded in a database that previews read.
HOST=$(printf '%s' "$LOCAL_DB" | sed -E 's#^[^:]+://([^@]*@)?([^:/?]+).*#\2#')
if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ]; then
  echo "REFUSING: LOCAL_DATABASE_URL points at '$HOST', not a local database." >&2
  echo "  Client plans must never be recorded anywhere a preview can read." >&2
  exit 1
fi

# ── THE LABEL FOLDER IS MADE, NOT DEMANDED ──
#
# `labelStore` refuses to write when TAKEOFF_LABEL_DIR is unset — correctly,
# because that is what keeps this inert in every deployment. But an estimator
# who gets that refusal is four hours into a sheet with nothing saved, and the
# cause is a variable this script could have set. Making the folder costs
# nothing and cannot be the wrong thing to do on a machine already holding the
# client's PDFs.
mkdir -p "$LABELS"

# ── BUILT=1 FOR A LABELLING SESSION, AND THE REASON IS MEASURED ──
#
# `next dev` recompiles whenever a source file changes, and a request that
# lands mid-compile waits for it. On 2026-10-20, while Claude in Chrome
# laboured through E Street 421, this server compiled FIFTY-SEVEN times —
# 11s, 19s, 48s, 108s, 126s — because somebody was editing the repo in another
# window. The labeller saw the plan take about twenty seconds to appear and
# two requests fail; the slowest response in the log is 63 SECONDS.
#
# Nothing in the app was wrong. A production build never recompiles, so a
# labelling session is immune to whatever anybody is editing:
#
#     BUILT=1 PORT=3001 ./scripts/dev-local-plans.sh
#
# It costs one build up front and makes the session independent of the tree.
# Use `next dev` when you are the one changing the code and want it reloaded.
MODE="${BUILT:-0}"

# ── THE BUILD THAT DREW THE CANDIDATES GOES INTO EVERY LABEL FILE ──
#
# A later finder does not produce the same candidate list: Camp Bow Wow A120's
# saved `21.7 ft / 3.8 in` had become `22.6 ft / 7.7 in` within days, and
# nothing in the file said which build had drawn it, so the mismatch read as a
# matching bug. `-dirty` is the load-bearing part rather than the commit id:
# labelling here nearly always runs from a worktree with uncommitted changes,
# so a bare SHA would name a finder that never ran.
if [ -z "${TAKEOFF_FINDER_VERSION:-}" ]; then
  if SHA=$(git rev-parse --short=12 HEAD 2>/dev/null); then
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then SHA="$SHA-dirty"; fi
    TAKEOFF_FINDER_VERSION="$SHA"
  else
    TAKEOFF_FINDER_VERSION="unknown"
  fi
fi
export TAKEOFF_FINDER_VERSION

echo "plans from : $PLANS"
echo "labels to  : $LABELS"
echo "port       : $PORT"
echo "database   : $HOST"
echo "finder     : $TAKEOFF_FINDER_VERSION"
echo "mode       : $([ "$MODE" = "1" ] && echo 'production build — no recompiles' || echo 'next dev — recompiles on every edit')"
echo "sheets stay on this machine; nothing is uploaded"
echo

if [ "$MODE" = "1" ]; then
  DATABASE_URL="$LOCAL_DB" \
  DIRECT_URL="$LOCAL_DB" \
  TAKEOFF_LOCAL_PLAN_DIR="$PLANS" \
  TAKEOFF_LABEL_DIR="$LABELS" \
  TAKEOFF_FINDER_VERSION="$TAKEOFF_FINDER_VERSION" \
    npx next build
fi

DATABASE_URL="$LOCAL_DB" \
DIRECT_URL="$LOCAL_DB" \
TAKEOFF_LOCAL_PLAN_DIR="$PLANS" \
TAKEOFF_LABEL_DIR="$LABELS" \
TAKEOFF_FINDER_VERSION="$TAKEOFF_FINDER_VERSION" \
  exec npx next "$([ "$MODE" = "1" ] && echo start || echo dev)" -p "$PORT"
