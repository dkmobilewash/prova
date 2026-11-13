"""Learned wall scorers (METHOD v2): train, leave-one-set-out, compare with the hand rules, export.

scikit-learn (BSD-3), CPU, offline. Models are written in the product's own
`gbdt-binary-v1` format, so `wallClassifier.scoreCandidate` evaluates them
and the product carries no runtime dependency.

Two models, both on the feature table (`zzWallFeatureTable.eval.ts`):
  run    — is this run on offer a key wall (real) or not, every sheet;
  new    — on a renovation sheet paired with its demolition plan, is the run
           NEW work. The keys draw new walls only, so "not new" is existing
           walls and non-walls together.

Every number is in FEET (ok = ft − extraFeet, false = extraFeet) and is
leave-one-set-out: each set is scored by a model that never saw it.

Usage:
  python3 scripts/wall-model/loso.py table.jsonl outdir            # LOSO + export
  python3 scripts/wall-model/loso.py table.jsonl outdir exam.jsonl # + the held-out final exam, ONCE
"""

import json
import sys
from collections import defaultdict

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier

TABLE, OUTDIR = sys.argv[1], sys.argv[2]
EXAM = sys.argv[3] if len(sys.argv) > 3 else None
# ── THE PRE-REGISTERED GATE (logged 2026-11-13 before the parity table existed; NO new knobs after it) ──
AUTO_PRECISION = 0.97  # the auto-post line: pooled LOSO precision at or above this
POST_AT = 0.5  # run model alone: a run posts at or above this score
REMOVE_BELOW = 0.1  # remove-only model: today's posted run comes OFF the estimate when its score is below this
WORSE_PTS = 2.0  # no set's error may grow by more than this, in points of the set's offered feet
# AMENDMENT (Diego, 2026-11-13, logged before applying; no retrain): a set is "worse" only past BOTH bars —
# on sheets <= 463 ft offered a few feet is several points (Supreme Court 8 ft = +6.5 pts), percent noise.
WORSE_FT = 50.0
GBM = dict(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.8, min_samples_leaf=40, random_state=0)
weight = lambda f: np.sqrt(f)  # sqrt(ft): long runs count more, without one long run deciding a fold


def load(path):
    names, rows, keyft = None, [], defaultdict(float)
    for line in open(path):
        r = json.loads(line)
        if r.get("header"):
            names = r["names"]
        elif "sheetKeyFeet" in r:
            keyft[r["set"]] += r["sheetKeyFeet"]
        else:
            rows.append(r)
    assert names is not None and rows, f"{path}: no header or no rows"
    assert all(len(r["x"]) == len(names) for r in rows), "a row's width differs from the header"
    return names, rows, keyft


names, rows, keyft = load(TABLE)
col = {n: i for i, n in enumerate(names)}
X = np.array([r["x"] for r in rows], dtype=np.float64)
ft = np.array([r["ft"] for r in rows])
extra = np.minimum(np.array([r["extraFeet"] for r in rows]), ft)
ok = ft - extra
y = 1 - np.array([r["junk"] for r in rows])
sets = np.array([r["set"] for r in rows])
c = lambda n: X[:, col[n]]

# ── TODAY'S HAND RULES, read off the same rows ──
hand_post = (c("keptByCompare") == 1) & (c("heldOffEstimate") == 0)
hand_new = c("keptByCompare") == 1
# Plan A's pre-registered auto-post rule (logged 2026-11-12, before its held-out run).
hand_auto = (c("renovation") == 0) & (
    (c("typeTag") == 1)
    | ((c("endsMeet") == 2) & (c("modelScore") >= 0.9) & (c("lengthFeet") >= 8) & (c("pair_twinFaces") > 0) & (c("pair_densityPercentile") >= 0.3))
) & hand_post


def fit(Xt, yt, wt):
    return GradientBoostingClassifier(**GBM).fit(Xt, yt, sample_weight=wt)


def loso(mask):
    s = np.full(len(rows), np.nan)
    for held in sorted(set(sets[mask])):
        tr, te = mask & (sets != held), mask & (sets == held)
        if len(set(y[tr])) < 2:
            continue
        s[te] = fit(X[tr], y[tr], weight(ft[tr])).predict_proba(X[te])[:, 1]
    return s


