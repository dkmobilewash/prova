"""Score the WALLS stage's wall types against hand-typed answer keys, by footage.

    python3 -I score_types.py RUNS_DIR LABEL.json [LABEL.json ...]
    python3 -I score_types.py --selftest

RUNS_DIR holds `wallTypes.eval.ts` output (`<set>__p<page>.runs.json`, WT_OUT).
Each label file is paired with the runs file of the same set basename and page.
Group (TRAINING / HELDOUT) comes from the runs file's `heldOut` flag.

Matching is a port of apps/web/lib/takeoff/heldOutScore.ts, not a new matcher:
`keyFromLabels` builds the key (accepted + traced, accepted folded longest
first, a trace kept only for what accepted walls do not cover), and a run
covers a key wall when both its ends sit within `matchBandFeet` of the key
wall's line; its `overlapAlong` is the covered stretch.

Metrics, all footage:
  typed / untyped / notfound   share of ALL key ft covered by a typed run, an
                               untyped run, or nothing
  correct_of_typed / wrong / near
                               of the ft a typed run covers on key walls whose
                               key is a legend CODE: right, wrong, or a
                               near-miss (one normalized code a prefix of the
                               other, e.g. A vs A3) — near is neither
  settled_correct              correct ft / ft of key walls whose key is a code
Key walls typed "U" and walls with no wallType ("not marked") are reported
apart and never enter correct/wrong.
"""
import glob
import json
import math
import os
import re
import sys
from collections import defaultdict

SAME_WALL_FEET, FACE_MARGIN_FEET, MAX_BAND_FEET = 1.5, 0.5, 3.0


def norm(code):
    # Diego 2026-11-08: an asterisked variant (Hutto's C6*) is the same type for scoring; the * is a variant note.
    return re.sub(r"[\s\-_.*]+", "", code).upper()


def length(r):
    return math.hypot(r["x2"] - r["x1"], r["y2"] - r["y1"])


def band_feet(a, b):
    thick = max(a.get("t") or 0, b.get("t") or 0)
    return min(MAX_BAND_FEET, max(SAME_WALL_FEET, thick / 2 + FACE_MARGIN_FEET))


def off_line(r, px, py):
    l = length(r)
    if l == 0:
        return math.hypot(px - r["x1"], py - r["y1"])
    return abs((r["x2"] - r["x1"]) * (r["y1"] - py) - (r["x1"] - px) * (r["y2"] - r["y1"])) / l


def interval_along(a, b):
    """The [lo, hi] stretch of `a` (page units from a's start) that `b` lies along, or None."""
    la = length(a)
    if la == 0:
        return None
    ux, uy = (a["x2"] - a["x1"]) / la, (a["y2"] - a["y1"]) / la
    b1 = (b["x1"] - a["x1"]) * ux + (b["y1"] - a["y1"]) * uy
    b2 = (b["x2"] - a["x1"]) * ux + (b["y2"] - a["y1"]) * uy
    lo, hi = max(0.0, min(b1, b2)), min(la, max(b1, b2))
    return (lo, hi) if hi > lo else None


def covers(a, b, fpu):
    band = band_feet(a, b) / fpu
    return max(off_line(a, b["x1"], b["y1"]), off_line(a, b["x2"], b["y2"])) <= band


def uncovered_feet(a, others, fpu):
    covered = sum((iv[1] - iv[0]) for o in others if covers(a, o, fpu) and (iv := interval_along(a, o)))
    return max(0.0, (length(a) - covered) * fpu)


def key_from_labels(label):
    """heldOutScore.ts keyFromLabels, with the label file's `traced` list added where verdicts lack it."""
    fpu = label["feetPerUnit"]
    wall = lambda v: {"x1": v["x1"], "y1": v["y1"], "x2": v["x2"], "y2": v["y2"], "t": v.get("thicknessFeet") or 0, "wallType": v.get("wallType") or None}
    offered = [wall(v) for v in label["verdicts"] if v["verdict"] == "wall"]
    traces = [wall(v) for v in label["verdicts"] if v["verdict"] == "traced"]
    seen = {tuple(round(t[k], 6) for k in ("x1", "y1", "x2", "y2")) for t in traces}
    for t in label.get("traced", []):
        if tuple(round(t[k], 6) for k in ("x1", "y1", "x2", "y2")) not in seen:
            traces.append(wall(t))
    accepted = []
    for run in sorted(offered, key=length, reverse=True):
        if uncovered_feet(run, accepted, fpu) <= 0.5:
            continue
        accepted.append(run)
    key = list(accepted)
    for trace in traces:
        if uncovered_feet(trace, accepted, fpu) > 0.5:
            key.append(trace)
    return key


