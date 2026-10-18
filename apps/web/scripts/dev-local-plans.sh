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

echo "plans from : $PLANS"
echo "database   : $HOST"
echo "sheets stay on this machine; nothing is uploaded"
echo

DATABASE_URL="$LOCAL_DB" \
DIRECT_URL="$LOCAL_DB" \
TAKEOFF_LOCAL_PLAN_DIR="$PLANS" \
  exec npx next dev
