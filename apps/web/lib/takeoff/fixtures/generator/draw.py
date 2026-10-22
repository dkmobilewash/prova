"""Draws a spec onto a PDF sheet with reportlab (BSD). Returns the placement and
everything drawn that validate.py needs to check (dimension strings, views)."""
from __future__ import annotations

import math
from typing import List, Tuple

from reportlab.lib.colors import Color, black
from reportlab.pdfgen import canvas
from shapely.geometry import LineString, MultiPolygon, Polygon, box
from shapely.ops import unary_union

from common import centerline, footprints, main_piece, opening_point, opening_rect, rooms, t_ft, wall_by_id

PAGES = {"ANSI_B": (17, 11), "ARCH_C": (24, 18), "ARCH_D": (36, 24)}
MM = 1 / 304.8
GREY = Color(0.3, 0.3, 0.3)


def fmt_ftin(ft: float) -> str:
    total16 = round(ft * 12 * 16)
    f = total16 // (12 * 16)
    rem = total16 - f * 12 * 16
    inch = rem // 16
    frac = rem - inch * 16
    s = ""
    if frac:
        n, d = frac, 16
        while n % 2 == 0:
            n //= 2
            d //= 2
        s = f" {n}/{d}"
    return f"{f}'-{inch}{s}\""


def fmt_dim(spec, ft: float) -> str:
    if spec["units"] == "metric":
        return str(int(round(ft / MM)))
    return fmt_ftin(ft)


class Sheet:
    def __init__(self, path: str, spec: dict):
        self.spec = spec
        w, h = PAGES[spec["page"]]
        self.W, self.H = w * 72, h * 72
        self.c = canvas.Canvas(path, pagesize=(self.W, self.H), invariant=1)
        self.c.setTitle(f"{spec['id']} {spec['title']}")
        self.c.setAuthor("takeoff fixtures (synthetic)")
        self.dims: List[dict] = []

    # transform for one view
    def view(self, origin, k):
        self.o = origin
        self.k = k

    def T(self, p) -> Tuple[float, float]:
        return (self.o[0] + p[0] * self.k, self.o[1] + p[1] * self.k)


def _rings(g):
    polys = g.geoms if isinstance(g, MultiPolygon) else [g]
    for poly in polys:
        if poly.is_empty:
            continue
        yield list(poly.exterior.coords), [list(r.coords) for r in poly.interiors]


def wall_geometry(spec: dict):
    union, _ = footprints(spec)
    cuts = [opening_rect(spec, o) for o in spec["openings"]]
    return union, union.difference(unary_union(cuts)) if cuts else union


def draw_walls(S: Sheet, spec: dict, clip=None, weight=1.0):
    union, cut = wall_geometry(spec)
    if clip is not None:
        cut = cut.intersection(clip)
    c = S.c
    filled = spec["wall_style"] == "filled"
    for ext, holes in _rings(cut):
        p = c.beginPath()
        for ring in [ext] + holes:
            q = [S.T(pt) for pt in ring]
            p.moveTo(*q[0])
            for pt in q[1:]:
                p.lineTo(*pt)
            p.close()
        if filled:
            c.setFillColor(GREY)
            c.setLineWidth(0.35 * weight)
            c.drawPath(p, stroke=1, fill=1, fillMode=0)
        else:
            c.setLineWidth(0.8 * weight)
            c.drawPath(p, stroke=1, fill=0)
    c.setFillColor(black)


