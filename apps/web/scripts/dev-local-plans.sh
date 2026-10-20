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
# ── LOOPBACK, AND THE SAME VALUE REACHES THE GUARD AND THE BIND ──
#
# `localPlanFile.ts` lets a PRODUCTION build read local plan files only when
# the server is bound to loopback, and it reads HOSTNAME to decide. That is
# the same variable passed to `next -H` below, so the check and the actual
# bind cannot disagree: setting one sets both. Client drawings are on this
# disk; a server reachable from the network has no business serving them.
# ── AND IT IS NOT NAMED `HOSTNAME` AT THE DOOR, BECAUSE THE SHELL SETS THAT ──
#
# `${HOSTNAME:-127.0.0.1}` inherits zsh's own HOSTNAME, which is the machine
# name: the first run of this printed `bind : Diegos-MacBook-Pro.local`, which
# binds a LAN-reachable interface AND fails the loopback check, so the server
# would have come up unable to open a drawing for a second reason. Caught by
# printing the value rather than by anything failing.
# `localhost`, NOT `127.0.0.1`. Binding the literal IPv4 address makes Next's
# own internal proxy fail: it dials `http://localhost:3001`, which resolves to
# `::1` first on this machine, finds nothing listening and returns 500 for
# EVERY request — `Failed to proxy ... ECONNREFUSED` in the log. `localhost`
# binds the loopback names the proxy and the labeller both use, and still
# satisfies the loopback check in `localPlanFile.ts`.
TAKEOFF_BIND="${TAKEOFF_BIND:-localhost}"
HOSTNAME="$TAKEOFF_BIND"
export HOSTNAME
# ── THE DEFAULT USER IS WHOEVER IS RUNNING THIS, NOT `postgres` ──
#
# It said `postgres` for months and that role DOES NOT EXIST on the machine
# this runs on — Homebrew's postgres creates a role named after the user. It
# never showed because everybody exported LOCAL_DATABASE_URL and the default
# was dead code, until 2026-10-20 when a labelling server was started without
# it. See the refusal below for what that cost.
LOCAL_DB="${LOCAL_DATABASE_URL:-postgresql://${PGUSER:-$USER}@127.0.0.1:5432/prova_dev}"

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

# ── AND THE CONNECTION IS TRIED BEFORE THE SERVER STARTS ──
#
# A database the app cannot authenticate against is not a slow page or a bad
# sheet: every request 500s with `PrismaClientInitializationError: User was
# denied access`, which reaches the labeller as "Something went wrong reading
# your data" and a reference number. On 2026-10-20 that looked like a problem
# with one plan set, because it happened to be the sheet they opened next, and
# the real cause was a database user that does not exist.
#
# Nothing downstream can tell those apart. So the connection is made HERE,
# where the failure can name the user, and the server does not start without
# one. Checked with psql when it is installed; when it is not, say so rather
# than imply the check passed.
if command -v psql >/dev/null 2>&1; then
  if ! DB_ERR=$(psql "$LOCAL_DB" -tAc 'select 1' 2>&1); then
    echo "REFUSING: cannot connect to the local database." >&2
    echo "  $DB_ERR" >&2
    echo "  url user : $(printf '%s' "$LOCAL_DB" | sed -E 's#^[^:]+://([^:@/]*).*#\1#')" >&2
    echo "  set LOCAL_DATABASE_URL to a role that exists, e.g." >&2
    echo "    LOCAL_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/prova_dev" >&2
    echo "  Every page would 500 with \"Something went wrong reading your data\"." >&2
    exit 1
  fi
else
  echo "note: psql not installed, so the database connection was NOT checked" >&2
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
    # ── DIRTY MEANS "THE BUILD DIFFERS FROM THE COMMIT", NOT "THE TREE DOES" ──
    #
    # A whole-repo `git status` answers the wrong question. On 2026-10-20 it
    # reported dirty because of 92 BENCH FIXTURES under `reports/` — PDFs and
    # answer keys that nothing compiles — so every label file was stamped
    # `-dirty` while the app bundle corresponded exactly to its commit. A
    # warning that fires when nothing is wrong is one nobody reads.
    #
    # So the question is scoped to what a Next build actually reads, and to
    # TRACKED files: an untracked file changes the build only if something
    # imports it, and this repo deliberately keeps scratch modules out of the
    # tree (`openingEvidence.ts`, see `lib/takeoff/NOTES.md`).
    #
    # The untracked ones are PRINTED rather than ignored silently, so the
    # claim stays falsifiable: if one of them is in the bundle, the list is
    # where somebody notices.
    if [ -n "$(git status --porcelain -- ../../apps/web ../../packages 2>/dev/null | grep -v "^??")" ]; then
      SHA="$SHA-dirty"
    fi
    TAKEOFF_FINDER_VERSION="$SHA"
    UNTRACKED=$(git status --porcelain -- ../../apps/web ../../packages 2>/dev/null | grep "^??" | sed "s/^?? //" || true)
  else
    TAKEOFF_FINDER_VERSION="unknown"
  fi
fi
export TAKEOFF_FINDER_VERSION

# ── THE OPT-IN THAT MAKES local: PLANS READABLE IN A BUILT SERVER ──
#
# `next start` always sets NODE_ENV=production, and `localPlanFile.ts` refused
# a production build outright until 2026-10-20 — so BUILT=1 produced a server
# that loaded every page and could not open a single DRAWING. Eighteen sheets
# failed that way while a check that only looked at the page reported them
# fine.
#
# This variable exists for nothing else and no deployment sets it. It is one
# of four conditions; the others are the loopback bind above, the plan
# directory, and the absence of any VERCEL variable.
ALLOW_LOCAL_PLANS=1
export ALLOW_LOCAL_PLANS

echo "plans from : $PLANS"
echo "labels to  : $LABELS"
echo "port       : $PORT"
echo "database   : $HOST"
echo "bind       : $HOSTNAME (loopback is required for local plans)"
echo "finder     : $TAKEOFF_FINDER_VERSION"
if [ -n "${UNTRACKED:-}" ]; then
  echo "untracked under the build inputs, NOT counted in the finder version:"
  printf '             %s\n' $UNTRACKED
  echo "             (if one of these is imported, the version above is a lie)"
fi
echo "mode       : $([ "$MODE" = "1" ] && echo 'production build — no recompiles' || echo 'next dev — recompiles on every edit')"
echo "sheets stay on this machine; nothing is uploaded"
echo

if [ "$MODE" = "1" ]; then
  DATABASE_URL="$LOCAL_DB" \
  DIRECT_URL="$LOCAL_DB" \
  TAKEOFF_LOCAL_PLAN_DIR="$PLANS" \
  TAKEOFF_LABEL_DIR="$LABELS" \
  TAKEOFF_FINDER_VERSION="$TAKEOFF_FINDER_VERSION" \
  ALLOW_LOCAL_PLANS="$ALLOW_LOCAL_PLANS" \
    npx next build
fi

DATABASE_URL="$LOCAL_DB" \
DIRECT_URL="$LOCAL_DB" \
TAKEOFF_LOCAL_PLAN_DIR="$PLANS" \
TAKEOFF_LABEL_DIR="$LABELS" \
TAKEOFF_FINDER_VERSION="$TAKEOFF_FINDER_VERSION" \
ALLOW_LOCAL_PLANS="$ALLOW_LOCAL_PLANS" \
  exec npx next "$([ "$MODE" = "1" ] && echo start || echo dev)" -p "$PORT" -H "$HOSTNAME"
