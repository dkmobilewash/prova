#!/usr/bin/env bash
#
# ── REHEARSE THE PENDING MIGRATIONS ON A NEON BRANCH, NOT ON PRODUCTION ──
#
#   bash packages/db/scripts/rehearse-on-branch.sh
#
# Run this in YOUR OWN Terminal. It asks for a Neon BRANCH connection string,
# applies every pending migration to it through `migrate-deploy.mjs`, and
# prints what happened. Nothing else.
#
# ── WHAT IT DOES WITH THE STRING YOU PASTE ──
#
# Read with `read -rs`, so it is NOT echoed as you type and NOT added to your
# shell history. It lives in a variable for the length of one command and is
# never written to a file, a log or an argument list — `ps` shows arguments,
# so it is exported into the child's environment instead of passed as one.
# The only thing printed is the HOST, because knowing which database you just
# migrated is the entire point.
#
# ── WHY A BRANCH AND NEVER PRODUCTION ──
#
# A Neon branch is a copy-on-write copy of production's data, so a migration
# that would fail on the real rows fails here too — which is what a rehearsal
# is for — and a mistake costs nothing. `migrate-deploy.mjs` prints the host
# before it acts and refuses when the two URLs disagree; this script adds the
# one check that script cannot make, which is whether you MEANT production.
#
set -e
set -o pipefail
cd "$(dirname "$0")/../../.."

echo "── Neon branch rehearsal ──"
echo
echo "In Neon: create a branch from production, then copy its DIRECT connection"
echo "string (not the -pooler one — migrate cannot run through a pooler)."
echo
printf 'Paste the branch DIRECT connection string (not shown as you type): '
read -rs BRANCH_URL
echo
echo

if [ -z "$BRANCH_URL" ]; then
  echo "Nothing pasted. Stopping."
  exit 1
fi

# The host, for your eyes, so you can see what you are about to migrate.
HOST=$(printf '%s' "$BRANCH_URL" | sed -E 's|^[^@]*@([^/?]+).*|\1|')
echo "host: $HOST"

# ── THE GUARD THIS SCRIPT EXISTS FOR ──
#
# A Neon branch endpoint is a different host from production's. Production is
# ep-little-sea; if that name appears, the string is production's and no
# rehearsal is worth that risk.
case "$HOST" in
  *ep-little-sea*)
    echo
    echo "REFUSING: that is PRODUCTION (ep-little-sea), not a branch."
    echo "Create a branch in Neon and paste the branch's own string."
    exit 1
    ;;
esac

echo
printf 'Migrate %s? Type yes to continue: ' "$HOST"
read -r CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Stopping. Nothing was applied."
  exit 1
fi

echo
echo "── applying ──"
# Both URLs the same on purpose: this is the DIRECT endpoint, and
# `migrate-deploy.mjs` refuses when the two resolve to different databases.
# Exported rather than passed as arguments, so the string never appears in
# the process list.
export DATABASE_URL="$BRANCH_URL"
export DIRECT_URL="$BRANCH_URL"
START=$(date +%s)
pnpm --filter @prova/db run migrate:deploy
END=$(date +%s)

echo
echo "── done in $((END - START))s ──"
echo "Read the list above: every pending migration should be named as applied,"
echo "and the status read back at the end should say no migrations pending."