def draw_openings(S: Sheet, spec: dict, clip=None):
    c = S.c
    for o in spec["openings"]:
        w = wall_by_id(spec, o["wall"])
        line = centerline(w)
        a = line.interpolate(o["at_ft"] - o["width_ft"] / 2)
        b = line.interpolate(o["at_ft"] + o["width_ft"] / 2)
        if clip is not None and not clip.contains(LineString([(a.x, a.y), (b.x, b.y)]).buffer(0.01)):
            continue
        ux, uy = (b.x - a.x) / o["width_ft"], (b.y - a.y) / o["width_ft"]
        nx, ny = -uy, ux
        t = t_ft(w)
        side = o.get("side", 1)
        c.setLineWidth(0.35)
        if o["kind"] == "window":
            for off in (-t * 0.3, 0, t * 0.3):
                p1 = S.T((a.x + nx * off, a.y + ny * off))
                p2 = S.T((b.x + nx * off, b.y + ny * off))
                c.line(*p1, *p2)
            continue
        st = o["subtype"]
        if st == "cased":
            continue
        if st == "sliding":
            for off, s0, s1 in ((-t / 6, 0, 0.55), (t / 6, 0.45, 1.0)):
                p1 = S.T((a.x + ux * o["width_ft"] * s0 + nx * off, a.y + uy * o["width_ft"] * s0 + ny * off))
                p2 = S.T((a.x + ux * o["width_ft"] * s1 + nx * off, a.y + uy * o["width_ft"] * s1 + ny * off))
                c.line(*p1, *p2)
            continue
        if st == "overhead":
            c.setDash(4, 3)
            for off in (t / 2 + 1, t / 2 + 1.5):
                c.line(*S.T((a.x + nx * off * side, a.y + ny * off * side)), *S.T((b.x + nx * off * side, b.y + ny * off * side)))
            c.setDash()
            continue
        leaves = [(a, (ux, uy), o["width_ft"])] if st == "single_swing" else [(a, (ux, uy), o["width_ft"] / 2), (b, (-ux, -uy), o["width_ft"] / 2)]
        if st == "single_swing" and o.get("hinge"):
            leaves = [(b, (-ux, -uy), o["width_ft"])]
        for hinge, toward, r in leaves:
            H = (hinge.x + nx * side * t / 2, hinge.y + ny * side * t / 2)
            tip = (H[0] + nx * side * r, H[1] + ny * side * r)
            c.line(*S.T(H), *S.T(tip))
            a_leaf = math.degrees(math.atan2(ny * side, nx * side))
            a_jamb = math.degrees(math.atan2(toward[1], toward[0]))
            ext = (a_leaf - a_jamb + 540) % 360 - 180
            Hp = S.T(H)
            R = r * S.k
            c.setLineWidth(0.25)
            c.arc(Hp[0] - R, Hp[1] - R, Hp[0] + R, Hp[1] + R, a_jamb, ext)
            c.setLineWidth(0.35)


