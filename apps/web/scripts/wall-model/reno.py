"""Paired-renovation wall model, remove-only (METHOD v2, R): count first, then LOSO once.

    python3 scripts/wall-model/reno.py table.jsonl [--count]
    python3 scripts/wall-model/reno.py table.jsonl --export models        # on a PASS: the shipped model
    python3 scripts/wall-model/reno.py table.jsonl --exam exam.jsonl      # the held-out final, ONCE

Rows: runs on renovation sheets the product paired with their demolition plan (renovation=1,
paired=1) in the wall feature table (`zzWallFeatureTable.eval.ts`). Label: the run is a key wall
(keys draw new walls only, so existing walls and non-walls are both 0). Decision: of the runs
today's rules post (keptByCompare=1, heldOffEstimate=0), a run comes OFF when its LOSO score is
below REMOVE_BELOW. Error is in feet: junk posted plus real left off.
"""

import json
import sys
from collections import defaultdict

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier

TABLE = sys.argv[1]
# ── THE PRE-REGISTERED GATE (log.md, R START, before the post-23b snapshot or any number) ──
MIN_SETS, MIN_ROWS, MIN_CLASS = 6, 400, 40
REMOVE_BELOW = 0.1
WORSE_PTS, WORSE_FT = 2.0, 50.0
GBM = dict(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.8, min_samples_leaf=40, random_state=0)

names, rows = None, []
for line in open(TABLE):
    r = json.loads(line)
    if r.get("header"):
        names = r["names"]
    elif "sheetKeyFeet" not in r:
        rows.append(r)
assert names is not None and rows, f"{TABLE}: no header or no rows"
col = {n: i for i, n in enumerate(names)}
X = np.array([r["x"] for r in rows], dtype=np.float64)
c = lambda n: X[:, col[n]]
ft = np.array([r["ft"] for r in rows])
extra = np.minimum(np.array([r["extraFeet"] for r in rows]), ft)
ok = ft - extra
y = 1 - np.array([r["junk"] for r in rows])
sets = np.array([r["set"] for r in rows])
sheets = np.array([f'{r["set"]}|{r.get("sheet", "")}' for r in rows])
reno, paired = c("renovation") == 1, c("paired") == 1
mask = reno & paired

# ── COUNT FIRST ──
print(f"table: {len(rows):,} rows, {len(set(sets))} sets; renovation rows {reno.sum():,} in {len(set(sets[reno]))} sets; paired renovation rows {mask.sum():,}")
print(f"{'set':40} {'sheets':>6} {'rows':>5} {'ft':>7} {'real ft':>8} {'not ft':>7} {'pos':>4} {'neg':>4}")
for s in sorted(set(sets[reno])):
    m = reno & (sets == s)
    p = m & paired
    print(f"{s[:40]:40} {len(set(sheets[p])):6d} {p.sum():5d} {ft[p].sum():7.0f} {ok[p].sum():8.0f} {extra[p].sum():7.0f} {int(y[p].sum()):4d} {int((1 - y[p]).sum()):4d}" + ("" if p.any() else f"   UNPAIRED ({m.sum()} renovation rows)"))
n_sets = len(set(sets[mask]))
pos, neg = int(y[mask].sum()), int((1 - y[mask]).sum())
enough = n_sets >= MIN_SETS and mask.sum() >= MIN_ROWS and min(pos, neg) >= MIN_CLASS
print(f"paired renovation: {n_sets} sets, {mask.sum():,} rows ({pos} real, {neg} not), {ft[mask].sum():,.0f} ft")
print(f"ENOUGH DATA (>= {MIN_SETS} sets, >= {MIN_ROWS} rows, >= {MIN_CLASS} per class): {'YES' if enough else f'NO — {max(0, MIN_SETS - n_sets)} more paired renovation sets needed at least'}")
if "--count" in sys.argv or not enough:
    sys.exit(0)

# ── LOSO, ONCE ──
w = np.sqrt(ft)
score = np.full(len(rows), np.nan)
for held in sorted(set(sets[mask])):
    tr, te = mask & (sets != held), mask & (sets == held)
    if len(set(y[tr])) < 2:
        continue
    score[te] = GradientBoostingClassifier(**GBM).fit(X[tr], y[tr], sample_weight=w[tr]).predict_proba(X[te])[:, 1]
hand = (c("keptByCompare") == 1) & (c("heldOffEstimate") == 0)
model = hand & ~(score < REMOVE_BELOW)
err = lambda post, m: float((extra * (post & m)).sum() + (ok * (~post & m)).sum())
e_m, e_h = err(model, mask), err(hand, mask)
print(f"\n{'set':40} {'offered':>7} {'err model':>9} {'err hand':>9} {'pts':>6} {'removed ft':>10} {'real removed':>12}")
worse = []
for s in sorted(set(sets[mask])):
    m = mask & (sets == s)
    base = ft[m].sum() or 1
    em, eh = err(model, m), err(hand, m)
    pts = 100 * (em - eh) / base
    if pts > WORSE_PTS and em - eh > WORSE_FT:
        worse.append(s)
    off = m & hand & ~model
    print(f"{s[:40]:40} {base:7.0f} {em:9.0f} {eh:9.0f} {pts:+6.1f} {ft[off].sum():10.0f} {ok[off].sum():12.0f}" + ("  WORSE" if s in worse else ""))
