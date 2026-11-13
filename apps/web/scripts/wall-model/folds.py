"""One run model per leave-one-set-out fold, for evals that must score a set out-of-sample in the product's
own format (`zzRunModelGate.eval.ts`). Same table, GBM and weights as loso.py's `loso(every)`, so each fold's
scores are the ones loso.py's LOSO report read.

Usage: python3 scripts/wall-model/folds.py table.jsonl outdir   # writes outdir/<set>.json
"""

import json
import os
import sys

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier

TABLE, OUTDIR = sys.argv[1], sys.argv[2]
GBM = dict(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.8, min_samples_leaf=40, random_state=0)  # loso.py's
names, rows = None, []
for line in open(TABLE):
    r = json.loads(line)
    if r.get("header"):
        names = r["names"]
    elif "x" in r:
        rows.append(r)
X = np.array([r["x"] for r in rows], dtype=np.float64)
ft = np.array([r["ft"] for r in rows])
y = 1 - np.array([r["junk"] for r in rows])
sets = np.array([r["set"] for r in rows])
os.makedirs(OUTDIR, exist_ok=True)
for held in sorted(set(sets)):
    tr = sets != held
    m = GradientBoostingClassifier(**GBM).fit(X[tr], y[tr], sample_weight=np.sqrt(ft[tr]))
    base = float(m.init_.class_prior_[1])
    tree = lambda t: {"left": t.children_left.tolist(), "right": t.children_right.tolist(), "feature": t.feature.tolist(), "threshold": t.threshold.tolist(), "value": [float(v[0][0]) for v in t.value]}
    json.dump({"format": "gbdt-binary-v1", "kind": "run", "note": f"LOSO fold: trained without {held}", "features": names, "learningRate": GBM["learning_rate"],
               "init": float(np.log(base / (1 - base))), "trees": [tree(e[0].tree_) for e in m.estimators_]}, open(os.path.join(OUTDIR, f"{held}.json"), "w"), separators=(",", ":"))
    print(held)
