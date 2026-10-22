#!/usr/bin/env bash
#
# ── THE ORDINARY DEV SERVER: the demo database, no local plan files ──
#
# The way back from `scripts/dev-local-plans.sh`. It reads `.env` exactly as a
# plain `pnpm dev` does, and sets TAKEOFF_LOCAL_PLAN_DIR to nothing so a local
# plan left over from a review session cannot be served by accident.
#
set -e
set -o pipefail

cd "$(dirname "$0")/.."

# Empty rather than unset: `localPlanFile.ts` returns null before looking at
# anything when this is not a directory, which is the state every deployment
# is in.
TAKEOFF_LOCAL_PLAN_DIR="" exec npx next dev
