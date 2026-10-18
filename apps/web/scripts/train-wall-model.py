"""Train the wall/not-wall classifier on bench candidates only.

scikit-learn, BSD-3, CPU, offline. The model is exported as plain JSON — a
list of trees with integer child indices — so the product evaluates it with
its own code and carries no runtime dependency at all.

The split is by FAMILY, never by candidate and never by variant: A-101__clean
and A-101__skia are the same drawing through two printers, so putting one in
train and the other in test would be scoring on a sheet the model has seen.
"""
import json
import sys
from collections import Counter

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

SRC = sys.argv[1]
OUT = sys.argv[2]
NAMES = sys.argv[3].split(",")

rows = [json.loads(l) for l in open(SRC) if l.strip()]
X = np.array([r["features"] for r in rows], dtype=np.float64)
y = np.array([r["label"] for r in rows], dtype=np.int32)
fam = np.array([r["family"] for r in rows])

assert X.shape[1] == len(NAMES), f"{X.shape[1]} columns against {len(NAMES)} names"
print(f"{len(rows):,} rows, {X.shape[1]} features, {y.sum():,} positive ({y.mean() * 100:.1f}%)")
print("families:", {k: int(v) for k, v in Counter(fam).items()})

families = sorted(set(fam))
# Leave-one-family-out, so every family is a held-out test exactly once and
# the reported numbers are not one lucky split.
print("\nLEAVE ONE FAMILY OUT")
print(f"  {'held out':<12} {'rows':>7} {'pos':>6} {'AUC':>7} {'avg prec':>9}")
aucs = []
for held in families:
    test = fam == held
    train = ~test
    if y[train].sum() < 20 or y[test].sum() < 5:
        print(f"  {held:<12} {test.sum():>7} {int(y[test].sum()):>6}   too few positives to score")
        continue
    m = GradientBoostingClassifier(
        n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.9, random_state=0
    )
    m.fit(X[train], y[train])
    p = m.predict_proba(X[test])[:, 1]
    auc = roc_auc_score(y[test], p)
    ap = average_precision_score(y[test], p)
    aucs.append(auc)
    print(f"  {held:<12} {test.sum():>7} {int(y[test].sum()):>6} {auc:>7.3f} {ap:>9.3f}")
if aucs:
    print(f"  mean AUC over {len(aucs)} folds: {np.mean(aucs):.3f}")

# The shipped model is trained on everything, because the product is scored on
# Cedar Hollow, the fixtures and the real sheets — none of which is in here.
final = GradientBoostingClassifier(
    n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.9, random_state=0
)
final.fit(X, y)

print("\nFEATURE IMPORTANCE (shipped model)")
order = np.argsort(final.feature_importances_)[::-1]
for i in order[:12]:
    print(f"  {final.feature_importances_[i]:>6.3f}  {NAMES[i]}")


def dump_tree(t):
    return {
        "left": t.children_left.tolist(),
        "right": t.children_right.tolist(),
        "feature": t.feature.tolist(),
        "threshold": t.threshold.tolist(),
        "value": [float(v[0][0]) for v in t.value],
    }


model = {
    "format": "gbdt-binary-v1",
    "note": (
        "Trained on bench candidates only. Scored by summing tree leaf values onto "
        "init, then a logistic. Columns are wallFeatures.FEATURE_NAMES IN ORDER — "
        "inserting a feature in the middle silently reinterprets every threshold."
    ),
    "features": NAMES,
    "learningRate": float(final.learning_rate),
    "init": float(final.init_.class_prior_[1] if hasattr(final.init_, "class_prior_") else 0.0),
    "trees": [dump_tree(est[0].tree_) for est in final.estimators_],
}
# sklearn's init for log-loss is the log-odds of the base rate.
base = float(y.mean())
model["init"] = float(np.log(base / (1 - base)))

json.dump(model, open(OUT, "w"), separators=(",", ":"))
print(f"\nwrote {OUT}  ({len(model['trees'])} trees)")

# A control the JS side can check against: score the first few rows here so a
# mismatch in the evaluator is caught rather than discovered as a bad number.
sample = X[:5]
probs = final.predict_proba(sample)[:, 1]
json.dump(
    {"rows": sample.tolist(), "expected": probs.tolist()},
    open(OUT.replace(".json", ".control.json"), "w"),
)
print(f"wrote the parity control: {OUT.replace('.json', '.control.json')}")