def err(post, mask):
    """Feet wrong: junk posted plus real left off, over `mask`."""
    return float((extra * (post & mask)).sum() + (ok * (~post & mask)).sum())


def auto_line(score, mask):
    """The lowest score whose class {score >= t} has pooled precision >= AUTO_PRECISION."""
    order = np.argsort(-score[mask])
    s, o, f = score[mask][order], ok[mask][order], ft[mask][order]
    co, cf = np.cumsum(o), np.cumsum(f)
    good = np.where(co / cf >= AUTO_PRECISION)[0]
    # The largest prefix that still clears the bar, cut at a score boundary.
    if len(good) == 0:
        return None
    i = good[-1]
    return float(s[i])


def report(title, score, mask, hand_dec, auto_hand=None, dec=None):
    print(f"\n══ {title} ══  rows {mask.sum():,}  ft {ft[mask].sum():,.0f} (real {ok[mask].sum():,.0f})")
    dec = score >= POST_AT if dec is None else dec
    e_m, e_h = err(dec, mask), err(hand_dec, mask)
    print(f"total error ft (junk posted + real left off): model {e_m:,.0f}  hand {e_h:,.0f}  ({100 * (e_h - e_m) / max(e_h, 1):+.1f}% better)")
    t = auto_line(score, mask)
    worst, worse = 0.0, []
    print(f"{'set':34} {'keyft':>7} {'err model':>9} {'err hand':>9} {'pts':>6} | {'auto ok':>7} {'false':>5} {'prec':>6} | {'hand ok':>7} {'false':>5}")
    for s in sorted(set(sets[mask])):
        m = mask & (sets == s)
        base = ft[m].sum() or 1  # points of the set's OFFERED feet
        em, eh = err(dec, m), err(hand_dec, m)
        pts = 100 * (em - eh) / base
        worst = max(worst, pts)
        if pts > WORSE_PTS and em - eh > WORSE_FT:
            worse.append(s)
        a = m & (score >= t) if t is not None else m & False
        ah = m & auto_hand if auto_hand is not None else m & False
        prec = ok[a].sum() / ft[a].sum() if ft[a].sum() else float("nan")
        print(f"{s[:34]:34} {base:7.0f} {em:9.0f} {eh:9.0f} {pts:+6.1f} | {ok[a].sum():7.0f} {extra[a].sum():5.0f} {100 * prec:5.1f}% | {ok[ah].sum():7.0f} {extra[ah].sum():5.0f}")
    passed = e_m < e_h and not worse
    print(f"worst set vs hand: {worst:+.1f} points of its offered ft; sets worse by > {WORSE_PTS} pts AND > {WORSE_FT:.0f} ft: {len(worse)} {worse}")
    print(f"GATE (total error down AND no set worse by > {WORSE_PTS} pts and > {WORSE_FT:.0f} ft): {'PASS' if passed else 'FAIL'}")
    if t is not None:
        a = mask & (score >= t)
        print(f"auto-post line (pooled LOSO precision >= {AUTO_PRECISION:.0%}): score >= {t:.4f} -> {ok[a].sum():,.0f} ft ok / {extra[a].sum():,.0f} false = {100 * ok[a].sum() / ft[a].sum():.2f}%  (touch-free ${ok[a].sum() * 18:,.0f} at $18/LF)")
    if auto_hand is not None:
        a = mask & auto_hand
        print(f"hand auto-post rule: {ok[a].sum():,.0f} ft ok / {extra[a].sum():,.0f} false = {100 * ok[a].sum() / max(ft[a].sum(), 1):.2f}%")
    rec_m = ok[mask & dec].sum() / max(sum(keyft.get(s, 0) for s in set(sets[mask])), 1)
    prec_m = ok[mask & dec].sum() / max(ft[mask & dec].sum(), 1)
    prec_h = ok[mask & hand_dec].sum() / max(ft[mask & hand_dec].sum(), 1)
    rec_h = ok[mask & hand_dec].sum() / max(sum(keyft.get(s, 0) for s in set(sets[mask])), 1)
    print(f"posted: model precision {100 * prec_m:.1f}% recall-of-key {100 * rec_m:.1f}% | hand {100 * prec_h:.1f}% / {100 * rec_h:.1f}%")
    return {"error_model": e_m, "error_hand": e_h, "worst_pts": worst, "worse_sets": worse, "pass": passed, "auto_line": t}


