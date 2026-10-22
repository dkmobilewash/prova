#!/usr/bin/env bash
#
# ── ONE COMMAND: COLLECT, TRAIN, SCORE ──
#
# Everything between "the sheets are labelled" and "here is what the model
# does on buildings it has never seen". It existed as four commands and a
# scratch script, which is how the row builder came to live outside the
# repository and the held-out rule came to be enforced by whoever remembered
# it.
#
#     ./scripts/train-wall-run.sh
#
# Reads, in order:
#
#   1. REAL LABELS   every labelled sheet, rebuilt by GEOMETRY against the
#                    candidates this finder produces now. The four held-out
#                    buildings are refused here and reported, because their
#                    labels are the test key.
#   2. SYNTHETIC     the messy set, which is where the negatives come from in
#                    bulk. Appended to the same rows file.
#   3. TRAIN         `train-wall-model.py`, which splits by BUILDING and
#                    judges in FEET rather than by AUC — a per-candidate score
#                    once read 0.991 while the model doubled phantom footage.
#   4. SCORE         the BIM held-out sheets, the four held-out buildings, and
#                    the usual guards.
#
# Nothing is written to a label file and nothing is uploaded.
#
set -e
set -o pipefail

cd "$(dirname "$0")/.."
rm -f "$(git rev-parse --git-path index.lock)" 2>/dev/null || true

PLANS="${TAKEOFF_LOCAL_PLAN_DIR:-$HOME/Claude Folder/takeoff/real-plans}"
LABELS="${TAKEOFF_LABEL_DIR:-$HOME/Claude Folder/takeoff/labels}"
MESSY="${MESSY_DIR:-$HOME/Claude Folder/takeoff/synthetic-messy}"
OUTDIR="${TRAIN_OUT:-$HOME/Claude Folder/takeoff/train-$(date +%Y%m%d-%H%M%S)}"
LOCAL_DB="${LOCAL_DATABASE_URL:-postgresql://${PGUSER:-$USER}@127.0.0.1:5432/prova_dev}"
ROWS="$OUTDIR/rows.jsonl"
MODEL="$OUTDIR/wall-model.json"

# ── REFUSALS BEFORE ANY WORK ──
#
# A missing directory here produces an empty rows file and a model trained on
# nothing, which trains and scores and looks like a result.
for pair in "plans:$PLANS" "labels:$LABELS" "synthetic:$MESSY"; do
  name="${pair%%:*}"
  path="${pair#*:}"
  if [ ! -d "$path" ]; then
    echo "REFUSING: no $name directory at $path" >&2
    exit 1
  fi
done
if ! command -v python3 >/dev/null 2>&1; then
  echo "REFUSING: python3 is needed to train" >&2
  exit 1
fi

mkdir -p "$OUTDIR"
echo "plans      : $PLANS"
echo "labels     : $LABELS"
echo "synthetic  : $MESSY"
echo "writing to : $OUTDIR"
echo

EVAL="npx vitest run --config vitest.eval.config.mts"

echo "── 1. real labelled sheets ───────────────────────────────────────────"
DATABASE_URL="$LOCAL_DB" DIRECT_URL="$LOCAL_DB" \
REAL_PLAN_DIR="$PLANS" TAKEOFF_LABEL_DIR="$LABELS" \
TRAIN_ROWS_OUT="$ROWS" \
  $EVAL lib/takeoff/realplan/zzTrainRows.eval.ts 2>&1 | tee "$OUTDIR/01-real-rows.log"

echo
echo "── 2. synthetic sheets ───────────────────────────────────────────────"
MESSY_DIR="$MESSY" MESSY_LABELS="$OUTDIR/synthetic-labels" \
  $EVAL lib/takeoff/realplan/zzMessy.eval.ts 2>&1 | tee "$OUTDIR/02-synthetic.log"