def split_key_wall(k, runs, fpu):
    """{run type or None: feet} for the stretches runs cover, plus uncovered feet.

    ponytail: where runs of different types overlap on one stretch, its feet are
    split evenly between those types; exact enough while overlaps are slivers.
    """
    ivs = [(iv, r["type"]) for r in runs if covers(k, r, fpu) and (iv := interval_along(k, r))]
    points = sorted({0.0, length(k)} | {p for iv, _ in ivs for p in iv})
    out, lost = defaultdict(float), 0.0
    for lo, hi in zip(points, points[1:]):
        if hi <= lo:
            continue
        mid = (lo + hi) / 2
        types = {t for iv, t in ivs if iv[0] <= mid <= iv[1]}
        if not types:
            lost += (hi - lo) * fpu
        for t in types:
            out[t] += (hi - lo) * fpu / len(types)
    return out, lost


def score(label, runs_doc):
    fpu = label["feetPerUnit"]
    runs = [{**r, "t": (r.get("thicknessIn") or 0) / 12} for r in runs_doc["runs"]]
    s = defaultdict(float)
    confusions, nears = defaultdict(float), defaultdict(float)
    for k in key_from_labels(label):
        ft = length(k) * fpu
        key = k["wallType"]
        kind = "unmarked" if key is None else "U" if norm(key) == "U" else "code"
        s["key"] += ft
        s["key_" + kind] += ft
        split, lost = split_key_wall(k, runs, fpu)
        s["notfound"] += lost
        for t, f in split.items():
            if t is None:
                s["untyped"] += f
                continue
            s["typed"] += f
            if kind != "code":
                s["typed_on_" + kind] += f
            elif norm(t) == norm(key):
                s["correct"] += f
            elif norm(t).startswith(norm(key)) or norm(key).startswith(norm(t)):
                s["near"] += f
                nears[(t, key)] += f
            else:
                s["wrong"] += f
                confusions[(t, key)] += f
    s["typed_code"] = s["correct"] + s["wrong"] + s["near"]
    return s, confusions, nears


def pct(n, d):
    return f"{100 * n / d:.1f}" if d > 0 else "-"


def line(name, s):
    return (
        f"TYPES {name} keyft={s['key']:.0f} typed={pct(s['typed'], s['key'])}% correct_of_typed={pct(s['correct'], s['typed_code'])}% "
        f"wrong={pct(s['wrong'], s['typed_code'])}% untyped={pct(s['untyped'], s['key'])}% notfound={pct(s['notfound'], s['key'])}% "
        f"settled_correct={pct(s['correct'], s['key_code'])}% near={pct(s['near'], s['typed_code'])}%"
    )


