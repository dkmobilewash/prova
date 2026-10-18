"""Train the wall/not-wall classifier, and judge it IN FEET.

scikit-learn (BSD-3), CPU, offline, nothing leaves the machine. The model is
exported as plain JSON — a list of trees with integer child indices — so the
product evaluates it with its own twenty lines and carries no runtime
dependency.

── WHY THIS SCRIPT DOES NOT REPORT AUC ──

The first model trained here scored a leave-one-family-out **AUC of 0.991**
and **doubled the bench's phantom footage**, taking the zero-wall bar from
PASS to FAIL. A per-candidate score says nothing about a sheet: the errors
concentrate in the long runs, and a sheet is judged in feet. So the selection
metric is the product's own three numbers, computed per sheet and summed:

    missing — key footage no accepted candidate covers
    extra   — accepted footage that is not a key wall
    net     — extra minus missing

and a model is better than another only if it reduces BOTH missing and extra,
or reduces one while leaving the other alone. Net on its own is the number
that hid a 12 ft shortfall behind an 8 ft double count on Cedar Hollow, and it
is not used for selection here.

── THE SPLIT IS BY SHEET FAMILY ──

Never by candidate and never by variant. `A-101__clean` and `A-101__skia` are
one drawing through two printers, so splitting between them scores a model on
a sheet it has seen. With real sheets the same rule applies one level up: split
by PLAN SET, because two sheets from one set share an office's conventions.

Usage:
    python3 scripts/train-wall-model.py rows.jsonl out.json "col,col,…"

Each row: {"case", "family", "features": [...], "label": 0|1, "lengthFt"}
"""

import json
import sys
from collections import Counter, defaultdict

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier

SRC, OUT, NAMES = sys.argv[1], sys.argv[2], sys.argv[3].split(",")

rows = [json.loads(l) for l in open(SRC) if l.strip()]
X = np.array([r["features"] for r in rows], dtype=np.float64)
y = np.array([r["label"] for r in rows], dtype=np.int32)
fam = np.array([r["family"] for r in rows])
case = np.array([r["case"] for r in rows])
# Footage is what the metric is in. Falls back to the model's own length
# feature when a row does not carry one.
lf = np.array([r.get("lengthFt", r["features"][1]) for r in rows], dtype=np.float64)

assert X.shape[1] == len(NAMES), f"{X.shape[1]} columns against {len(NAMES)} names"
print(f"{len(rows):,} rows, {X.shape[1]} features, {y.sum():,} positive ({y.mean() * 100:.1f}%)")
print("families:", dict(Counter(fam)))


def sheet_numbers(truth, pred, foot, sheets):
    """missing / extra, in feet, summed over sheets.

    A candidate is ACCEPTED when the model says yes. Missing footage is a real
    wall nothing accepted; extra is accepted footage that is not a wall. Both
    are approximations — several candidates can cover one wall — and they are
    the same approximation for every model being compared, which is what makes
    them usable for selection.
    """
    missing = extra = 0.0
    for sheet in set(sheets):
        at = sheets == sheet
        missing += float(foot[at][(truth[at] == 1) & (pred[at] == 0)].sum())
        extra += float(foot[at][(truth[at] == 0) & (pred[at] == 1)].sum())
    return missing, extra


def evaluate(model, Xt, yt, ft, st, threshold):
    pred = (model.predict_proba(Xt)[:, 1] >= threshold).astype(int)
    return sheet_numbers(yt, pred, ft, st)


families = sorted(set(fam))
print("\nLEAVE ONE FAMILY OUT — in feet, not in accuracy")
print(f"  {'held out':<14} {'missing ft':>11} {'extra ft':>10} {'net ft':>9}")
totals = defaultdict(float)
for held in families:
    test = fam == held
    train = ~test
    if y[train].sum() < 20:
        print(f"  {held:<14} too few positives in the training half")
        continue
    m = GradientBoostingClassifier(
        n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.9, random_state=0
    )
    m.fit(X[train], y[train])
    missing, extra = evaluate(m, X[test], y[test], lf[test], case[test], 0.5)
    totals["missing"] += missing
    totals["extra"] += extra
    print(f"  {held:<14} {missing:>11,.0f} {extra:>10,.0f} {extra - missing:>9,.0f}")
print(
    f"  {'TOTAL':<14} {totals['missing']:>11,.0f} {totals['extra']:>10,.0f} "
    f"{totals['extra'] - totals['missing']:>9,.0f}"
)

# ── THE THRESHOLD IS PART OF THE MODEL, AND IT IS CHOSEN IN FEET ──
#
# 0.5 is where a probability happens to cross, not where this product wants to
# be. Extra footage is the error that loses a job and missing footage is the
# one that loses money, so the sweep is printed and the choice is explicit.
print("\nTHRESHOLD SWEEP (trained on all but the last family, scored on it)")
held = families[-1]
test, train = fam == held, fam != held
m = GradientBoostingClassifier(
    n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.9, random_state=0
)
m.fit(X[train], y[train])
print(f"  {'threshold':>9} {'missing ft':>11} {'extra ft':>10}")
for t in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
    missing, extra = evaluate(m, X[test], y[test], lf[test], case[test], t)
    print(f"  {t:>9.2f} {missing:>11,.0f} {extra:>10,.0f}")

final = GradientBoostingClassifier(
    n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.9, random_state=0
)
final.fit(X, y)

print("\nFEATURE USE (shipped model)")
splits = Counter()
for est in final.estimators_:
    for f in est[0].tree_.feature:
        if f >= 0:
            splits[int(f)] += 1
order = np.argsort(final.feature_importances_)[::-1]
for i in order[:14]:
    print(f"  {final.feature_importances_[i]:>6.3f}  {splits[int(i)]:>4} splits  {NAMES[i]}")
unused = [NAMES[i] for i in range(len(NAMES)) if splits[i] == 0]
if unused:
    # Worth printing loudly: last time `inHatchSeries` was true on 23% of rows
    # and split on zero times, which is how hatching got read as wall.
    print(f"  NEVER SPLIT ON: {', '.join(unused)}")


def dump_tree(t):
    return {
        "left": t.children_left.tolist(),
        "right": t.children_right.tolist(),
        "feature": t.feature.tolist(),
        "threshold": t.threshold.tolist(),
        "value": [float(v[0][0]) for v in t.value],
    }


base = float(y.mean())
model = {
    "format": "gbdt-binary-v1",
    "note": (
        "Columns are wallFeatures.FEATURE_NAMES IN ORDER. Inserting one in the "
        "middle silently reinterprets every threshold, so wallClassifier refuses "
        "a model whose names do not match."
    ),
    "features": NAMES,
    "learningRate": float(final.learning_rate),
    "init": float(np.log(base / (1 - base))),
    "trees": [dump_tree(est[0].tree_) for est in final.estimators_],
}
json.dump(model, open(OUT, "w"), separators=(",", ":"))
print(f"\nwrote {OUT}  ({len(model['trees'])} trees)")

sample = X[:5]
json.dump(
    {"rows": sample.tolist(), "expected": final.predict_proba(sample)[:, 1].tolist()},
    open(OUT.replace(".json", ".control.json"), "w"),
)
print(f"wrote the parity control: {OUT.replace('.json', '.control.json')}")
