#!/bin/bash
# ── W2 SHIP TEST: "A WALL TYPE'S HEIGHT, ANSWERED ONCE", ON vs OFF (coordination/type-height-once.md, Amendment 2) ──
#
# Diego's job-level measure (2026-11-28): height answers needed per JOB, TRAINING only. Both arms in ONE script,
# identical env (sb3-baseline.sh's TRAINING env); the only difference is ZT_TYPE_HEIGHT_ONCE (0 = OFF). Ships iff the ON
# arm's answers are STRICTLY fewer than the OFF arm's AND REVIEWED-2MIN is not higher. The original's stop rule: the 2MIN
# headline must be BYTE-IDENTICAL across arms (the eval cannot execute the change) — if it differs, stop and report
# before reading the counts. The heavy slot is claimed per arm.
set -o pipefail
C="/Users/diego/Claude Folder/takeoff/coordination"
T="/Users/diego/Claude Folder/takeoff"
W="${EXAM_WORKTREE:-/Users/diego/prova/.claude/worktrees/diego-type-height-once}/apps/web"
SNAP="$T/labels-snap-20261126T1633Z-post44b"
O="$T/eval-out-w2-heights-ab"
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
  SLOT=$(bash "$C/heavylock.sh" claim fourth long "W2 heights A/B, arm $ARM (TRAINING)") || { echo "CLAIM FAILED for arm $ARM"; exit 9; }
  if [ "$ARM" = "off" ]; then export ZT_TYPE_HEIGHT_ONCE=0; else unset ZT_TYPE_HEIGHT_ONCE; fi
  echo "=== ARM $ARM (ZT_TYPE_HEIGHT_ONCE=${ZT_TYPE_HEIGHT_ONCE-unset}) slot $SLOT $(date -u +%H:%M:%SZ) ==="
  ZT_OUT="$O/zt-train-$ARM.json" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzZeroTouch.eval.ts > "$O/train-$ARM.log" 2>&1
  echo "$ARM vitest=$?"
  bash "$C/heavylock.sh" release fourth "$SLOT"
  grep -aE "^ZTENV" "$O/train-$ARM.log" | head -3
  grep -aE "^(ZT2MIN|ZTHONCE) TRAINING (TOTAL|HEIGHT)" "$O/train-$ARM.log"
done
echo "=== JUDGING (type-height-once.md) ==="
python3 - "$O" <<'PY'
import re, sys
O = sys.argv[1]
def read(arm):
    t = open(f"{O}/train-{arm}.log", errors="ignore").read()
    two = re.search(r"^ZT2MIN TRAINING TOTAL ERROR .*$", t, re.M)
    h = re.search(r"^ZTHONCE TRAINING HEIGHT ANSWERS PER JOB: off (\d+) · on (\d+) — (\d+) jobs counted .*?types merge-eligible (\d+) .*?unknown -> OFF (\d+) .*?to-structure -> OFF (\d+)", t, re.M)
    if not two or not h: print(f"VOID: arm {arm} printed no ZT2MIN/ZTHONCE TRAINING line"); sys.exit(1)
    return two.group(0), [int(x) for x in h.groups()]
(t0, h0), (t1, h1) = read("off"), read("on")
if t0 != t1:
    print("STOP (the original's rule): the 2MIN headline DIFFERS across arms, so the eval executes the change. Counts NOT read.")
    print(" off:", t0); print(" on: ", t1); sys.exit(2)
print("2MIN headline byte-identical across arms (expected by construction; not used as evidence).")
if h0[0] != h1[0] or h0[2] != h1[2]: print(f"VOID: arms counted different items/jobs (off arm {h0}, on arm {h1})"); sys.exit(1)
off, on = h0[1], h1[1]
print(f"height answers per job (TRAINING, {h1[2]} jobs, {h1[0]} level items): OFF {off} -> ON {on} — {'PASS (strictly fewer)' if on < off else 'FAIL'}")
print(f"denominators: merge-eligible types {h1[3]} · unknown->OFF {h1[4]} · to-structure->OFF {h1[5]}")
if h1[3] < 5: print(f"NOTE: only {h1[3]} merge-eligible types — the result rests on a handful (the original's condition 3).")
print("W2 HEIGHTS SHIP VERDICT:", "SHIPS" if on < off else "DOES NOT SHIP")
PY
echo "=== W2 HEIGHTS A/B COMPLETE ==="
