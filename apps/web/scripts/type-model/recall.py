"""C3: why a key code is not a candidate. Weights zzLegendRecall.eval.ts's per-code rows by key feet.

    python3 scripts/type-model/recall.py probe.jsonl LABEL_DIR

Key feet per (sheet, code) are the answer key's own walls (score_types.key_from_labels), not the
group split the type table uses, so the total differs slightly from the table's key-code ft.
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_types as ST  # noqa: E402

PROBE, LABELS = sys.argv[1], sys.argv[2]


def cause(row, c, legend):
    pages = row["pages"]
    if not pages:
        return "not in the text (outlines or image)"
    exact = [p for p in pages if p["exact"] > 0]
    if not exact:
        return "only inside a longer line (composite / labelled)"
    ranked = [p for p in exact if p["rank"] is not None and p["rank"] <= 2]
    if ranked:
        return "legend page read, code missed" if any(p["readTypes"] > 0 for p in ranked) else "legend page found, nothing parsed"
    if not legend:
        on = [p for p in exact if p["sheet"]]
        return "no legend; printed on sheet but rejected" if on else "no legend; not printed on the sheet"
    return "printed only off the legend pages (sibling / schedule / plan)"


tot = miss = 0.0
by = defaultdict(float)
rows = []
for l in open(PROBE):
    sh = json.loads(l)
    label = json.load(open(os.path.join(LABELS, sh["set"], sh["sheet"] + ".json")))
    ft = defaultdict(float)
    for k in ST.key_from_labels(label):
        if k["wallType"] and ST.norm(k["wallType"]) != "U":
            ft[ST.norm(k["wallType"])] += ST.length(k) * label["feetPerUnit"]
    for c, row in sh["codes"].items():
        f = ft.get(c, 0.0)
        tot += f
        if row["inVocabulary"]:
            continue
        miss += f
        why = cause(row, c, sh["legend"])
        by[why] += f
        rows.append((sh["set"][:28], sh["sheet"], c, f, why, len(sh["legend"])))
print(f"key-code ft {tot:,.0f}; true code not a candidate {miss:,.0f} ({100 * miss / tot:.1f}%)")
for why, f in sorted(by.items(), key=lambda kv: -kv[1]):
    print(f"  {f:7,.0f} ft  {100 * f / miss:5.1f}%  {why}")
print()
for r in sorted(rows, key=lambda r: (-r[3])):
    if r[3] >= 1:
        print(f"{r[0]:28} {r[1]:9} {r[2]:8} {r[3]:7.0f} ft  legend={r[5]:<3} {r[4]}")
