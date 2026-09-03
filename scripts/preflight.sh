#!/usr/bin/env bash
#
# One command to run before you push. Replaces running test, typecheck,
# lint and build by hand and hoping you remembered all four.
#
# The important part is not the checks — CI runs all four. It's the
# MIGRATION REPORT at the end.
#
# THIS HEADER WAS WRONG until now, and wrong in the direction that gets
# someone hurt. It said there is one Neon database and that Vercel runs
# `prisma migrate deploy` on every deployment, so a migration goes live
# when you PUSH. Neither has been true for weeks:
#
#   - There are TWO Neon projects, one per person. See CLAUDE.md.
#   - Migrations are applied by .github/workflows/migrate.yml on merge to
#     main (#28). They no longer run in the Vercel build at all, because
#     that gate could not see a promoted preview.
#
# So a migration reaches production when the PR MERGES. The report below
# still earns its place — it names what a merge will apply and refuses
# destructive statements — but the timing it warns about had drifted from
# the thing it warns about, in the one file whose job is preventing drift.
#
# Usage:
#   ./scripts/preflight.sh          # checks + migration report
#   ./scripts/preflight.sh --quick  # skip the build (the slow one)

set -e
set -o pipefail

# NOT `rm -f .git/index.lock`, which is what this was until 2026-09-02 and
# which made this entire script a no-op inside a git worktree.
#
# In a worktree, `.git` is a FILE containing `gitdir: …`, not a directory.
# So `.git/index.lock` is ENOTDIR, and `-f` suppresses "no such file" but
# NOT "not a directory" — rm returns 1, `set -e` above fires, and the
# script dies here having run nothing. Total observed output:
#
#     $ ./scripts/preflight.sh --quick
#     rm: .git/index.lock: Not a directory
#
# No branch check, no test, no lint, no typecheck, no build, and no
# migration report — which is the part this script exists for. It reads
# like a stray warning from a run that carried on, which is the same
# failure shape as a green PR check that never ran.
#
# `git rev-parse --git-path` resolves correctly in both a normal checkout
# and a worktree, so this form works everywhere the old one did and also
# where it did not.
rm -f "$(git rev-parse --git-path index.lock)"

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

# Regenerate the Prisma client before anything reads it.
#
# The generated client lives in node_modules and does NOT follow a branch
# switch. Check out a branch whose schema has a model yours doesn't and
# typecheck fails with "Property 'equipmentAssignment' does not exist"
# while the schema is perfectly fine — two confusing runs for Cyrus.
#
# The failing direction is merely annoying. The other one is not: switch
# from a branch WITH a model to one without, and a stale client still has
# it, so code referencing a model this branch cannot see typechecks
# green. A check that can pass spuriously is worth less than no check.
bold "== prisma generate =="
pnpm --filter @prova/db exec prisma generate

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
  # CI DOES run build — 32ea10a added it with the workflow itself, and
  # CLAUDE.md corrected this claim once already. It stays here because
  # build is the only thing that catches `export *` inside a "use server"
  # file, and finding that before you push beats finding it in CI.
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
