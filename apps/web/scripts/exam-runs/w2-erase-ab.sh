#!/bin/bash
# ── W2 SHIP TEST: "ERASE WALLS IN THIS AREA", ON vs OFF (prereg-scoreboard-v3.md "W2 ship test"; erase-area-tool.md) ──
#
# The exam3-r-ab.sh pattern: both arms in ONE script, identical env (sb3-baseline.sh's TRAINING env), the ONLY difference
# being ZT_ERASE (0 = the move OFF; unset = ON, the erase boxes zzZeroTouch builds with the product's eraseInBoxes).
# TRAINING only: held-out is never used for a ship decision. Ships iff TRAINING median actions-to-exact is STRICTLY
# lower AND TRAINING REVIEWED-2MIN total error is NOT higher. The heavy slot is claimed per arm (one run, one claim).
set -o pipefail
C="/Users/diego/Claude Folder/takeoff/coordination"
T="/Users/diego/Claude Folder/takeoff"
W="${EXAM_WORKTREE:-/Users/diego/prova/.claude/worktrees/diego-ops}/apps/web"
SNAP="$T/labels-snap-20261126T1633Z-post44b"
O="$T/eval-out-w2-erase-ab"
mkdir -p "$O"
H=$(cd "$SNAP" && find . -type f | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-16)
[ "$H" = "bb486066b7578355" ] || { echo "SNAPSHOT HASH MISMATCH: $H != bb486066b7578355 — refusing"; exit 1; }
{ git -C "$W" log --oneline -1; git -C "$W" status --short | head -5; echo "snapshot $SNAP hash $H"; } > "$O/head.txt"
cd "$W"
export REAL_PLAN_DIR="$T/real-plans" REAL_PLAN_DIR2="$T/real-plans/new"
export TAKEOFF_LABEL_DIR="$SNAP"
export TAKEOFF_WALL_MODEL="$W/models/wall-model.json"
export TAKEOFF_WALL_RUN_MODEL="$W/models/wall-run-model.json"
export TAKEOFF_WALL_RENO_MODEL="$W/models/wall-reno-model.json"
export TAKEOFF_WALL_RENO_ALL_MODEL="$W/models/wall-reno-all-model.json"
export TAKEOFF_RENO_UNPAIRED=1 NEXT_PUBLIC_TAKEOFF_NOT_DRAWING=1
unset TAKEOFF_NOT_DRAWING ZT_JUNKDUMP ZT_DISPUTE_DUMP ZT_HELD
export ZT_HEIGHTS="$T/heights-key/heights-key-r22.json"
export ZT_LEGEND_CACHE="$T/legend-cache"
export NODE_OPTIONS=--max-old-space-size=8192
unset LEGEND_TEXT_READ TAKEOFF_UNIT_LABEL_GUARD TAKEOFF_SYMBOL_CODES TAKEOFF_UNO_DEFAULT TAKEOFF_TYPE_HEIGHTS TAKEOFF_VIEW_ROWS ZT_WALL_TYPES_FILE
export ZT_ZONE_KEYS="Joplin-community-center.pdf=$C/joplin-room-parts-key.md,BUNKIE-BID-DRAWINGS.pdf=$C/bunkie-room-parts-key.md,SW-Grand-Junction-CO.pdf=$C/sw-room-parts-key.md"
for ARM in off on; do
  rm -f "$O/train-$ARM.log" "$O/zt-train-$ARM.json"
  SLOT=$(bash "$C/heavylock.sh" claim fourth long "W2 erase A/B, arm $ARM (TRAINING)") || { echo "CLAIM FAILED for arm $ARM"; exit 9; }
  if [ "$ARM" = "off" ]; then export ZT_ERASE=0; else unset ZT_ERASE; fi
  echo "=== ARM $ARM (ZT_ERASE=${ZT_ERASE-unset}) slot $SLOT $(date -u +%H:%M:%SZ) ==="
  ZT_OUT="$O/zt-train-$ARM.json" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzZeroTouch.eval.ts > "$O/train-$ARM.log" 2>&1
  echo "$ARM vitest=$?"
  bash "$C/heavylock.sh" release fourth "$SLOT"
  grep -aE "^ZTENV" "$O/train-$ARM.log" | head -3
  grep -aE "^(ZT2MIN|ZTACT) TRAINING (TOTAL|ACTIONS)" "$O/train-$ARM.log"
done
echo "=== JUDGING (prereg-scoreboard-v3.md W2 ship test) ==="
python3 - "$O" <<'PY'
import re, sys
O = sys.argv[1]
def read(arm):
    t = open(f"{O}/train-{arm}.log", errors="ignore").read()
    med = re.search(r"^ZTACT TRAINING ACTIONS TO EXACT: median ([0-9.]+) per sheet .*? over (\d+) sheets", t, re.M)
    err = re.search(r"^ZT2MIN TRAINING TOTAL ERROR ([0-9.]+)%", t, re.M)
    if not med or not err: print(f"VOID: arm {arm} printed no ZTACT/ZT2MIN TRAINING line"); sys.exit(1)
    return float(med.group(1)), int(med.group(2)), float(err.group(1))
(m0, n0, e0), (m1, n1, e1) = read("off"), read("on")
if n0 != n1: print(f"VOID: sheet counts differ, off {n0} vs on {n1}"); sys.exit(1)
a = m1 < m0; b = e1 <= e0
print(f"median actions-to-exact (TRAINING, {n0} sheets): off {m0} -> on {m1} — {'PASS (strictly lower)' if a else 'FAIL'}")
print(f"REVIEWED-2MIN total error (TRAINING): off {e0}% -> on {e1}% — {'PASS (not higher)' if b else 'FAIL'}")
print("W2 ERASE SHIP VERDICT:", "SHIPS" if (a and b) else "DOES NOT SHIP")
PY
echo "=== W2 ERASE A/B COMPLETE ==="
