#!/bin/bash
# ── THE R VERDICT AS A PROPER A/B (prereg-exam3-true-env.md, run 5b) ──
#
# Both arms in ONE script, identical env, the ONLY difference between arms is
# TAKEOFF_WALL_RENO_MODEL: the exam tree's in-checkout baseline vs the pinned
# candidate (sha re-verified at start). This replaces the 2026-11-25 one-shot,
# voided because its single arm took its env from the plan instead of the run.
set -o pipefail
C="/Users/diego/Claude Folder/takeoff/coordination"
T="/Users/diego/Claude Folder/takeoff"
W="${EXAM_WORKTREE:-/Users/diego/prova/.claude/worktrees/diego-model-census}/apps/web"
O="$T/eval-out-exam3-trueenv/r-ab"
CAND="$T/eval-out-second/rj2-models/wall-reno-model.json"
mkdir -p "$O"
CS=$(shasum -a 256 "$CAND" | cut -c1-8)
[ "$CS" = "d84461f5" ] || { echo "CANDIDATE SHA MISMATCH: $CS != d84461f5 — refusing"; exit 1; }
BS=$(shasum -a 256 "$W/models/wall-reno-model.json" | cut -c1-8)
echo "baseline sha $BS · candidate sha $CS"
SLOT=$(bash "$C/heavylock.sh" claim original long "R A/B verdict (prereg-exam3-true-env.md 5b), both arms one script" | grep -oE 'HEAVY_LOCK_[12]' | tail -1)
[ -n "$SLOT" ] || { echo "no heavy slot free"; exit 1; }
trap 'bash "$C/heavylock.sh" release original "$SLOT"' EXIT
cd "$W"
export REAL_PLAN_DIR="$T/real-plans" REAL_PLAN_DIR2="$T/real-plans/new"
export TAKEOFF_LABEL_DIR="$T/labels-snap-20261125T1900Z-exam3lock"
export TAKEOFF_WALL_MODEL="$W/models/wall-model.json"
export TAKEOFF_WALL_RUN_MODEL="$W/models/wall-run-model.json"
export TAKEOFF_WALL_RENO_ALL_MODEL="$W/models/wall-reno-all-model.json"
export TAKEOFF_RENO_UNPAIRED=1 NEXT_PUBLIC_TAKEOFF_NOT_DRAWING=1
unset TAKEOFF_NOT_DRAWING
export ZT_HEIGHTS="$T/heights-key/heights-key-r22.json"
export ZT_LEGEND_CACHE="$T/legend-cache"
export NODE_OPTIONS=--max-old-space-size=8192
unset LEGEND_TEXT_READ TAKEOFF_UNIT_LABEL_GUARD TAKEOFF_SYMBOL_CODES TAKEOFF_UNO_DEFAULT TAKEOFF_TYPE_HEIGHTS TAKEOFF_VIEW_ROWS ZT_WALL_TYPES_FILE ZT_JUNKDUMP ZT_ZONE_KEYS
for ARM in base cand; do
  if [ "$ARM" = "base" ]; then export TAKEOFF_WALL_RENO_MODEL="$W/models/wall-reno-model.json"; else export TAKEOFF_WALL_RENO_MODEL="$CAND"; fi
  echo "=== ARM $ARM (reno model $(shasum -a 256 "$TAKEOFF_WALL_RENO_MODEL" | cut -c1-8)) ==="
  ZT_HELD=1 ZT_OUT="$O/zt-held-$ARM.json" npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzZeroTouch.eval.ts > "$O/held-$ARM.log" 2>&1
  echo "$ARM vitest=$?"
  grep -aE "^ZT HELD-OUT TOTAL" "$O/held-$ARM.log"
done
echo "=== JUDGING (the card's own bars) ==="
python3 - "$O" <<'EOF'
import json, re, sys
O = sys.argv[1]
def rows(p):
    d = json.load(open(f"{O}/zt-held-{p}.json"))
    r = d if isinstance(d, list) else d.get("rows", d)
    out = {}
    for x in r:
        s = x["set"]
        a = out.setdefault(s, {"junk": 0, "missed": 0})
        a["junk"] += x.get("junkLf", 0); a["missed"] += x.get("missedLf", 0)
    return out
def pts(p):
    # The console line pads/truncates the set name to 26 chars; rows carry the full
    # name. Key by the 26-char prefix, and skip door-only sets printing "—".
    out = {}
    for line in open(f"{O}/held-{p}.log", errors="ignore"):
        m = re.match(r"ZT HELD-OUT (.{26}) sheets .*?TOTAL ERROR ([0-9.]+)%", line)
        if m: out[m.group(1).strip()] = float(m.group(2))
    return out
b, c = rows("base"), rows("cand")
sets_b, sets_c = set(b), set(c)
if sets_b != sets_c:
    print("VOID: set lists differ:", sorted(sets_b ^ sets_c)); sys.exit(1)
pb = sum(v["junk"] + v["missed"] for v in b.values())
pc = sum(v["junk"] + v["missed"] for v in c.values())
print(f"bar 1 pooled junk+missed: base {pb:.0f} -> cand {pc:.0f} ft ({pc-pb:+.0f}) — {'PASS' if pc < pb else 'FAIL'}")
tb, tc = pts("base"), pts("cand")
worse = []
unmatched_pts = 0
for s in sets_b:
    dft = (c[s]["junk"] + c[s]["missed"]) - (b[s]["junk"] + b[s]["missed"])
    k = s[:26].strip()
    if k not in tb or k not in tc:
        unmatched_pts += 1
        dpt = 0.0
    else:
        dpt = tc[k] - tb[k]
    if dpt > 2 and dft > 50: worse.append((s, round(dpt, 1), round(dft)))
if unmatched_pts: print(f"note: {unmatched_pts} sets had no TOTAL ERROR line (door/window-only keys print none)")
print(f"bar 2 sets worse >2pts AND >50ft: {len(worse)} {worse} — {'PASS' if not worse else 'FAIL'}")
print("R A/B VERDICT:", "PASS" if (pc < pb and not worse) else "FAIL")
EOF
echo "=== R A/B COMPLETE ==="
