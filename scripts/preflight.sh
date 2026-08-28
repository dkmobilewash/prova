#!/usr/bin/env bash
#
# One command to run before you push. Replaces running test, typecheck,
# lint and build by hand and hoping you remembered all four.
#
# The important part is not the checks — CI runs three of them. It's the
# MIGRATION REPORT at the end.
#
# There is ONE Neon database, and Vercel runs `prisma migrate deploy` on
# every deployment, previews included. A migration therefore goes live
# against production WHEN YOU PUSH, not when the PR merges. That is not
# obvious from anything in the repo, it has already happened once
# (add_submittals reached production from an unmerged branch), and there
# was no warning anywhere before this script.
#
# Usage:
#   ./scripts/preflight.sh          # checks + migration report
#   ./scripts/preflight.sh --quick  # skip the build (the slow one)

set -e
set -o pipefail
rm -f .git/index.lock

# A failed build piped to `tee` once printed ALL GREEN. Never drop
# pipefail from this file.

cd "$(dirname "$0")/.."

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

BASE="${PREFLIGHT_BASE:-origin/main}"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

bold "== branch =="
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "on: $BRANCH"
if [ "$BRANCH" = "main" ]; then
  red "You are on main. Work goes on a branch."
  exit 1
fi

# The build has been killed at exit 137 (out of memory) more than once on
# this machine, which reads as a code failure and isn't one. Give node
# room up front instead of rediscovering it.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"

bold "== test =="
pnpm test

bold "== typecheck =="
pnpm typecheck

bold "== lint =="
pnpm lint

if [ "$QUICK" = "1" ]; then
  echo "(skipping build — --quick)"
else
  bold "== build =="
  # CI does NOT run build, and build is the only thing that catches the
  # `export *` inside a "use server" file class of breakage.
  pnpm build
fi

bold "== migrations that will hit PRODUCTION when you push =="

git fetch --quiet origin 2>/dev/null || true

MIGRATION_DIR="packages/db/prisma/schema/migrations"

# Committed migrations on this branch that the base branch doesn't have.
COMMITTED=$(git diff --name-only "$BASE"...HEAD -- "$MIGRATION_DIR" 2>/dev/null \
  | grep 'migration\.sql$' || true)

# Migrations not committed yet — they hit production on the push that
# carries them, so they belong in this report too.
UNCOMMITTED=$(git status --porcelain -- "$MIGRATION_DIR" 2>/dev/null \
  | awk '{print $2}' | grep -v 'migration_lock' || true)
if [ -n "$UNCOMMITTED" ]; then
  UNCOMMITTED=$(find $UNCOMMITTED -name 'migration.sql' 2>/dev/null || true)
fi

PENDING=$(printf '%s\n%s\n' "$COMMITTED" "$UNCOMMITTED" | grep . | sort -u || true)

if [ -z "$PENDING" ]; then
  green "none — this push does not touch the production schema"
else
  red "This push will run these against the PRODUCTION database:"
  echo "$PENDING" | while read -r f; do echo "  - $(dirname "${f#$MIGRATION_DIR/}")"; done
  echo

  # Additive migrations are safe to land from a branch. Destructive ones
  # are not: the preview deploy applies them to production before anyone
  # has reviewed the PR.
  DESTRUCTIVE=$(echo "$PENDING" | while read -r f; do
    [ -f "$f" ] || continue
    grep -inE '\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b' "$f" \
      | sed "s|^|  ${f#$MIGRATION_DIR/}:|" || true
  done)

  if [ -n "$DESTRUCTIVE" ]; then
    red "STOP — destructive statements found:"
    echo "$DESTRUCTIVE"
    echo
    red "Pushing this drops production data before the PR is reviewed."
    red "Ping Diego in #prova-build before pushing. Overriding this check"
    red "is a deliberate act: PREFLIGHT_ALLOW_DESTRUCTIVE=1 ./scripts/preflight.sh"
    [ "${PREFLIGHT_ALLOW_DESTRUCTIVE:-0}" = "1" ] || exit 1
  else
    green "all additive — no drops, truncates or deletes"
  fi
fi

echo
green "preflight passed"