# The synthetic rows are written one file per sheet; fold them into the same
# JSONL, tagged as their own family so the split cannot put a synthetic sheet
# and its own twin on both sides.
python3 - "$OUTDIR/synthetic-labels" "$ROWS" <<'PY'
import json, os, sys
src, rows_path = sys.argv[1], sys.argv[2]
added = 0
if os.path.isdir(src):
    with open(rows_path, "a") as out:
        for name in sorted(os.listdir(src)):
            if not name.endswith(".json"):
                continue
            doc = json.load(open(os.path.join(src, name)))
            sheet = doc.get("sheet", name[:-5])
            # One family per OFFICE, not per sheet: the generator draws a
            # whole office's conventions, so two sheets from one office are
            # the same drafting hand and must not straddle the split.
            family = "synthetic-%s" % doc.get("office", "unknown")
            for row in doc.get("rows", []):
                out.write(json.dumps({
                    "case": "%s-%s" % (family, sheet),
                    "family": family,
                    "features": row["features"],
                    "label": row["label"],
                    "lengthFt": row.get("lengthFt"),
                }) + "\n")
                added += 1
print("folded %d synthetic rows into %s" % (added, rows_path))
PY

echo
echo "── 3. train ──────────────────────────────────────────────────────────"
# Step 1 wrote these from the app's own FEATURE_NAMES, so the model's columns
# cannot drift from the features the product computes.
COLUMNS=$(cat "$ROWS.columns" 2>/dev/null || true)
if [ -z "$COLUMNS" ]; then
  echo "REFUSING: could not determine the feature column names" >&2
  echo "  the model's columns must match this build's features, or it scores noise" >&2
  exit 1
fi
python3 scripts/train-wall-model.py "$ROWS" "$MODEL" "$COLUMNS" 2>&1 | tee "$OUTDIR/03-train.log"

echo
echo "── 4. score ──────────────────────────────────────────────────────────"
# ── BOTH ARMS, BECAUSE THIS LINE USED TO BE A CLAIM ──
#
# This stage printed "the four held-out buildings (rules, then the model)" and
# ran the rules ONCE, passing no model to either held-out eval. The
# classifier was trained, written to disk and scored on a building it had
# never seen never — while the log said it had been. `zzKeyScore.eval.ts` had
# no model arm at all until it was given one, and `zzBim.eval.ts` has had the
# capability all along and was never handed `BIM_MODEL`.
#
# Grep a run for `veto with` before believing any model number from it: the
# evals print that line when a model is in play and "rules only" when it is
# not, so a run that scored no model says so.
echo "   the held-out buildings — RULES:"
DATABASE_URL="$LOCAL_DB" DIRECT_URL="$LOCAL_DB" \
REAL_PLAN_DIR="$PLANS" TAKEOFF_LABEL_DIR="$LABELS" \
  $EVAL lib/takeoff/realplan/zzKeyScore.eval.ts 2>&1 | tee "$OUTDIR/04-held-out.log"

echo "   the held-out buildings — RULES + THE MODEL'S VETOES at ${KEY_CUT:-0.5}:"
DATABASE_URL="$LOCAL_DB" DIRECT_URL="$LOCAL_DB" \
REAL_PLAN_DIR="$PLANS" TAKEOFF_LABEL_DIR="$LABELS" \
KEY_MODEL="$MODEL" KEY_CUT="${KEY_CUT:-0.5}" \
  $EVAL lib/takeoff/realplan/zzKeyScore.eval.ts 2>&1 | tee "$OUTDIR/04-held-out-model.log"

echo "   the BIM sheets (test-only, never trained on) — RULES:"
BIM_DIR="${BIM_DIR:-$HOME/Claude Folder/takeoff/bim-sheets}" \
  $EVAL lib/takeoff/realplan/zzBim.eval.ts 2>&1 | tee "$OUTDIR/05-bim.log" || \
  echo "   (no BIM eval ran — check BIM_DIR)"

echo "   the BIM sheets — RULES + THE MODEL'S VETOES at ${KEY_CUT:-0.5}:"
BIM_DIR="${BIM_DIR:-$HOME/Claude Folder/takeoff/bim-sheets}" \
BIM_MODEL="$MODEL" BIM_CUT="${KEY_CUT:-0.5}" \
  $EVAL lib/takeoff/realplan/zzBim.eval.ts 2>&1 | tee "$OUTDIR/05-bim-model.log" || \
  echo "   (no BIM model eval ran — check BIM_DIR)"

echo "   the guards:"
npx vitest run lib/takeoff/ 2>&1 | tail -4 | tee "$OUTDIR/06-guards.log"

echo
echo "everything is in $OUTDIR"
echo "READ 01-real-rows.log FIRST: it prints the positives per building, and a"
echo "model whose positives come mostly from one building transfers to nothing."
