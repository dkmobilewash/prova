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

echo "plans from : $PLANS"
echo "labels to  : $LABELS"
echo "port       : $PORT"
echo "database   : $HOST"
echo "sheets stay on this machine; nothing is uploaded"
echo

DATABASE_URL="$LOCAL_DB" \
DIRECT_URL="$LOCAL_DB" \
TAKEOFF_LOCAL_PLAN_DIR="$PLANS" \
TAKEOFF_LABEL_DIR="$LABELS" \
  exec npx next dev -p "$PORT"
