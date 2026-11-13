#!/bin/zsh
# table.sh <out.jsonl>: the wall types table (zzTypeTable.eval.ts), one process per set; training sets (TT_HELD=1: held-out only).
# Resumes: sets listed in <out>.done are skipped. No set -e on purpose: a failed set is logged and the rest still run. Needs REAL_PLAN_DIR (colon-separated roots), TAKEOFF_LABEL_DIR.
set -o pipefail
cd "${0:A:h}/../.."
OUT="${1:A}"; D="$OUT.done"; touch "$D"
for d in "$TAKEOFF_LABEL_DIR"/*(/); do n=${d:t}
  [[ -n "$TT_SETS" && ! "$n" =~ $TT_SETS ]] && continue
  grep -qxF "$n" "$D" && continue
  P="$OUT.part"; rm -f "$P"
  TT_OUT="$P" TT_ONLY="$n" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzTypeTable.eval.ts > "$OUT.log" 2>&1
  rc=$?
  if [[ $rc -ne 0 ]]; then echo "$n FAILED ($rc), see $OUT.log"; cp "$OUT.log" "$OUT.$n.fail.log"; continue; fi
  [[ -s "$P" ]] && cat "$P" >> "$OUT"
  echo "$n" >> "$D"; echo "$n ok $( [[ -s "$P" ]] && wc -l < "$P" || echo 0) sheets"
done
