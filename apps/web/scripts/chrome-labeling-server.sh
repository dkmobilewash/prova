#!/usr/bin/env bash
#
# ── CHROME'S LABELLING SERVER, ON ITS OWN BUILD ──
#
#     ./scripts/chrome-labeling-server.sh
#
# Port 3010, its own build directory, the REAL labels folder. The point is
# that :3001 can be rebuilt whenever its smoke test passes without disturbing
# a labelling round — before this, both servers shared `.next` and rebuilding
# one made the other throw on every route.
#
# `SERVER_LOCK` guards THIS server now. Rebuild it only between rounds and
# only when the lock reads FREE.
#
set -e
set -o pipefail
cd "$(dirname "$0")/.."

PORT=3010 \
NEXT_DIST_DIR=.next-chrome \
BUILT=1 \
  exec bash scripts/dev-local-plans.sh
