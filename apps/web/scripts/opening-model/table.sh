#!/bin/zsh
# table.sh <held 0|1> <out.jsonl>: the door and window feature table (zzOpeningFeatureTable.eval.ts), one process per set.
# Resumes after an interruption: sets listed in <out>.done are skipped. Delete both files to start over.
# Needs REAL_PLAN_DIR (+ optional REAL_PLAN_DIR2), TAKEOFF_LABEL_DIR. OFT_SETS (regex) narrows the sets.
set -o pipefail
cd "${0:A:h}/../.."
OUT="${2:A}"; D="$OUT.done"; touch "$D"
for d in "$TAKEOFF_LABEL_DIR"/*(/); do n=${d:t}
  [[ -n "$OFT_SETS" && ! "$n" =~ $OFT_SETS ]] && continue
  grep -qxF "$n" "$D" && continue
  P="$OUT.part"; rm -f "$P"
  OFT_OUT="$P" OFT_ONLY="$n" OFT_HELD=$1 TAKEOFF_WALL_MODEL=$PWD/models/wall-model.json \
    npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzOpeningFeatureTable.eval.ts > "$OUT.log" 2>&1
  rc=$?
  # A set with no door- or window-keyed sheet (or the other split's) writes nothing: done, no rows.
  if [[ $rc -ne 0 ]] && ! grep -q "no keyed sheet was read" "$OUT.log"; then echo "$n FAILED ($rc), see $OUT.log"; continue; fi
  if [[ -s "$P" ]]; then
    if [[ -s "$OUT" ]]; then grep -v '"header":true' "$P" >> "$OUT"; else cat "$P" >> "$OUT"; fi
  fi
  echo "$n" >> "$D"; echo "$n ok $(grep -c '"x":' "$P" 2>/dev/null || echo 0) rows"
done