every = np.ones(len(rows), dtype=bool)
reno = (c("renovation") == 1) & (c("paired") == 1)
s_run = loso(every)
r_run = report("RUN MODEL ALONE (post when score >= POST_AT), LOSO", s_run, every, hand_post, hand_auto)
r_rm = report(f"REMOVE-ONLY (today's posted runs, off when score < {REMOVE_BELOW}) — THE SHIP CANDIDATE, LOSO", s_run, every, hand_post, hand_auto, dec=hand_post & (s_run >= REMOVE_BELOW))
s_new = loso(reno)
r_new = report("NEW MODEL (new vs existing/junk, renovation sheets paired with a demo plan), LOSO", s_new, reno, hand_new) if reno.any() else None


def export(mask, path, title):
    m = fit(X[mask], y[mask], weight(ft[mask]))
    base = float(m.init_.class_prior_[1])  # the prior sklearn itself fitted (sqrt(ft)-weighted), not a re-derived one
    tree = lambda t: {"left": t.children_left.tolist(), "right": t.children_right.tolist(), "feature": t.feature.tolist(), "threshold": t.threshold.tolist(), "value": [float(v[0][0]) for v in t.value]}
    json.dump({"format": "gbdt-binary-v1", "note": f"{title}. Columns are wallRunFeatures.RUN_FEATURE_NAMES IN ORDER.", "features": names, "learningRate": GBM["learning_rate"],
               "init": float(np.log(base / (1 - base))), "trees": [tree(e[0].tree_) for e in m.estimators_]}, open(path, "w"), separators=(",", ":"))
    # Parity rows for wallRunFeatures.test.ts: invented, each column uniform over its training range (no plan's rows).
    rng = np.random.default_rng(0)
    lo, hi = X[mask].min(axis=0), X[mask].max(axis=0)
    ctl = lo + rng.random((8, X.shape[1])) * (hi - lo)
    json.dump({"rows": np.round(ctl, 4).tolist(), "expected": m.predict_proba(np.round(ctl, 4))[:, 1].tolist()}, open(path.replace(".json", ".control.json"), "w"))
    imp = sorted(zip(m.feature_importances_, names), reverse=True)[:12]
    print(f"\nwrote {path}; top features: " + ", ".join(f"{n} {v:.2f}" for v, n in imp))
    return m


m_run = export(every, f"{OUTDIR}/wall-run-model.json", "Run on offer: key wall vs not")
m_new = export(reno, f"{OUTDIR}/wall-new-model.json", "Renovation sheet run: new work vs existing or junk") if reno.any() else None
json.dump({"run": r_run, "remove_only": r_rm, "new": r_new}, open(f"{OUTDIR}/loso-summary.json", "w"), indent=1)

if EXAM:
    # ── THE FINAL EXAM: the held-out sets, once, with the models and lines chosen on LOSO ──
    en, er, ek = load(EXAM)
    assert en == names, "exam table columns differ from training"
    EX = np.array([r["x"] for r in er]); eft = np.array([r["ft"] for r in er]); eex = np.minimum(np.array([r["extraFeet"] for r in er]), eft); eok = eft - eex
    ec = lambda n: EX[:, col[n]]
    sc = m_run.predict_proba(EX)[:, 1]
    hp = (ec("keptByCompare") == 1) & (ec("heldOffEstimate") == 0)
    e = lambda post: float((eex * post).sum() + (eok * ~post).sum())
    print(f"\n══ HELD-OUT FINAL EXAM ══ rows {len(er):,}  key ft {sum(ek.values()):,.0f}")
    print(f"total error ft: run model {e(sc >= POST_AT):,.0f}  remove-only {e(hp & (sc >= REMOVE_BELOW)):,.0f}  hand {e(hp):,.0f}")
    # Pre-registered 2026-11-13 before the exam: totals only, remove-only pooled error below hand's.
    print(f"EXAM (remove-only pooled error below hand): {'PASS' if e(hp & (sc >= REMOVE_BELOW)) < e(hp) else 'FAIL'}")
    t = r_run["auto_line"]
    if t is not None:
        a = sc >= t
        print(f"auto-post at the LOSO line {t:.4f}: {eok[a].sum():,.0f} ft ok / {eex[a].sum():,.0f} false = {100 * eok[a].sum() / max(eft[a].sum(), 1):.2f}% (bar 95%)")
