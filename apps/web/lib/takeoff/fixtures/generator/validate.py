"""Checks every answer sheet for internal consistency and every vector PDF
against its spec. Prints a pass/fail table; exits non-zero on any failure.

    .venv/bin/python validate.py
"""
from __future__ import annotations

import json
import math
import os
import re
import sys

import pdfplumber
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import unary_union

from common import ROOM_TYPES, centerline, footprints, main_piece, opening_point, rooms, wall_by_id, wall_length
from draw import wall_geometry

HERE = os.path.dirname(os.path.abspath(__file__))
TOL_FT = 0.05
MM = 1 / 304.8


def parse_dim(text: str, metric: bool) -> float:
    if metric:
        return int(text) * MM
    m = re.fullmatch(r"(\d+)'-(\d+)(?: (\d+)/(\d+))?\"", text)
    if not m:
        raise ValueError(text)
    ft, inch = int(m.group(1)), int(m.group(2))
    frac = int(m.group(3)) / int(m.group(4)) if m.group(3) else 0
    return ft + (inch + frac) / 12


def load(pid):
    with open(os.path.join(HERE, "spec", f"{pid}.json")) as f:
        spec = json.load(f)
    with open(os.path.join(HERE, "synthetic", pid, "expected.json")) as f:
        exp = json.load(f)
    return spec, exp


def check_geometry(spec, exp):
    union, _ = footprints(spec)
    main, islands = main_piece(union)
    outline = Polygon(main.exterior)
    rms = rooms(spec, union)  # raises if a label is missing, doubled or outside every room
    holes = list(main.interiors)
    if len(rms) != len(holes):
        return False, f"{len(holes)} enclosed spaces, {len(rms)} rooms"
    for r in rms:
        if not outline.buffer(1e-6).contains(r["poly"]):
            return False, f"{r['id']} outside the building outline"
    for i, a in enumerate(rms):
        for b in rms[i + 1:]:
            if a["poly"].intersection(b["poly"]).area > 1e-6:
                return False, f"{a['id']} overlaps {b['id']}"
    if exp["totals"]["room_count"] != len(rms):
        return False, "room_count disagrees"
    return True, f"{len(rms)} rooms closed"


def check_areas(spec, exp):
    union, _ = footprints(spec)
    rsum = sum(r["area_sf"] for r in exp["rooms"])
    gross = exp["totals"]["gross_building_area_sf"]
    err = abs(rsum + union.area - gross) / gross
    return err <= 0.005, f"rooms + walls vs gross: {err * 100:.4f}%"


def check_openings(spec, exp):
    for o in spec["openings"]:
        w = wall_by_id(spec, o["wall"])
        L = wall_length(w)
        if o["at_ft"] - o["width_ft"] / 2 < -1e-9 or o["at_ft"] + o["width_ft"] / 2 > L + 1e-9:
            return False, f"{o['id']} runs off {w['id']}"
        c = Point(opening_point(spec, o))
        if centerline(w).distance(c) > 1e-6:
            return False, f"{o['id']} not on {w['id']}"
    by_wall = {}
    for o in spec["openings"]:
        by_wall.setdefault(o["wall"], []).append((o["at_ft"] - o["width_ft"] / 2, o["at_ft"] + o["width_ft"] / 2, o["id"]))
    for wid, spans in by_wall.items():
        spans.sort()
        for (a0, a1, i0), (b0, b1, i1) in zip(spans, spans[1:]):
            if b0 < a1 - 1e-9:
                return False, f"{i0} overlaps {i1}"
    # An opening must cut only its own wall: never into a crossing or abutting one.
    union, parts = footprints(spec)
    for o in spec["openings"]:
        from common import opening_rect

        r = opening_rect(spec, o, extra=0.0)
        others = unary_union([p for p, w in zip(parts, spec["walls"]) if w["id"] != o["wall"]])
        if r.intersection(others).area > 0.02:
            return False, f"{o['id']} cuts into another wall"
    n = len(spec["openings"])
    if exp["totals"]["door_count"] + exp["totals"]["window_count"] != n:
        return False, "door/window counts disagree"
    return True, f"{n} openings fit"