def main(runs_dir, label_paths):
    by_name = {}
    for p in glob.glob(os.path.join(runs_dir, "*.runs.json")):
        d = json.load(open(p))
        by_name[(os.path.basename(d["set"]), d["page"])] = d
    groups, rows, extra = defaultdict(lambda: defaultdict(float)), [], []
    for lp in label_paths:
        label = json.load(open(lp))
        doc = by_name.get((label["set"], label["page"]))
        if doc is None:
            sys.exit(f"no runs file for {label['set']} p{label['page']} in {runs_dir} — refusing to score a sheet as zero")
        if abs(doc["feetPerUnit"] - label["feetPerUnit"]) > 1e-6 * label["feetPerUnit"]:
            sys.exit(f"{label['set']} p{label['page']}: runs feetPerUnit {doc['feetPerUnit']} != label {label['feetPerUnit']}")
        s, conf, nears = score(label, doc)
        g = "HELDOUT" if doc.get("heldOut") else "TRAINING"
        for k, v in s.items():
            groups[g][k] += v
        rows.append((g, f"{label['set'][:28]} {label.get('sheet', '')}", s, doc.get("legend") is not None))
        top = sorted(conf.items(), key=lambda kv: -kv[1])[:5]
        extra.append(
            f"  {label['set'][:28]} {label.get('sheet', '')}: confusions "
            + (", ".join(f"{p}->{k} {f:.0f}ft" for (p, k), f in top) or "none")
            + ("; near-misses " + ", ".join(f"{p}->{k} {f:.0f}ft" for (p, k), f in sorted(nears.items(), key=lambda kv: -kv[1])) if nears else "")
            + (f"; typed on U walls {s['typed_on_U']:.0f}ft" if s["typed_on_U"] else "")
            + (f"; typed on not-marked walls {s['typed_on_unmarked']:.0f}ft" if s["typed_on_unmarked"] else "")
        )
    hdr = f"{'group':8} {'sheet':36} {'keyft':>6} {'code':>6} {'U':>5} {'unmkd':>5} {'typed%':>6} {'cor/typ':>7} {'wrong%':>6} {'near%':>5} {'untyp%':>6} {'nofnd%':>6} {'settled':>7} legend"
    print(hdr)
    for g, name, s, has_legend in sorted(rows, key=lambda r: r[0] != "TRAINING"):
        print(
            f"{g:8} {name:36} {s['key']:6.0f} {s['key_code']:6.0f} {s['key_U']:5.0f} {s['key_unmarked']:5.0f} {pct(s['typed'], s['key']):>6} "
            f"{pct(s['correct'], s['typed_code']):>7} {pct(s['wrong'], s['typed_code']):>6} {pct(s['near'], s['typed_code']):>5} "
            f"{pct(s['untyped'], s['key']):>6} {pct(s['notfound'], s['key']):>6} {pct(s['correct'], s['key_code']):>7} {'yes' if has_legend else 'NONE'}"
        )
    print("\n".join(extra))
    for g in ("TRAINING", "HELDOUT"):
        if g in groups:
            print(line(g, groups[g]))


def selftest():
    fpu = 100.0
    label = {"feetPerUnit": fpu, "verdicts": [
        {"x1": 0, "y1": 0, "x2": 0.2, "y2": 0, "thicknessFeet": 0.4, "verdict": "wall", "wallType": "IW-1"},  # 20 ft, code
        {"x1": 0, "y1": 0.5, "x2": 0.1, "y2": 0.5, "thicknessFeet": 0, "verdict": "traced", "wallType": "U"},  # 10 ft, U
        {"x1": 0, "y1": 1, "x2": 0.1, "y2": 1, "thicknessFeet": 0.4, "verdict": "wall"},  # 10 ft, not marked
        {"x1": 0, "y1": 2, "x2": 0.1, "y2": 2, "thicknessFeet": 0.4, "verdict": "not-wall", "wallType": "X"},  # never key
    ], "traced": [{"x1": 0, "y1": 0.5, "x2": 0.1, "y2": 0.5, "wallType": "U"}]}
    runs = {"runs": [
        {"x1": 0, "y1": 0.001, "x2": 0.1, "y2": 0.001, "thicknessIn": 5, "type": "iw1"},  # 10 ft correct (normalized)
        {"x1": 0.1, "y1": 0, "x2": 0.15, "y2": 0, "thicknessIn": 5, "type": "IW-2"},  # 5 ft wrong
        {"x1": 0, "y1": 0.5, "x2": 0.1, "y2": 0.5, "thicknessIn": 5, "type": "IW-1"},  # typed on a U wall
        {"x1": 0, "y1": 0.9, "x2": 0.1, "y2": 0.9, "thicknessIn": 5, "type": "IW-1"},  # 10 ft off: covers nothing
    ]}
    s, conf, _ = score(label, runs)
    near = lambda a, b: abs(a - b) < 1e-6
    assert near(s["key"], 40) and near(s["key_code"], 20) and near(s["key_U"], 10) and near(s["key_unmarked"], 10), dict(s)
    assert near(s["correct"], 10) and near(s["wrong"], 5) and near(s["typed_on_U"], 10), dict(s)
    assert near(s["notfound"], 15), dict(s)  # 5 ft of the code wall + the whole unmarked wall
    assert list(conf) == [("IW-2", "IW-1")] and near(conf[("IW-2", "IW-1")], 5)
    s2, _, nears = score({**label, "verdicts": label["verdicts"][:1], "traced": []}, {"runs": [{**runs["runs"][0], "type": "IW"}]})
    assert near(s2["near"], 10) and near(s2["wrong"], 0) and nears
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    elif len(sys.argv) >= 3:
        main(sys.argv[1], sys.argv[2:])
    else:
        sys.exit(__doc__)
