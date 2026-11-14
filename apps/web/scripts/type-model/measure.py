"""C3: candidate recall and today's chain, legend read gate off vs on, from two type tables.

    python3 scripts/type-model/measure.py off.jsonl on.jsonl LABEL_DIR

Candidate recall = key-code ft (split onto groups, as type_loso.py) whose true code is in the group's
candidate list. Chain = typeSource as carried in each table, scored by score_types.score.
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_types as ST  # noqa: E402

OFF, ON, LABELS = sys.argv[1], sys.argv[2], sys.argv[3]


def measure(path):
    per = defaultdict(lambda: defaultdict(float))
    for l in open(path):
        sh = json.loads(l)
        label = json.load(open(os.path.join(LABELS, sh["set"], sh["sheet"] + ".json")))
        runs = [{**r, "t": r["thicknessIn"] / 12, "type": gi} for gi, g in enumerate(sh["groups"]) for r in g["runs"]]
        p = per[sh["set"]]
        for k in ST.key_from_labels(label):
            t = k["wallType"]
            if t is None or ST.norm(t) == "U":
                continue
            split, _ = ST.split_key_wall(k, runs, sh["feetPerUnit"])
            for gi, f in split.items():
                p["keyft"] += f
                if ST.norm(t) in {ST.norm(c["code"]) for c in sh["groups"][gi]["cands"]}:
                    p["cand"] += f
        typed = [{**r, "type": None if g["chain"] is None else g["chain"]["code"]} for g in sh["groups"] for r in g["runs"]]
        s, _, _ = ST.score(label, {"runs": typed})
        for k in ("key_code", "correct", "wrong", "typed_code"):
            p[k] += s[k]
    return per


off, on = measure(OFF), measure(ON)
pct = lambda a, b: 100 * a / b if b else float("nan")
# keyft = key-code ft a group's runs cover (what candidate recall is over); typed = ALL key-code ft
# the key holds, covered or not. typed > 0 with keyft 0 means the product found no run there.
print(f"{'set':34} {'typed':>6} {'keyft':>6} | {'cand off':>8} {'on':>6} | {'ok off':>6} {'on':>6} | {'wr off':>6} {'on':>6}")
for s in sorted(set(off) | set(on)):
    a, b = off[s], on[s]
    print(f"{s[:34]:34} {a['key_code']:6.0f} {a['keyft']:6.0f} | {a['cand']:8.0f} {b['cand']:6.0f} | {a['correct']:6.0f} {b['correct']:6.0f} | {a['wrong']:6.0f} {b['wrong']:6.0f}")
for name, per in (("OFF", off), ("ON", on)):
    t = {k: sum(p[k] for p in per.values()) for k in ("keyft", "cand", "key_code", "correct", "wrong", "typed_code")}
    print(f"{name}: candidate recall {pct(t['cand'], t['keyft']):.1f}% ({t['cand']:,.0f} of {t['keyft']:,.0f} ft) | chain settled-correct {pct(t['correct'], t['key_code']):.1f}% ({t['correct']:,.0f} ft) wrong-of-typed {pct(t['wrong'], t['typed_code']):.1f}% ({t['wrong']:,.0f} of {t['typed_code']:,.0f} ft)")
