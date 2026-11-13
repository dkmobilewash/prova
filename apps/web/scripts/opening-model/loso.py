"""Learned door and window scorers (METHOD v2): leave-one-set-out, the 97% auto-post line, export.

The second's wall harness (`scripts/wall-model/loso.py`), on the opening table
(`zzOpeningFeatureTable.eval.ts`), counted in OPENINGS rather than feet: each found door or window
is one decision, real (the key marks it) or false. scikit-learn (BSD-3), CPU, offline; the models
are written in the product's `gbdt-binary-v1` format (`wallClassifier.scoreCandidate` evaluates it).

For each kind it prints, every number leave-one-set-out (a set is scored by a model that never saw it):
  per set: found, real, key; what today's rule auto-posts (doors: a printed mark; windows: none);
  the auto-post line: the lowest score whose pooled LOSO precision is >= 97%, and what clears it,
  split into the ones today's rule already posts and the NEW ones (unmarked doors, untagged windows).

Usage:
  python3 scripts/opening-model/loso.py table.jsonl outdir            # LOSO + export
  python3 scripts/opening-model/loso.py table.jsonl outdir exam.jsonl # + the held-out final exam, ONCE
"""

import json
import sys
from collections import defaultdict

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier

import os

TABLE, OUTDIR = sys.argv[1], sys.argv[2]
EXAM = sys.argv[3] if len(sys.argv) > 3 else None
# ── AN UNFINISHED KEY CANNOT SET A LINE ──
# With LOSO_LABELS (the labels snapshot the table was built from), a sheet whose label file says
# reviewComplete false is left out and named: Topeka p74, an AI quick pass never finished, held 62 of the
# first parity line's 138 posts and was the only set keeping it under 97% (2026-11-13).
LABELS = os.environ.get("LOSO_LABELS", "")


def finished(set_name, sheet):
    if LABELS == "":
        return True
    path = os.path.join(LABELS, set_name, f"{sheet}.json")
    if not os.path.exists(path):
        return True
    return json.load(open(path)).get("reviewComplete") is True
AUTO_PRECISION = 0.97
# Fewer rows than the wall table (hundreds, not tens of thousands), so smaller leaves.
GBM = dict(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.8, min_samples_leaf=10, random_state=0)


SKIPPED = set()
# Printed door marks with no key door (the table's key-completeness line): a person calls each one.
UNKEYED = {}


def load(path, kind):
    names, rows, key = None, [], defaultdict(int)
    for line in open(path):
        r = json.loads(line)
        if r.get("kind") != kind:
            continue
        if not r.get("header") and not finished(r["set"], r["sheet"]):
            SKIPPED.add(f"{r['set']} {r['sheet']}")
            continue
        if r.get("header"):
            names = r["names"]
        elif "keyCount" in r:
            key[r["set"]] += r["keyCount"]
        elif "unkeyedMarks" in r:
            UNKEYED[f"{r['set']} {r['sheet']}"] = (r["marks"], r["unkeyedMarks"])
        else:
            rows.append(r)
    assert names is not None, f"{path}: no {kind} header"
    assert all(len(r["x"]) == len(names) for r in rows), "a row's width differs from the header"
    return names, rows, key


def fit(X, y):
    return GradientBoostingClassifier(**GBM).fit(X, y)


def auto_line(score, y):
    """The lowest score whose class {score >= t} keeps pooled precision >= AUTO_PRECISION, or None."""
    # Every row tied at a threshold is in its class, so the line is read at score boundaries.
    clears = [t for t in np.unique(score) if y[score >= t].mean() >= AUTO_PRECISION]
    return float(min(clears)) if clears else None


