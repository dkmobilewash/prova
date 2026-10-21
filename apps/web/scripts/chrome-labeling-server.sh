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

# ── THE HATCH PITCH RULE IS ON HERE AND NOWHERE ELSE ──
#
# Only an evenly-pitched field counts as hatching, which recovers 15,921 ft of
# the 16,530 ft of confirmed wall the hatch class used to withhold, and offers
# 49,419 ft of junk in exchange. That is the right trade for a reviewer who
# judges every line and the wrong one for a customer, who would see that junk
# presented as walls — so it is on for labelling and off for the product until
# "demote, don't hide" ships.
PORT=3010 \
NEXT_DIST_DIR=.next-chrome \
NEXT_PUBLIC_TAKEOFF_HATCH_PITCH=1 \
BUILT=1 \
  exec bash scripts/dev-local-plans.sh
