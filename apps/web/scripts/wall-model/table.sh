#!/bin/zsh
# table.sh <held 0|1> <out.jsonl>: the wall feature table (zzWallFeatureTable.eval.ts), one process per set.
# Resumes after an interruption: sets listed in <out>.done are skipped. Delete both files to start over.
# Needs REAL_PLAN_DIR (+ optional REAL_PLAN_DIR2), TAKEOFF_LABEL_DIR. WFT_SETS (regex) narrows the sets.
set -o pipefail
cd "${0:A:h}/../.."
OUT="${2:A}"; D="$OUT.done"; touch "$D"
for d in "$TAKEOFF_LABEL_DIR"/*(/); do n=${d:t}
  [[ -n "$WFT_SETS" && ! "$n" =~ $WFT_SETS ]] && continue
  grep -qxF "$n" "$D" && continue
  P="$OUT.part"; rm -f "$P"
  WFT_OUT="$P" WFT_ONLY="$n" WFT_HELD=$1 TAKEOFF_WALL_MODEL=$PWD/models/wall-model.json \
    npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzWallFeatureTable.eval.ts > "$OUT.log" 2>&1
  rc=$?
  if [[ $rc -ne 0 ]]; then echo "$n FAILED ($rc), see $OUT.log"; continue; fi
  # Keep one header: the first set's.
  if [[ -s "$OUT" ]]; then grep -v '"header":true' "$P" >> "$OUT"; else cat "$P" >> "$OUT"; fi
  echo "$n" >> "$D"; echo "$n ok $(grep -c '"x":' "$P") rows"
done