def run(kind, today_name, new_name, new_word, refs=()):
    names, rows, key = load(TABLE, kind)
    if not rows:
        print(f"\n== {kind}: no rows ==")
        return None
    col = {n: i for i, n in enumerate(names)}
    X = np.array([r["x"] for r in rows], dtype=np.float64)
    y = np.array([r["real"] for r in rows])
    sets = np.array([r["set"] for r in rows])
    today = X[:, col[today_name]] == 1 if today_name else np.zeros(len(rows), dtype=bool)
    new = X[:, col[new_name]] == 0  # unmarked / untagged
    score = np.full(len(rows), np.nan)
    skipped = []
    for held in sorted(set(sets)):
        tr, te = sets != held, sets == held
        if len(set(y[tr])) < 2:
            skipped.append(held)
            continue
        score[te] = fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    scored = ~np.isnan(score)
    t = auto_line(score[scored], y[scored])
    keyn = sum(key.values())
    print(f"\n== {kind.upper()} MODEL (real vs false), LOSO == {len(rows)} found, {y.sum()} real ({100 * y.mean():.1f}%), key {keyn}, {len(set(sets))} sets")
    if skipped:
        print(f"not scored (training side had one class): {', '.join(skipped)}")
    line = f">= {t:.4f}" if t is not None else "none reaches 97%"
    print(f"{'set':40} {'found':>5} {'real':>5} {'key':>5} | {'today':>5} {'false':>5} | {'auto':>5} {'false':>5} {'new':>5} {'n-false':>7}")
    for s in sorted(set(sets)):
        m = sets == s
        a = m & scored & (score >= t) if t is not None else m & False
        print(f"{s[:40]:40} {m.sum():5d} {y[m].sum():5d} {key.get(s, 0):5d} | {(m & today).sum():5d} {(m & today & (y == 0)).sum():5d} | {a.sum():5d} {(a & (y == 0)).sum():5d} {(a & new).sum():5d} {(a & new & (y == 0)).sum():7d}")
    p = lambda m: f"{m.sum()} ({m.sum() - (m & (y == 0)).sum()} real, {(m & (y == 0)).sum()} false, {100 * y[m].mean():.1f}%)" if m.sum() else "0"
    print(f"today's rule auto-posts: {p(today)}")
    for name in refs:
        # Signals the product already acts on without posting (a confirm item): how right they are, for reference.
        print(f"  for reference, {name} = 1: {p(X[:, col[name]] == 1)}")
    print(f"auto-post line (pooled LOSO precision >= {AUTO_PRECISION:.0%}): score {line}")
    if t is not None:
        a = scored & (score >= t)
        print(f"  clears it: {p(a)}; of them {new_word}: {p(a & new)}; already posted today: {p(a & today)}")
        print(f"  {new_word} in the table: {p(new)} -> {(a & new).sum()} would auto-post; recall of key {100 * (a & (y == 1)).sum() / max(keyn, 1):.1f}% (today {100 * (today & (y == 1)).sum() / max(keyn, 1):.1f}%)")
        both = a | today
        print(f"  today's rule OR the model: {p(both)} (adds {(a & ~today).sum()}: {(a & ~today & (y == 1)).sum()} real, {(a & ~today & (y == 0)).sum()} false)")
    else:
        # How close it gets: the best pooled precision over the top 10, 20, 40 by score.
        order = np.argsort(-np.where(scored, score, -1))
        tops = [f"top {k}: {100 * y[order[:k]].mean():.1f}%" for k in (10, 20, 40) if k <= scored.sum()]
        print(f"  best LOSO precision by volume: {', '.join(tops)}")
    worst = []
    for s in sorted(set(sets)):
        m = sets == s
        a = m & scored & (score >= t) if t is not None else m & False
        if a.sum() and y[a].mean() < AUTO_PRECISION:
            worst.append(f"{s[:30]} {100 * y[a].mean():.0f}% of {a.sum()}")
    print(f"sets under 97% at the line: {', '.join(worst) or 'none'}")

    if len(set(y)) < 2:
        print(f"not exported: every {kind} row is one class")
        return None
    m = fit(X, y)
    base = float(y.mean())
    tree = lambda tr: {"left": tr.children_left.tolist(), "right": tr.children_right.tolist(), "feature": tr.feature.tolist(), "threshold": tr.threshold.tolist(), "value": [float(v[0][0]) for v in tr.value]}
    path = f"{OUTDIR}/{kind}-model.json"
    json.dump({"format": "gbdt-binary-v1", "kind": kind, "note": f"Found {kind}: key {kind} vs false. Columns are openingFeatures.{kind.upper()}_FEATURE_NAMES IN ORDER. Auto-post at score >= the LOSO line in loso-summary.json.",
               "autoLine": t, "features": names, "learningRate": GBM["learning_rate"], "init": float(np.log(base / (1 - base))), "trees": [tree(e[0].tree_) for e in m.estimators_]}, open(path, "w"), separators=(",", ":"))
    imp = sorted(zip(m.feature_importances_, names), reverse=True)[:8]
    print(f"wrote {path}; top features: " + ", ".join(f"{n} {v:.2f}" for v, n in imp))
    summary = {"found": int(len(rows)), "real": int(y.sum()), "key": keyn, "autoLine": t,
               "autoPosted": int((scored & (score >= t)).sum()) if t is not None else 0,
               "autoFalse": int((scored & (score >= t) & (y == 0)).sum()) if t is not None else 0,
               "newAutoPosted": int((scored & (score >= t) & new).sum()) if t is not None else 0,
               "newAutoFalse": int((scored & (score >= t) & new & (y == 0)).sum()) if t is not None else 0,
               "todayPosted": int(today.sum()), "todayFalse": int((today & (y == 0)).sum())}
    return summary, m, names, t


out = {
    "door": run("door", "marked", "marked", "UNMARKED doors"),
    "window": run("window", None, "tagged", "UNTAGGED windows", refs=("countedByTag", "countedDrawn")),
}
if LABELS:
    print(f"\nleft out, key not finished (reviewComplete false): {', '.join(sorted(SKIPPED)) or 'none'}")
print(f"\nkey completeness (printed door marks beside a found door, with no key door by tag or within 6 ft): {sum(len(u) for _, u in UNKEYED.values())} on {len(UNKEYED)} door-keyed sheets")
for sheet, (n, u) in sorted(UNKEYED.items()):
    if u:
        print(f"  {sheet[:60]}: {len(u)} of {n} marks: " + ", ".join(f"{m['text']}@({m['at'][0]:.3f},{m['at'][1]:.3f})" for m in u))
json.dump({k: (v[0] if v else None) for k, v in out.items()}, open(f"{OUTDIR}/loso-summary.json", "w"), indent=1)

if EXAM:
    # ── THE FINAL EXAM: the held-out sets, once, with the models and lines chosen on LOSO ──
    for kind, v in out.items():
        if v is None or v[3] is None:
            continue
        _, m, names, t = v
        en, er, ek = load(EXAM, kind)
        assert en == names, "exam table columns differ from training"
        if not er:
            continue
        sc = m.predict_proba(np.array([r["x"] for r in er]))[:, 1]
        ey = np.array([r["real"] for r in er])
        a = sc >= t
        print(f"\n== HELD-OUT FINAL EXAM, {kind} == {len(er)} found, key {sum(ek.values())}: at the LOSO line {t:.4f}, {a.sum()} auto-post, {(a & (ey == 0)).sum()} false = {100 * ey[a].mean() if a.sum() else float('nan'):.1f}% (bar 95%)")
