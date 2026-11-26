#!/bin/bash
# ── EXAM 3 TRUE-ENV RE-RUN (prereg-exam3-true-env.md, run 5a) ──
#
# Committed per Diego's env-audit order: every exam/verdict command is a committed
# file, never an inline command. The 2026-11-25 exam exported the bare
# TAKEOFF_NOT_DRAWING, which nothing reads; this is the same run with the flag the
# code actually reads (offeredCandidates.ts: NEXT_PUBLIC_TAKEOFF_NOT_DRAWING).
# The ZTENV banner at the top of the log is the proof of what ran.
#
# Operator paths (Diego's machine): the plan/label/key folders live outside the repo.
set -o pipefail
C="/Users/diego/Claude Folder/takeoff/coordination"
T="/Users/diego/Claude Folder/takeoff"
W="${EXAM_WORKTREE:-/Users/diego/prova/.claude/worktrees/diego-model-census}/apps/web"
O="$T/eval-out-exam3-trueenv"
mkdir -p "$O"
SLOT=$(bash "$C/heavylock.sh" claim original long "EXAM 3 TRUE-ENV re-run (prereg-exam3-true-env.md 5a)" | grep -oE 'HEAVY_LOCK_[12]' | tail -1)
[ -n "$SLOT" ] || { echo "no heavy slot free"; exit 1; }
trap 'bash "$C/heavylock.sh" release original "$SLOT"' EXIT
cd "$W"
{ git -C "$W" log --oneline -1; git -C "$W" status --short | head -5; shasum "$T/heights-key/heights-key-r22.json"; } > "$O/head.txt"
export REAL_PLAN_DIR="$T/real-plans" REAL_PLAN_DIR2="$T/real-plans/new"
export TAKEOFF_LABEL_DIR="$T/labels-snap-20261125T1900Z-exam3lock"
export TAKEOFF_WALL_MODEL="$W/models/wall-model.json"
export TAKEOFF_WALL_RUN_MODEL="$W/models/wall-run-model.json"
export TAKEOFF_WALL_RENO_MODEL="$W/models/wall-reno-model.json"
export TAKEOFF_WALL_RENO_ALL_MODEL="$W/models/wall-reno-all-model.json"
export TAKEOFF_RENO_UNPAIRED=1
export NEXT_PUBLIC_TAKEOFF_NOT_DRAWING=1   # THE fix: the name the code reads
unset TAKEOFF_NOT_DRAWING                  # the bare name, read by nothing, gone
export ZT_HEIGHTS="$T/heights-key/heights-key-r22.json"
export ZT_LEGEND_CACHE="$T/legend-cache"
export NODE_OPTIONS=--max-old-space-size=8192
unset LEGEND_TEXT_READ TAKEOFF_UNIT_LABEL_GUARD TAKEOFF_SYMBOL_CODES TAKEOFF_UNO_DEFAULT TAKEOFF_TYPE_HEIGHTS TAKEOFF_VIEW_ROWS ZT_WALL_TYPES_FILE ZT_JUNKDUMP
echo "=== TRUE-ENV HELD-OUT ==="
ZT_HELD=1 ZT_OUT="$O/zt-held.json" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzZeroTouch.eval.ts > "$O/held-full.log" 2>&1
echo "held vitest=$?"
grep -aE "^ZTENV" "$O/held-full.log" | head -9
grep -aE "^(ZTREV|ZT) HELD-OUT TOTAL" "$O/held-full.log"
echo "=== TRUE-ENV TRAINING (with the third's ON-posture junk dump) ==="
export ZT_ZONE_KEYS="Joplin-community-center.pdf=$C/joplin-room-parts-key.md,BUNKIE-BID-DRAWINGS.pdf=$C/bunkie-room-parts-key.md,SW-Grand-Junction-CO.pdf=$C/sw-room-parts-key.md"
export ZT_JUNKDUMP="$C/junk-families-r1/junk-trueenv.jsonl"
rm -f "$ZT_JUNKDUMP"
ZT_OUT="$O/zt-train.json" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzZeroTouch.eval.ts > "$O/train-full.log" 2>&1
echo "train vitest=$?"
grep -aE "^(ZTREV|ZT) TRAINING TOTAL" "$O/train-full.log"
grep -a "ZT TRAINING 11_chestnut" "$O/train-full.log" | head -1
echo "=== TRUE-ENV RE-RUN COMPLETE ==="