off = mask & hand & ~model
print(f"\nPOOLED total error (junk posted + real left off): model {e_m:,.0f} ft  hand {e_h:,.0f} ft  ({100 * (e_h - e_m) / max(e_h, 1):+.1f}% better)")
print(f"removed: {ft[off].sum():,.0f} ft ({extra[off].sum():,.0f} junk, {ok[off].sum():,.0f} real)")
print(f"sets worse by > {WORSE_PTS} pts AND > {WORSE_FT:.0f} ft: {len(worse)} {worse}")
print(f"GATE (total error down AND no set worse): {'PASS' if e_m < e_h and not worse else 'FAIL'}")

# ── EXPORT (only on a PASS, with --export OUTDIR): every paired set, the product's gbdt-binary-v1 ──
if "--export" in sys.argv and e_m < e_h and not worse:
    out = sys.argv[sys.argv.index("--export") + 1]
    m = GradientBoostingClassifier(**GBM).fit(X[mask], y[mask], sample_weight=w[mask])
    base = float(m.init_.class_prior_[1])  # the prior sklearn fitted (sqrt(ft)-weighted)
    tree = lambda t: {"left": t.children_left.tolist(), "right": t.children_right.tolist(), "feature": t.feature.tolist(), "threshold": t.threshold.tolist(), "value": [float(v[0][0]) for v in t.value]}
    json.dump({"format": "gbdt-binary-v1", "kind": "run", "note": f"Paired renovation sheet run: new work vs existing or junk; remove-only below {REMOVE_BELOW}. Columns are wallRunFeatures.RUN_FEATURE_NAMES IN ORDER.",
               "features": names, "learningRate": GBM["learning_rate"], "init": float(np.log(base / (1 - base))), "trees": [tree(e[0].tree_) for e in m.estimators_]},
              open(f"{out}/wall-reno-model.json", "w"), separators=(",", ":"))
    # Parity rows: invented, each column uniform over its training range (no plan's rows).
    rng = np.random.default_rng(0)
    lo, hi = X[mask].min(axis=0), X[mask].max(axis=0)
    ctl = np.round(lo + rng.random((8, X.shape[1])) * (hi - lo), 4)
    json.dump({"rows": ctl.tolist(), "expected": m.predict_proba(ctl)[:, 1].tolist()}, open(f"{out}/wall-reno-model.control.json", "w"))
    imp = sorted(zip(m.feature_importances_, names), reverse=True)[:10]
    print(f"wrote {out}/wall-reno-model.json; init {np.log(base / (1 - base)):.6f}; top features: " + ", ".join(f"{n} {v:.2f}" for v, n in imp))

# ── THE HELD-OUT FINAL (--exam exam.jsonl, run ONCE by the original): the all-sets model, same gate ──
if "--exam" in sys.argv:
    path = sys.argv[sys.argv.index("--exam") + 1]
    erows = [r for r in map(json.loads, open(path)) if not r.get("header") and "sheetKeyFeet" not in r]
    assert erows, f"{path}: no rows"
    EX = np.array([r["x"] for r in erows], dtype=np.float64)
    ec = lambda n: EX[:, col[n]]
    eft = np.array([r["ft"] for r in erows]); eextra = np.minimum(np.array([r["extraFeet"] for r in erows]), eft); eok = eft - eextra
    esets = np.array([r["set"] for r in erows])
    emask = (ec("renovation") == 1) & (ec("paired") == 1)
    full = GradientBoostingClassifier(**GBM).fit(X[mask], y[mask], sample_weight=w[mask])
    escore = full.predict_proba(EX)[:, 1]
    ehand = (ec("keptByCompare") == 1) & (ec("heldOffEstimate") == 0)
    emodel = ehand & ~(escore < REMOVE_BELOW)
    eerr = lambda post, m: float((eextra * (post & m)).sum() + (eok * (~post & m)).sum())
    print(f"\nEXAM: {len(erows):,} rows; paired renovation {emask.sum():,} rows in {len(set(esets[emask]))} sets")
    eworse = []
    for s_ in sorted(set(esets[emask])):
        m_ = emask & (esets == s_)
        b_ = eft[m_].sum() or 1
        em_, eh_ = eerr(emodel, m_), eerr(ehand, m_)
        bad = 100 * (em_ - eh_) / b_ > WORSE_PTS and em_ - eh_ > WORSE_FT
        eworse += [s_] if bad else []
        print(f"{s_[:40]:40} {b_:7.0f} {em_:9.0f} {eh_:9.0f} {100 * (em_ - eh_) / b_:+6.1f}" + ("  WORSE" if bad else ""))
    tm, th = eerr(emodel, emask), eerr(ehand, emask)
    print(f"EXAM pooled total error: model {tm:,.0f} ft  hand {th:,.0f} ft; sets worse: {len(eworse)} {eworse}")
    print(f"EXAM (remove-only, total error down AND no set worse): {'PASS' if emask.any() and tm < th and not eworse else 'FAIL'}")
