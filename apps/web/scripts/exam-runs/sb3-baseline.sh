#!/bin/bash
# ── SCOREBOARD V3 BASELINE (prereg-scoreboard-v3.md; Walls v1.0 Finish Plan W1, due Dec 3) ──
#
# Run ONCE on main after the v3 instrument merges. Snapshot: the post-44b cut,
# identified by its HASH (bb486066b7578355). True production env, proven by the
# ZTENV banner. Writes the DISPUTE DUMP the blind truth audit is generated from
# (truth-audit-design.md) — truncated first, so a re-run cannot double-append.
set -o pipefail
C="/Users/diego/Claude Folder/takeoff/coordination"
T="/Users/diego/Claude Folder/takeoff"
W="${EXAM_WORKTREE:-/Users/diego/prova/.claude/worktrees/diego-model-census}/apps/web"
SNAP="${SB3_SNAP:-$T/labels-snap-20261126T1633Z-post44b}"   # truth-audit restatement: SB3_SNAP + SB3_HASH name the corrected snapshot
WANT="${SB3_HASH:-bb486066b7578355}"
O="${SB3_OUT:-$T/eval-out-sb3-baseline}"   # amendment 5 restatement: SB3_OUT=$T/eval-out-sb3-baseline-scope5
mkdir -p "$O"
H=$(cd "$SNAP" && find . -type f | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-16)
[ "$H" = "$WANT" ] || { echo "SNAPSHOT HASH MISMATCH: $H != $WANT — refusing"; exit 1; }
SLOT=$(bash "$C/heavylock.sh" claim original long "SCOREBOARD V3 BASELINE (prereg-scoreboard-v3.md)" | grep -oE 'HEAVY_LOCK_[12]' | tail -1)
[ -n "$SLOT" ] || { echo "no heavy slot free"; exit 1; }
trap 'bash "$C/heavylock.sh" release original "$SLOT"' EXIT
cd "$W"
{ git -C "$W" log --oneline -1; git -C "$W" status --short | head -5; echo "snapshot $SNAP hash $H"; shasum "$T/heights-key/heights-key-r22.json"; } > "$O/head.txt"
export REAL_PLAN_DIR="$T/real-plans" REAL_PLAN_DIR2="$T/real-plans/new"
export TAKEOFF_LABEL_DIR="$SNAP"
export TAKEOFF_WALL_MODEL="$W/models/wall-model.json"
export TAKEOFF_WALL_RUN_MODEL="$W/models/wall-run-model.json"
export TAKEOFF_WALL_RENO_MODEL="$W/models/wall-reno-model.json"
export TAKEOFF_WALL_RENO_ALL_MODEL="$W/models/wall-reno-all-model.json"
export TAKEOFF_RENO_UNPAIRED=1 NEXT_PUBLIC_TAKEOFF_NOT_DRAWING=1
unset TAKEOFF_NOT_DRAWING ZT_JUNKDUMP
export ZT_HEIGHTS="$T/heights-key/heights-key-r22.json"
export ZT_LEGEND_CACHE="$T/legend-cache"
export NODE_OPTIONS=--max-old-space-size=8192
unset LEGEND_TEXT_READ TAKEOFF_UNIT_LABEL_GUARD TAKEOFF_SYMBOL_CODES TAKEOFF_UNO_DEFAULT TAKEOFF_TYPE_HEIGHTS TAKEOFF_VIEW_ROWS ZT_WALL_TYPES_FILE
export ZT_DISPUTE_DUMP="$O/dispute.jsonl"
rm -f "$ZT_DISPUTE_DUMP"
echo "=== SB3 BASELINE HELD-OUT ==="
ZT_HELD=1 ZT_OUT="$O/zt-held.json" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzZeroTouch.eval.ts > "$O/held-full.log" 2>&1
echo "held vitest=$?"
grep -aE "^ZTENV" "$O/held-full.log" | head -9
grep -aE "^(ZT2MIN|ZTACT|ZTHGT|ZTREV|ZT) HELD-OUT (TOTAL|ACTIONS|height)" "$O/held-full.log"
# A held-out-only key correction leaves every training input unchanged: SB3_HELD_ONLY=1 stops here.
[ "${SB3_HELD_ONLY:-}" = "1" ] && { echo "dispute rows: $(wc -l < "$ZT_DISPUTE_DUMP")"; echo "=== SB3 BASELINE COMPLETE (held-out only) ==="; exit 0; }
echo "=== SB3 BASELINE TRAINING ==="
export ZT_ZONE_KEYS="Joplin-community-center.pdf=$C/joplin-room-parts-key.md,BUNKIE-BID-DRAWINGS.pdf=$C/bunkie-room-parts-key.md,SW-Grand-Junction-CO.pdf=$C/sw-room-parts-key.md"
ZT_OUT="$O/zt-train.json" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzZeroTouch.eval.ts > "$O/train-full.log" 2>&1
echo "train vitest=$?"
grep -aE "^(ZT2MIN|ZTACT|ZTHGT|ZTREV|ZT) TRAINING (TOTAL|ACTIONS|height)" "$O/train-full.log"
echo "dispute rows: $(wc -l < "$ZT_DISPUTE_DUMP")"
echo "=== SB3 BASELINE COMPLETE ==="