def draw_dim(S: Sheet, spec: dict, p1, p2, offset_in: float, record=True):
    """A dimension string between two building points, offset perpendicular on paper."""
    c = S.c
    P1, P2 = S.T(p1), S.T(p2)
    dx, dy = P2[0] - P1[0], P2[1] - P1[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    off = offset_in * 72
    D1 = (P1[0] + nx * off, P1[1] + ny * off)
    D2 = (P2[0] + nx * off, P2[1] + ny * off)
    c.setLineWidth(0.25)
    c.line(*D1, *D2)
    sg = 1 if off > 0 else -1
    for P, D in ((P1, D1), (P2, D2)):
        c.line(P[0] + nx * sg * 3, P[1] + ny * sg * 3, D[0] + nx * sg * 4, D[1] + ny * sg * 4)
        tx, ty = (ux + nx) / math.sqrt(2), (uy + ny) / math.sqrt(2)
        c.setLineWidth(0.6)
        c.line(D[0] - tx * 3, D[1] - ty * 3, D[0] + tx * 3, D[1] + ty * 3)
        c.setLineWidth(0.25)
    dist = math.dist(p1, p2)
    text = fmt_dim(spec, dist)
    mx, my = (D1[0] + D2[0]) / 2, (D1[1] + D2[1]) / 2
    ang = math.degrees(math.atan2(uy, ux))
    if ang > 90 or ang <= -90:
        ang += 180
    c.saveState()
    c.translate(mx, my)
    c.rotate(ang)
    c.setFont("Helvetica", 6.5)
    c.drawCentredString(0, 2.5, text)
    c.restoreState()
    if record:
        S.dims.append({"p1_ft": list(p1), "p2_ft": list(p2), "text": text, "distance_ft": dist, "line_pt": [list(D1), list(D2)], "text_pt": [mx + 2.5 * math.cos(math.radians(ang + 90)), my + 2.5 * math.sin(math.radians(ang + 90))]})


def auto_dims(S: Sheet, spec: dict, hard: bool):
    union, _ = footprints(spec)
    main, _ = main_piece(union)
    x0, y0, x1, y1 = main.bounds
    walls = spec["walls"]
    # South chain: outer faces plus every interior wall that meets the south edge.
    xs = {round(x0, 6), round(x1, 6)}
    ys = {round(y0, 6), round(y1, 6)}
    for w in walls:
        if w["exterior"] or w.get("arc") or w.get("height_ft"):
            continue
        a, b = w["a"], w["b"]
        if abs(a[0] - b[0]) < 1e-9 and min(a[1], b[1]) <= y0 + t_ft(w) + 1.0:
            xs.add(round(a[0], 6))
        if abs(a[1] - b[1]) < 1e-9 and min(a[0], b[0]) <= x0 + t_ft(w) + 1.0:
            ys.add(round(a[1], 6))
    xs, ys = sorted(xs), sorted(ys)
    for i in range(len(xs) - 1):
        draw_dim(S, spec, (xs[i], y0), (xs[i + 1], y0), -0.45)
    draw_dim(S, spec, (x0, y0), (x1, y0), -0.85)
    for i in range(len(ys) - 1):
        draw_dim(S, spec, (x0, ys[i]), (x0, ys[i + 1]), 0.45)
    draw_dim(S, spec, (x0, y0), (x0, y1), 0.85)
    if hard:
        # North overall and an interior chain through the middle.
        draw_dim(S, spec, (x0, y1), (x1, y1), 0.45)
        draw_dim(S, spec, (x1, y0), (x1, y1), -0.45)
        # Through the middle, but clear of every room label (name, number, area).
        clear = 1.6 * 72 / S.k * 0.3
        ymid = (y0 + y1) / 2 + 0.37
        for dy in (0, 2.5, -2.5, 5, -5, 7.5, -7.5):
            cand = (y0 + y1) / 2 + 0.37 + dy
            if all(abs(cand - r["label_at"][1]) > clear for r in spec["rooms"]):
                ymid = cand
                break
        xin = sorted({round(w["a"][0], 6) for w in walls if not w["exterior"] and not w.get("arc") and abs(w["a"][0] - w["b"][0]) < 1e-9 and min(w["a"][1], w["b"][1]) <= ymid <= max(w["a"][1], w["b"][1])})
        pts = [x0] + xin + [x1]
        for i in range(len(pts) - 1):
            if pts[i + 1] - pts[i] > 3:
                draw_dim(S, spec, (pts[i], ymid), (pts[i + 1], ymid), 0.0)


def draw_rooms(S: Sheet, spec: dict, rms):
    c = S.c
    metric = spec["units"] == "metric"
    for r in rms:
        x, y = S.T(r["label_at"])
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(x, y + 2, r["name"])
        c.setFont("Helvetica", 7)
        c.drawCentredString(x, y - 7, r["number"])
        if r.get("show_area"):
            area = r["poly"].area
            c.setFont("Helvetica", 6)
            c.drawCentredString(x, y - 15, f"{area * 0.09290304:.1f} m2" if metric else f"{round(area)} SF")


def furniture(S: Sheet, spec: dict, rms, level: str):
    """Blocks inside rooms. Unlabelled, so no text lands in a room but its label."""
    c = S.c
    c.setLineWidth(0.3)

    def rect(poly: Polygon, x, y, w, h):
        r = box(x, y, x + w, y + h)
        if not poly.buffer(-0.3).contains(r):
            return False
        p = c.beginPath()
        q = [S.T(pt) for pt in r.exterior.coords]
        p.moveTo(*q[0])
        for pt in q[1:]:
            p.lineTo(*pt)
        c.drawPath(p, stroke=1, fill=0)
        return True

    def circ(poly, x, y, r):
        if not poly.buffer(-0.2).contains(box(x - r, y - r, x + r, y + r)):
            return
        X, Y = S.T((x, y))
        c.circle(X, Y, r * S.k, stroke=1, fill=0)

    for rm in rms:
        poly = rm["poly"]
        bx0, by0, bx1, by1 = poly.bounds
        cx, cy = poly.centroid.x, poly.centroid.y
        ty = rm["type"]
        fixtures = ty in ("bathroom", "restroom", "kitchen", "laundry", "break_room")
        if level == "medium" and not fixtures:
            continue
        if level == "easy":
            continue
        if ty == "bedroom":
            rect(poly, bx0 + 0.6, cy - 2.5, 6.67, 5)
            rect(poly, bx0 + 0.6, cy + 2.7, 1.5, 1.5)
        elif ty in ("living", "family"):
            rect(poly, bx0 + 0.8, by0 + 0.8, 7, 3)
            rect(poly, bx0 + 2.3, by0 + 4.5, 4, 2)
            circ(poly, bx0 + 9.5, by0 + 2.5, 1.2)
        elif ty == "dining":
            rect(poly, cx - 3, cy + 0.6, 6, 3.5)
            for i in range(3):
                rect(poly, cx - 2.7 + i * 2.1, cy + 4.4, 1.5, 1.5)
                rect(poly, cx - 2.7 + i * 2.1, cy - 1.3, 1.5, 1.5)
        elif ty == "kitchen":
            rect(poly, bx0 + 0.5, by1 - 2.5, min(10, bx1 - bx0 - 1), 2)
            rect(poly, bx1 - 2.5, by0 + 0.5, 2, min(8, by1 - by0 - 3.5))
            rect(poly, bx0 + 3, by1 - 2.3, 2.5, 1.6)
            if (bx1 - bx0) > 11 and (by1 - by0) > 11:
                rect(poly, cx - 3, cy - 1.5, 6, 3)
        elif ty in ("bathroom", "restroom"):
            rect(poly, bx0 + 0.4, by1 - 1.0, 1.7, 0.7)
            circ(poly, bx0 + 1.25, by1 - 2.0, 0.7)
            rect(poly, bx1 - 2.2, by1 - 2.0, 1.8, 1.6)
            if (bx1 - bx0) >= 8 and (by1 - by0) >= 7:
                rect(poly, bx0 + 0.4, by0 + 0.4, 5, 2.5)
        elif ty == "laundry":
            rect(poly, bx0 + 0.4, by0 + 0.4, 2.4, 2.4)
            rect(poly, bx0 + 3.0, by0 + 0.4, 2.4, 2.4)
        elif ty == "office":
            rect(poly, cx - 2.5, cy + 1.5, 5, 2.5)
            circ(poly, cx, cy + 0.6, 0.8)
        elif ty == "conference":
            rect(poly, cx - 5, cy - 2, 10, 4)
        elif ty == "open_office":
            for i in range(6):
                for j in range(2):
                    rect(poly, bx0 + 4 + i * 14, by0 + 20 + j * 8, 6, 6)
        elif ty == "garage":
            rect(poly, cx - 8, cy - 3.25, 16, 6.5)
        elif ty == "break_room":
            rect(poly, cx - 2, cy - 1.5, 4, 3)


def grid(S: Sheet, spec: dict):
    g = spec.get("grid")
    if not g:
        return
    c = S.c
    union, _ = footprints(spec)
    x0, y0, x1, y1 = main_piece(union)[0].bounds
    c.setLineWidth(0.25)
    c.setDash([14, 3, 3, 3], 0)
    ext = 1.4 * 72 / S.k
    for i, x in enumerate(g["x"]):
        c.line(*S.T((x, y0 - 1)), *S.T((x, y1 + ext)))
    for j, y in enumerate(g["y"]):
        c.line(*S.T((x0 - ext, y)), *S.T((x1 + 1, y)))
    c.setDash()
    c.setFont("Helvetica", 9)
    for i, x in enumerate(g["x"]):
        X, Y = S.T((x, y1 + ext))
        c.circle(X, Y + 10, 10)
        c.drawCentredString(X, Y + 6.5, str(i + 1))
    for j, y in enumerate(g["y"]):
        X, Y = S.T((x0 - ext, y))
        c.circle(X - 10, Y, 10)
        c.drawCentredString(X - 10, Y - 3.5, "ABCDEFG"[j])


def north_arrow(c, x, y):
    c.setLineWidth(0.5)
    c.circle(x, y, 14)
    p = c.beginPath()
    p.moveTo(x, y + 14)
    p.lineTo(x - 5, y - 8)
    p.lineTo(x + 5, y - 8)
    p.close()
    c.drawPath(p, stroke=1, fill=1)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(x, y + 18, "N")


def scale_bar(S: Sheet, spec: dict, x, y):
    c = S.c
    metric = spec["units"] == "metric"
    marks = [0, 1, 2, 5] if metric else ([0, 4, 8, 16] if spec["scale_ratio"] <= 48 else [0, 8, 16, 32])
    unit_ft = 1000 * MM if metric else 1
    c.setLineWidth(0.4)
    for i in range(len(marks) - 1):
        xa = x + marks[i] * unit_ft * S.k
        xb = x + marks[i + 1] * unit_ft * S.k
        c.setFillColor(black if i % 2 == 0 else Color(1, 1, 1))
        c.rect(xa, y, xb - xa, 4, stroke=1, fill=1)
    c.setFillColor(black)
    c.setFont("Helvetica", 6)
    for m in marks:
        c.drawCentredString(x + m * unit_ft * S.k, y - 8, f"{m}{' m' if metric and m == marks[-1] else ''}{chr(39) if not metric and m == marks[-1] else ''}")


def title_block(S: Sheet, spec: dict, scale_line: str | None):
    c = S.c
    W, H = S.W, S.H
    c.setLineWidth(1.2)
    c.rect(18, 18, W - 36, H - 36)
    x0 = W - 18 - 180
    c.setLineWidth(0.8)
    c.line(x0, 18, x0, H - 18)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x0 + 10, H - 44, "SYNTHETIC FIXTURE")
    c.setFont("Helvetica", 6)
    c.drawString(x0 + 10, H - 56, "NOT A REAL PROJECT - TEST DATA")
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x0 + 10, H - 120, spec["title"][:28])
    c.setFont("Helvetica", 7)
    c.drawString(x0 + 10, H - 134, f"PLAN {spec['id']}")
    c.drawString(x0 + 10, 150, "DATE: 10/15/2026")
    if scale_line:
        c.drawString(x0 + 10, 136, f"SCALE: {scale_line}")
    c.setFont("Helvetica-Bold", 26)
    c.drawString(x0 + 10, 40, "A-101")
    for y in (H - 160, 170, 100):
        c.line(x0, y, W - 18, y)