def segments_ft(page, view, page_h):
    """Every drawn straight segment, converted to building feet with the TRUE scale."""
    ox, oy = view["origin_pt"]
    k = view["pt_per_ft"]
    conv = lambda x, top: ((x - ox) / k, ((page_h - top) - oy) / k)
    segs = []
    for obj in list(page.lines) + list(page.curves) + list(page.rects):
        pts = obj.get("pts")
        if not pts:
            continue
        pts = [conv(x, t) for x, t in pts]
        if obj["object_type"] == "rect" or (obj.get("path") and obj["path"][-1][0] == "h"):
            pts = pts + [pts[0]]
        for a, b in zip(pts, pts[1:]):
            if math.dist(a, b) > 1e-6:
                segs.append((a, b))
    return segs


def check_drawing(spec, exp, page):
    view = spec["placement"]["views"][0]
    union, cut = wall_geometry(spec)
    x0, y0, x1, y1 = view["box_ft"]
    drawn = MultiLineString(segments_ft(page, view, spec["placement"]["page_size_pt"][1]))
    expected = []
    polys = cut.geoms if hasattr(cut, "geoms") else [cut]
    for p in polys:
        for ring in [p.exterior] + list(p.interiors):
            cs = list(ring.coords)
            expected += list(zip(cs, cs[1:]))
    worst = 0.0
    for a, b in expected:
        L = math.dist(a, b)
        n = max(2, int(L / 0.25) + 1)
        for i in range(n + 1):
            q = Point(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
            worst = max(worst, drawn.distance(q))
    ok = worst <= TOL_FT
    return ok, f"{len(expected)} wall edges, worst {worst:.4f} ft"


def check_dims(spec, page):
    metric = spec["units"] == "metric"
    view = spec["placement"]["views"][0]
    k = view["pt_per_ft"]
    H = spec["placement"]["page_size_pt"][1]
    words = page.extract_words(keep_blank_chars=True, use_text_flow=False)
    segs = []
    for obj in list(page.lines):
        segs.append(((obj["pts"][0][0], H - obj["pts"][0][1]), (obj["pts"][-1][0], H - obj["pts"][-1][1])))
    n = 0
    for d in spec["placement"]["dims"]:
        # The printed text, read back from the characters printed where it was
        # drawn, in the dimension line's own direction (vertical strings too).
        (ax, ay), (bx, by) = d["line_pt"]
        L = math.hypot(bx - ax, by - ay)
        ux, uy = (bx - ax) / L, (by - ay) / L
        if math.degrees(math.atan2(uy, ux)) > 90 or math.degrees(math.atan2(uy, ux)) <= -90:
            ux, uy = -ux, -uy
        tx, ty = d["text_pt"]
        near = []
        for ch in page.chars:
            cx, cy = (ch["x0"] + ch["x1"]) / 2, H - (ch["top"] + ch["bottom"]) / 2
            along = (cx - tx) * ux + (cy - ty) * uy
            across = -(cx - tx) * uy + (cy - ty) * ux
            if abs(along) < 3.2 * len(d["text"]) and -2 < across < 9:
                near.append((along, ch["text"]))
        printed = "".join(t for _, t in sorted(near)).replace(" ", "")
        if printed != d["text"].replace(" ", ""):
            return False, f"dimension {d['text']} reads back as {printed!r}"
        value = parse_dim(d["text"], metric)
        # The drawn dimension line it labels, measured off the PDF.
        D1, D2 = d["line_pt"]
        line = [s for s in segs if (math.dist(s[0], D1) < 0.5 and math.dist(s[1], D2) < 0.5) or (math.dist(s[0], D2) < 0.5 and math.dist(s[1], D1) < 0.5)]
        if not line:
            return False, f"no dimension line for {d['text']}"
        measured = math.dist(*line[0]) / k
        if abs(measured - value) > TOL_FT or abs(value - d["distance_ft"]) > TOL_FT:
            return False, f"{d['text']} labels a {measured:.3f} ft line"
        n += 1
    return True, f"{n} dimension strings true"


def check_labels(spec, exp, page):
    union, _ = footprints(spec)
    rms = rooms(spec, union)
    view = spec["placement"]["views"][0]
    ox, oy = view["origin_pt"]
    k = view["pt_per_ft"]
    H = spec["placement"]["page_size_pt"][1]
    names = {r["name"] for r in spec["rooms"]}
    # Room names are the only bold text inside the plan: rebuild each bold line
    # whole, so "BEDROOM" inside "MASTER BEDROOM" is not a second label.
    lines = {}
    for ch in page.chars:
        if ch.get("fontname", "").endswith("Bold"):
            lines.setdefault(round(ch["top"], 1), []).append(ch)
    found = {}
    for top, chars in lines.items():
        chars.sort(key=lambda c: c["x0"])
        groups, cur = [], [chars[0]]
        for a, b in zip(chars, chars[1:]):
            if b["x0"] - a["x1"] > 6:
                groups.append(cur)
                cur = []
            cur.append(b)
        groups.append(cur)
        for g in groups:
            text = "".join(c["text"] for c in g)
            if text not in names:
                continue
            cx, cy = (g[0]["x0"] + g[-1]["x1"]) / 2, H - (g[0]["top"] + g[0]["bottom"]) / 2
            pt = Point((cx - ox) / k, (cy - oy) / k)
            for r in rms:
                if r["poly"].contains(pt):
                    found.setdefault(r["id"], []).append(text)
    for r in rms:
        got = found.get(r["id"], [])
        if got.count(r["name"]) != 1 or len(got) != 1:
            return False, f"{r['id']} carries labels {got}"
        if r["type"] not in ROOM_TYPES:
            return False, f"{r['id']} type {r['type']} not in the list"
    return True, f"{len(rms)} rooms, one label each"


def strip(exp):
    keep = {k: v for k, v in exp.items() if k not in ("id", "file", "kind", "notes", "scale_text", "scale_ratio", "raster", "viewports")}
    return json.dumps(keep, sort_keys=True)


def main():
    ids = sorted(d for d in os.listdir(os.path.join(HERE, "synthetic")) if re.fullmatch(r"S\d\d", d))
    rows = []
    for pid in ids:
        spec, exp = load(pid)
        res = {}
        if "raster_of" in spec:
            src_spec, src_exp = load(spec["raster_of"])
            res["pairs"] = (strip(exp) == strip(src_exp), f"matches {spec['raster_of']}")
            with pdfplumber.open(os.path.join(HERE, "synthetic", pid, "plan_raster.pdf")) as pdf:
                pg = pdf.pages[0]
                image_only = len(pg.chars) == 0 and len(pg.images) == 1 and not pg.lines and not pg.curves
            res["image_only"] = (image_only, "no text layer, one image" if image_only else "has vector or text")
            for k2, fn in (("geometry", check_geometry), ("areas", check_areas), ("openings", check_openings)):
                res[k2] = fn(src_spec, exp)
        else:
            res["geometry"] = check_geometry(spec, exp)
            res["areas"] = check_areas(spec, exp)
            res["openings"] = check_openings(spec, exp)
            with pdfplumber.open(os.path.join(HERE, "synthetic", pid, "plan.pdf")) as pdf:
                pg = pdf.pages[0]
                res["drawing"] = check_drawing(spec, exp, pg)
                res["dims"] = check_dims(spec, pg)
                res["labels"] = check_labels(spec, exp, pg)
            if pid == "S03":
                _, e2 = load("S02")
                res["pairs"] = (strip(exp) == strip(e2), "identical to S02")
        rows.append((pid, res))
    cols = ["geometry", "areas", "openings", "drawing", "dims", "labels", "pairs", "image_only"]
    print(f"{'plan':5} " + " ".join(f"{c:10}" for c in cols) + "  detail")
    failed = 0
    for pid, res in rows:
        cells = []
        for c in cols:
            if c not in res:
                cells.append(f"{'-':10}")
            else:
                cells.append(f"{'PASS' if res[c][0] else 'FAIL':10}")
                failed += 0 if res[c][0] else 1
        detail = "; ".join(f"{c}: {res[c][1]}" for c in cols if c in res and not res[c][0]) or "; ".join(res[c][1] for c in ("drawing", "dims", "pairs") if c in res)
        print(f"{pid:5} " + " ".join(cells) + "  " + detail)
    print(f"\n{len(rows)} plans, {failed} failed checks")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