def notes(c, x, y):
    lines = ["GENERAL NOTES", "1. DIMENSIONS TO FACE OF FRAMING OR", "   CENTERLINE OF WALL U.N.O.", "2. VERIFY ALL DIMENSIONS IN FIELD.", "3. DO NOT SCALE DRAWING.", "4. ALL INTERIOR WALLS 2X4 U.N.O."]
    c.setFont("Helvetica", 6.5)
    for i, s in enumerate(lines):
        c.drawString(x, y - i * 9, s)


def section_mark(c, x, y, label):
    c.setLineWidth(0.5)
    c.circle(x, y, 9)
    c.line(x - 9, y, x + 9, y)
    c.setFont("Helvetica", 5.5)
    c.drawCentredString(x, y + 2, label.split("/")[0])
    c.drawCentredString(x, y - 6, label.split("/")[1])


def render(spec: dict, path: str) -> dict:
    S = Sheet(path, spec)
    c = S.c
    union, _ = footprints(spec)
    main, _ = main_piece(union)
    rms = rooms(spec, union)
    k = 72 * 12 / spec["scale_ratio"]
    x0, y0, x1, y1 = main.bounds
    # Drawing area: inside the border, left of the title strip, above the title band.
    ax0, ax1 = 18 + 72, S.W - 18 - 180 - 54
    ay0, ay1 = 18 + 110, S.H - 18 - 72
    views = spec.get("views") or []
    if views:
        ax1_main = ax0 + (ax1 - ax0) * 0.55
    else:
        ax1_main = ax1
    wft, hft = (x1 - x0) * k, (y1 - y0) * k
    if wft > ax1_main - ax0 - 72 or hft > ay1 - ay0 - 72:
        raise ValueError(f"{spec['id']}: plan does not fit the {spec['page']} sheet at 1:{spec['scale_ratio']}")
    ox = (ax0 + ax1_main) / 2 - (x0 + x1) / 2 * k
    oy = (ay0 + ay1) / 2 - (y0 + y1) / 2 * k
    S.view((ox, oy), k)
    hard = spec["clutter"] == "hard"
    if hard:
        grid(S, spec)
    draw_walls(S, spec)
    draw_openings(S, spec)
    furniture(S, spec, rms, spec["clutter"])
    draw_rooms(S, spec, rms)
    auto_dims(S, spec, hard)
    # Drawing title and the printed scale (or not).
    tx, ty = ax0 + 20, ay0 - 50
    c.setLineWidth(0.6)
    c.circle(tx, ty + 4, 11)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(tx, ty + 1, "1")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(tx + 20, ty, "FLOOR PLAN")
    c.line(tx + 20, ty - 4, tx + 240, ty - 4)
    printed = spec.get("scale_text_printed")
    if printed:
        c.setFont("Helvetica", 7.5)
        c.drawString(tx + 20, ty - 15, f"SCALE: {printed}")
    if spec.get("scale_bar") or spec["id"] in ("S04", "S08", "S13"):
        scale_bar(S, spec, tx + 260, ty)
    if spec["clutter"] in ("medium", "hard"):
        north_arrow(c, ax1 - 20, ay1 - 20)
    if hard:
        notes(c, ax1 - 160, ay0 - 20)
        section_mark(c, S.T(((x0 + x1) / 2, y1 + 6))[0], S.T(((x0 + x1) / 2, y1 + 6))[1], "1/A-301")
        section_mark(c, S.T((x1 + 6, (y0 + y1) / 2))[0], S.T((x1 + 6, (y0 + y1) / 2))[1], "2/A-301")
    placements = [{"name": "FLOOR PLAN", "origin_pt": [ox, oy], "pt_per_ft": k, "scale_ratio": spec["scale_ratio"], "box_ft": [x0, y0, x1, y1]}]
    # Second view: an enlarged plan at its own scale.
    for v in views:
        kv = 72 * 12 / v["scale_ratio"]
        bx0, by0, bx1, by1 = v["box_ft"]
        vx0 = ax1_main + 36
        ovx = (vx0 + ax1) / 2 - (bx0 + bx1) / 2 * kv
        ovy = (ay0 + ay1) / 2 - (by0 + by1) / 2 * kv
        S.view((ovx, ovy), kv)
        clip = box(bx0, by0, bx1, by1)
        draw_walls(S, spec, clip=clip)
        draw_openings(S, spec, clip=clip)
        furniture(S, spec, [r for r in rms if clip.contains(r["poly"].representative_point())], "medium")
        c.setFont("Helvetica-Bold", 12)
        c.drawString(vx0, ay0 - 50, v["name"])
        c.setFont("Helvetica", 7.5)
        c.drawString(vx0, ay0 - 65, f"SCALE: {v['scale_text']}")
        c.setLineWidth(0.6)
        c.line(vx0, ay0 - 54, vx0 + 220, ay0 - 54)
        placements.append({"name": v["name"], "origin_pt": [ovx, ovy], "pt_per_ft": kv, "scale_ratio": v["scale_ratio"], "box_ft": v["box_ft"]})
        S.view((ox, oy), k)
    tb = spec.get("scale_text_printed")
    title_block(S, spec, tb if tb else None)
    c.showPage()
    c.save()
    return {"page_size_pt": [S.W, S.H], "views": placements, "dims": S.dims}
