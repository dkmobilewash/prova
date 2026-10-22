"""The 20 plans, as specs in real-world units. This file is the source of truth.

Coordinates are wall CENTERLINES in feet (metric plans are authored in
millimetres and converted). Walls meet centerline-to-centerline; a T branch ends
on the through wall's centerline. Openings are placed by distance along their
wall from its start point.
"""
from __future__ import annotations

import math

# Wall types used across the set.
INT4 = ("INT-2x4", 4.5)
EXT6 = ("EXT-2x6", 6.5)
CMU8 = ("CMU-8", 8.0)
MAS12 = ("EXT-MASONRY-12", 12.0)
# Metric equivalents (thickness in inches, rounded from mm).
M_INT = ("INT-115mm", round(115 / 25.4, 4))
M_BLK = ("BLOCK-200mm", round(200 / 25.4, 4))
M_EXT = ("EXT-300mm", round(300 / 25.4, 4))

MM = 1 / 304.8  # feet per millimetre


class P:
    """A plan under construction."""

    def __init__(self, pid, title, scale_ratio, scale_text, page, style, clutter, ceiling, notes, units="imperial"):
        self.s = {
            "id": pid,
            "title": title,
            "units": units,
            "scale_ratio": scale_ratio,
            "scale_text": scale_text,
            "scale_text_printed": scale_text,
            "page": page,
            "wall_style": style,
            "clutter": clutter,
            "ceiling_height_ft": ceiling,
            "walls": [],
            "openings": [],
            "rooms": [],
            "notes": notes,
            "scale_bar": False,
            "grid": None,
            "views": [],
        }
        self.n = 0
        self.dn = 0
        self.wn = 0

    def wall(self, a, b, kind, ext=False, height=None, arc=None, wid=None):
        self.n += 1
        w = {"id": wid or f"W{self.n}", "a": [float(a[0]), float(a[1])], "b": [float(b[0]), float(b[1])], "type": kind[0], "thickness_in": kind[1], "exterior": ext}
        if height:
            w["height_ft"] = height
        if arc:
            w["arc"] = arc
        self.s["walls"].append(w)
        return w["id"]

    def loop(self, pts, kind, kinds=None):
        """Exterior walls around a closed polygon of centerline points."""
        ids = []
        for i, a in enumerate(pts):
            b = pts[(i + 1) % len(pts)]
            ids.append(self.wall(a, b, (kinds or {}).get(i, kind), ext=True))
        return ids

    def door(self, wall, at, width=3.0, subtype="single_swing", side=1, hinge=0):
        self.dn += 1
        self.s["openings"].append({"id": f"D{self.dn}", "kind": "door", "subtype": subtype, "wall": wall, "at_ft": float(at), "width_ft": float(width), "side": side, "hinge": hinge})

    def window(self, wall, at, width=4.0):
        self.wn += 1
        self.s["openings"].append({"id": f"WN{self.wn}", "kind": "window", "subtype": "fixed" if width > 5 else "sliding", "wall": wall, "at_ft": float(at), "width_ft": float(width), "side": 1, "hinge": 0})

    def room(self, rid, name, number, rtype, at, show_area=False):
        self.s["rooms"].append({"id": rid, "label": f"{name} {number}".strip(), "name": name, "number": number, "type": rtype, "label_at": [float(at[0]), float(at[1])], "show_area": show_area})

    def done(self):
        return self.s


def at_x(p: P, wid: str, x: float) -> float:
    """Distance along a straight horizontal/vertical wall to a coordinate."""
    w = next(w for w in p.s["walls"] if w["id"] == wid)
    a, b = w["a"], w["b"]
    if abs(a[1] - b[1]) < 1e-9:
        return abs(x - a[0])
    return abs(x - a[1])


def S01():
    p = P("S01", "STUDIO OFFICE", 48, '1/4" = 1\'-0"', "ANSI_B", "pairs", "easy", 9.0, "Baseline: one rectangular room, two wall types (2x6 and an 8\" CMU north wall), one door, two windows.")
    s, e, n, w = p.loop([(0, 0), (24, 0), (24, 16), (0, 16)], EXT6, {2: CMU8})
    p.door(s, 6)
    p.window(e, 8, 4)
    p.window(n, 12, 5)
    p.room("R101", "OFFICE", "101", "office", (12, 8), show_area=True)
    return p.done()


def house_2bed(pid, ratio, scale_text, page, notes):
    p = P(pid, "TWO-BEDROOM COTTAGE", ratio, scale_text, page, "pairs", "easy", 8.0, notes)
    s, e, n, w = p.loop([(0, 0), (40, 0), (40, 28), (0, 28)], EXT6)
    x16 = p.wall((16, 0), (16, 28), INT4)
    y16w = p.wall((0, 16), (16, 16), INT4)
    y12 = p.wall((16, 12), (40, 12), INT4)
    y16e = p.wall((16, 16), (40, 16), INT4)
    x26 = p.wall((26, 16), (26, 28), INT4)
    p.door(s, 8, 3.0)
    p.door(x16, 14, 3.0, "cased")
    p.door(y16w, 8, 8.0, "cased")
    p.door(y12, at_x(p, y12, 22), 3.0, side=-1)
    p.door(y16e, at_x(p, y16e, 20), 2.5)
    p.door(y16e, at_x(p, y16e, 31), 3.0)
    p.window(s, 4, 4)
    p.window(s, 28, 5)
    p.window(n, at_x(p, n, 33), 4)
    p.window(n, at_x(p, n, 8), 4)
    p.window(w, 6, 3)
    p.room("R101", "LIVING", "101", "living", (8, 8))
    p.room("R102", "KITCHEN", "102", "kitchen", (8, 22))
    p.room("R103", "HALL", "103", "hallway", (28, 14))
    p.room("R104", "BEDROOM", "104", "bedroom", (28, 6))
    p.room("R105", "BATH", "105", "bathroom", (21, 22))
    p.room("R106", "BEDROOM", "106", "bedroom", (33, 22))
    return p.done()


def S02():
    return house_2bed("S02", 48, '1/4" = 1\'-0"', "ARCH_C", "Basic residential: six rooms, 2x6 exterior and 2x4 interior, T junctions on both sides of a hall.")


def S03():
    return house_2bed("S03", 96, '1/8" = 1\'-0"', "ANSI_B", "S02 drawn at 1/8\" = 1'-0\": every answer is identical to S02.")


def S04():
    p = P("S04", "THREE-BEDROOM HOUSE", 48, '1/4" = 1\'-0"', "ARCH_C", "filled", "medium", 9.0, "Revit-style filled wall polygons; ten rooms; an L-shaped hall formed by two L-corners.")
    s, e, n, w = p.loop([(0, 0), (50, 0), (50, 40), (0, 40)], EXT6)
    x22 = p.wall((22, 0), (22, 40), INT4)
    y16 = p.wall((0, 16), (22, 16), INT4)
    x12 = p.wall((12, 16), (12, 40), INT4)
    y10 = p.wall((22, 10), (28, 10), INT4)
    x28a = p.wall((28, 0), (28, 22), INT4)
    x28b = p.wall((28, 26), (28, 40), INT4)
    y14 = p.wall((28, 14), (50, 14), INT4)
    y22 = p.wall((28, 22), (50, 22), INT4)
    y26 = p.wall((28, 26), (50, 26), INT4)
    x38 = p.wall((38, 14), (38, 22), INT4)
    x39 = p.wall((39, 26), (39, 40), INT4)
    p.door(s, 25, 3.0, side=1)
    p.door(x22, 5, 4.0, "cased")
    p.door(x22, 30, 3.0)
    p.door(y16, 6, 6.0, "cased")
    p.door(x12, 12, 5.0, "cased")
    p.door(x28a, 7, 3.0, side=-1)
    p.door(y14, at_x(p, y14, 44), 2.5, side=1)
    p.door(y22, at_x(p, y22, 32), 2.5, side=-1)
    p.door(y26, at_x(p, y26, 33), 3.0)
    p.door(y26, at_x(p, y26, 44), 3.0)
    for x, wd in ((10, 5), (40, 5)):
        p.window(s, x, wd)
    for x, wd in ((6, 4), (17, 4), (33, 4), (45, 4)):
        p.window(n, at_x(p, n, x), wd)
    p.window(e, 7, 4)
    p.window(e, 18, 2.5)
    p.window(w, at_x(p, w, 8), 5)
    p.room("R101", "LIVING", "101", "living", (11, 8), True)
    p.room("R102", "DINING", "102", "dining", (6, 28), True)
    p.room("R103", "KITCHEN", "103", "kitchen", (17, 28), True)
    p.room("R104", "ENTRY", "104", "entry", (25, 5), True)
    p.room("R105", "HALL", "105", "hallway", (25, 30))
    p.room("R106", "MASTER BEDROOM", "106", "bedroom", (39, 7), True)
    p.room("R107", "MASTER BATH", "107", "bathroom", (44, 18))
    p.room("R108", "BATH", "108", "bathroom", (33, 18))
    p.room("R109", "BEDROOM", "109", "bedroom", (33.5, 33), True)
    p.room("R110", "BEDROOM", "110", "bedroom", (44.5, 33), True)
    return p.done()


def S05():
    p = P("S05", "L-SHAPED RESIDENCE", 64, '3/16" = 1\'-0"', "ARCH_C", "pairs", "medium", 9.0, "Non-rectangular L footprint with a reflex corner; an 8\" CMU wall between garage and house; a 16' overhead door.")
    s, e, n1, we, wn, w = p.loop([(0, 0), (44, 0), (44, 20), (20, 20), (20, 44), (0, 44)], EXT6)
    x24 = p.wall((24, 0), (24, 20), CMU8)
    y20 = p.wall((0, 20), (20, 20), INT4)
    x14 = p.wall((14, 0), (14, 20), INT4)
    y12 = p.wall((14, 12), (24, 12), INT4)
    x9 = p.wall((9, 20), (9, 44), INT4)
    x13 = p.wall((13, 20), (13, 44), INT4)
    y32a = p.wall((0, 32), (9, 32), INT4)
    y32b = p.wall((13, 32), (20, 32), INT4)
    p.door(s, 7, 3.0)
    p.door(x14, 6, 4.0, "cased")
    p.door(y12, at_x(p, y12, 19), 2.5)
    p.door(x24, 16, 3.0, side=-1)
    p.door(s, 34, 16.0, "overhead")
    p.door(y20, 11, 3.0)
    p.door(x9, 6, 3.0, side=-1)
    p.door(x9, 18, 3.0, side=-1)
    p.door(x13, 6, 4.0, "sliding")
    p.door(x13, 18, 2.5)
    p.window(s, 19, 4)
    p.window(w, at_x(p, w, 10), 5)
    p.window(w, at_x(p, w, 26), 4)
    p.window(wn, at_x(p, wn, 4), 4)
    p.window(wn, at_x(p, wn, 17), 2.5)
    p.room("R101", "LIVING", "101", "living", (7, 10))
    p.room("R102", "KITCHEN", "102", "kitchen", (19, 6))
    p.room("R103", "LAUNDRY", "103", "laundry", (19, 16))
    p.room("R104", "GARAGE", "104", "garage", (34, 10))
    p.room("R105", "HALL", "105", "hallway", (11, 30))
    p.room("R106", "BEDROOM", "106", "bedroom", (4.5, 26))
    p.room("R107", "BEDROOM", "107", "bedroom", (4.5, 38))
    p.room("R108", "CLOSET", "108", "closet", (16.5, 26))
    p.room("R109", "BATH", "109", "bathroom", (16.5, 38))
    return p.done()


def S06():
    p = P("S06", "HOUSE WITH ANGLED WING", 48, '1/4" = 1\'-0"', "ARCH_C", "filled", "medium", 9.0, "A 45-degree wing: four angled walls, a 135-degree outside corner pair, an angled interior wall with two doors, Revit-style filled walls.")
    c = math.sqrt(0.5)
    Q1 = (32, 12)
    Q2 = (20, 24)
    D = (Q1[0] + 14 * c, Q1[1] + 14 * c)
    E = (Q2[0] + 14 * c, Q2[1] + 14 * c)
    s, e, cd, de, ef, fg, ga = p.loop([(0, 0), (32, 0), Q1, D, E, Q2, (0, 24)], EXT6, {0: MAS12})
    base = p.wall(Q1, Q2, INT4)
    M1 = ((Q1[0] + Q2[0]) / 2, (Q1[1] + Q2[1]) / 2)
    M2 = (M1[0] + 14 * c, M1[1] + 14 * c)
    mid = p.wall(M1, M2, INT4)
    x16 = p.wall((16, 0), (16, 24), INT4)
    p.door(s, 8, 3.0)
    p.door(x16, 12, 5.0, "cased")
    blen = math.dist(Q1, Q2)
    p.door(base, blen * 0.25, 3.0)
    p.door(base, blen * 0.75, 3.0)
    p.window(s, 24, 5)
    p.window(ga, 12, 5)
    p.window(de, math.dist(D, E) * 0.25, 3)
    p.window(de, math.dist(D, E) * 0.75, 3)
    p.window(cd, 7, 4)
    p.room("R101", "LIVING", "101", "living", (8, 12), True)
    p.room("R102", "KITCHEN / DINING", "102", "kitchen", (24, 7), True)
    p.room("R103", "BEDROOM", "103", "bedroom", (Q1[0] - 3 * c + 7 * c, Q1[1] + 3 * c + 7 * c), True)
    p.room("R104", "BATH", "104", "bathroom", (Q2[0] + 3 * c + 7 * c, Q2[1] - 3 * c + 7 * c), True)
    return p.done()


def S07():
    p = P("S07", "COTTAGE WITH BAY", 48, '1/4" = 1\'-0"', "ARCH_C", "pairs", "medium", 9.0, "A curved bay wall: arc of radius 7.21' from (12,0) to (24,0); arc length is the centerline length.")
    cx, cy, r = 18.0, 4.0, math.hypot(6, 4)
    a0 = math.degrees(math.atan2(-4, -6))
    a1 = math.degrees(math.atan2(-4, 6))
    s1 = p.wall((0, 0), (12, 0), EXT6, ext=True)
    bay = p.wall((12, 0), (24, 0), EXT6, ext=True, arc={"center": [cx, cy], "radius": r, "start_deg": a0, "end_deg": a1 if a1 > a0 else a1 + 360})
    s2 = p.wall((24, 0), (36, 0), EXT6, ext=True)
    e = p.wall((36, 0), (36, 26), EXT6, ext=True)
    n = p.wall((36, 26), (0, 26), EXT6, ext=True)
    w = p.wall((0, 26), (0, 0), EXT6, ext=True)
    y14 = p.wall((0, 14), (36, 14), INT4)
    x25 = p.wall((25, 0), (25, 14), INT4)
    x18 = p.wall((18, 14), (18, 26), INT4)
    x26 = p.wall((26, 14), (26, 26), INT4)
    p.door(e, 7, 3.0, side=-1)
    p.door(x25, 7, 5.0, "cased")
    p.door(y14, 9, 3.0)
    p.door(y14, 22, 2.5)
    p.door(y14, 31, 3.0)
    p.window(n, at_x(p, n, 9), 4)
    p.window(n, at_x(p, n, 31), 4)
    p.window(w, at_x(p, w, 7), 5)
    p.window(s1, 6, 3)
    p.window(s2, 6, 4)
    p.room("R101", "LIVING", "101", "living", (12, 6))
    p.room("R102", "KITCHEN", "102", "kitchen", (30.5, 7))
    p.room("R103", "BEDROOM", "103", "bedroom", (9, 20))
    p.room("R104", "BATH", "104", "bathroom", (22, 20))
    p.room("R105", "BEDROOM", "105", "bedroom", (31, 20))
    return p.done()


def S08():
    p = P("S08", "FOUR-BEDROOM RESIDENCE", 48, '1/4" = 1\'-0"', "ARCH_D", "pairs", "hard", 9.0, "Heavy clutter: furniture, kitchen and bath fixtures, dense dimension strings, grid bubbles, section marks, notes. 13 rooms, 12\" masonry west wall.")
    s, e, n, w = p.loop([(0, 0), (56, 0), (56, 40), (0, 40)], EXT6, {3: MAS12})
    y18 = p.wall((0, 18), (56, 18), INT4)
    y22 = p.wall((0, 22), (56, 22), INT4)
    x18 = p.wall((18, 0), (18, 18), INT4)
    x24 = p.wall((24, 0), (24, 18), INT4)
    x36 = p.wall((36, 0), (36, 18), INT4)
    x48 = p.wall((48, 0), (48, 18), INT4)
    y8 = p.wall((48, 8), (56, 8), INT4)
    x14 = p.wall((14, 22), (14, 40), INT4)
    x22 = p.wall((22, 22), (22, 40), INT4)
    y31 = p.wall((14, 31), (22, 31), INT4)
    x33 = p.wall((33, 22), (33, 40), INT4)
    x44 = p.wall((44, 22), (44, 40), INT4)
    p.door(s, 21, 3.5)
    p.door(x18, 9, 4.0, "cased")
    p.door(x24, 9, 4.0, "cased")
    p.door(x36, 9, 6.0, "cased")
    p.door(x48, 4, 2.67, side=-1)
    p.door(x48, 13, 4.0, "cased")
    p.door(y18, 21, 3.0, "cased")
    p.door(y18, 9, 3.0, side=-1)
    p.door(y18, 42, 3.0, side=-1)
    p.door(y18, 52, 3.0, side=-1)
    p.door(y22, 7, 3.0)
    p.door(y22, 18, 2.5)
    p.door(y22, 27.5, 3.0)
    p.door(y22, 38.5, 3.0)
    p.door(y22, 50, 3.0)
    p.door(x14, 13.5, 2.5, side=-1)
    for x, wd in ((8, 6), (30, 5), (42, 4), (52, 3)):
        p.window(s, x, wd)
    for x, wd in ((7, 4), (27.5, 4), (38.5, 4), (50, 5)):
        p.window(n, at_x(p, n, x), wd)
    p.window(e, 13, 4)
    p.window(e, 31, 4)
    p.window(w, at_x(p, w, 9), 6)
    p.window(w, at_x(p, w, 31), 4)
    for args in [
        ("R101", "LIVING", "101", "living", (9, 9)),
        ("R102", "ENTRY", "102", "entry", (21, 9)),
        ("R103", "DINING", "103", "dining", (30, 9)),
        ("R104", "KITCHEN", "104", "kitchen", (42, 9)),
        ("R105", "LAUNDRY", "105", "laundry", (52, 4)),
        ("R106", "FAMILY", "106", "family", (52, 13)),
        ("R107", "HALL", "107", "hallway", (30, 20)),
        ("R108", "BEDROOM", "108", "bedroom", (7, 31)),
        ("R109", "BATH", "109", "bathroom", (18, 26.5)),
        ("R110", "BATH", "110", "bathroom", (18, 35.5)),
        ("R111", "BEDROOM", "111", "bedroom", (27.5, 31)),
        ("R112", "BEDROOM", "112", "bedroom", (38.5, 31)),
        ("R113", "BEDROOM", "113", "bedroom", (50, 31)),
    ]:
        p.room(*args)
    p.s["grid"] = {"x": [0, 18, 36, 56], "y": [0, 22, 40]}
    return p.done()


def S09():
    p = P("S09", "RESIDENCE - ABBREVIATED LABELS", 48, '1/4" = 1\'-0"', "ARCH_C", "pairs", "medium", 9.0, "Room labels are abbreviations (LIV, DIN, KIT, MSTR BDRM, MSTR BA, WIC, BDRM 2, LDRY, PWDR); the answer sheet carries the full type.")
    s, e, n, w = p.loop([(0, 0), (48, 0), (48, 34), (0, 34)], EXT6)
    y16 = p.wall((0, 16), (48, 16), INT4)
    y20 = p.wall((0, 20), (48, 20), INT4)
    x18 = p.wall((18, 0), (18, 16), INT4)
    x30 = p.wall((30, 0), (30, 16), INT4)
    x16 = p.wall((16, 20), (16, 34), INT4)
    x24 = p.wall((24, 20), (24, 34), INT4)
    y28 = p.wall((16, 28), (24, 28), INT4)
    x36 = p.wall((36, 20), (36, 34), INT4)
    x42 = p.wall((42, 20), (42, 34), INT4)
    p.door(s, 9, 3.0)
    p.door(x18, 8, 6.0, "cased")
    p.door(x30, 8, 6.0, "cased")
    p.door(y16, 24, 4.0, "cased")
    p.door(y20, 8, 3.0)
    p.door(y20, 30, 3.0)
    p.door(y20, 39, 2.5)
    p.door(y20, 45, 2.5)
    p.door(x16, 4, 2.5, side=-1)
    p.door(x16, 11, 2.5, side=-1)
    for x, wd in ((24, 5), (40, 5)):
        p.window(s, x, wd)
    for x, wd in ((8, 5), (30, 4)):
        p.window(n, at_x(p, n, x), wd)
    p.window(w, at_x(p, w, 8), 5)
    p.window(e, 8, 4)
    for args in [
        ("R101", "LIV", "101", "living", (9, 8)),
        ("R102", "DIN", "102", "dining", (24, 8)),
        ("R103", "KIT", "103", "kitchen", (39, 8)),
        ("R104", "HALL", "104", "hallway", (24, 18)),
        ("R105", "MSTR BDRM", "105", "bedroom", (8, 27)),
        ("R106", "MSTR BA", "106", "bathroom", (20, 24)),
        ("R107", "WIC", "107", "closet", (20, 31)),
        ("R108", "BDRM 2", "108", "bedroom", (30, 27)),
        ("R109", "LDRY", "109", "laundry", (39, 27)),
        ("R110", "PWDR", "110", "bathroom", (45, 27)),
    ]:
        p.room(*args)
    return p.done()


def S10():
    p = P("S10", "GARDEN COTTAGE", 48, None, "ANSI_B", "pairs", "easy", 8.0, "No scale is printed anywhere; the scale (1/4\" = 1'-0\") must come from the dimension strings. 8\" CMU exterior.")
    s, e, n, w = p.loop([(0, 0), (34, 0), (34, 26), (0, 26)], CMU8)
    x14 = p.wall((14, 0), (14, 26), INT4)
    y14 = p.wall((14, 14), (34, 14), INT4)
    x24 = p.wall((24, 14), (24, 26), INT4)
    y20 = p.wall((24, 20), (34, 20), INT4)
    p.door(s, 7, 3.0)
    p.door(x14, 7, 4.0, "cased")
    p.door(y14, 5, 3.0)
    p.door(x24, 3, 2.5, side=-1)
    p.door(x24, 9, 2.5, side=-1)
    p.window(s, 24, 4)
    p.window(n, at_x(p, n, 7), 5)
    p.window(n, at_x(p, n, 19), 4)
    p.window(e, 7, 4)
    p.room("R101", "LIVING", "101", "living", (7, 13))
    p.room("R102", "KITCHEN", "102", "kitchen", (24, 7))
    p.room("R103", "BEDROOM", "103", "bedroom", (19, 20))
    p.room("R104", "BATH", "104", "bathroom", (29, 17))
    p.room("R105", "UTILITY", "105", "utility", (29, 23))
    return p.done()


def S11():
    p = P("S11", "GUEST HOUSE", 48, '1/8" = 1\'-0"', "ANSI_B", "pairs", "easy", 8.0, "The printed scale note says 1/8\" = 1'-0\" but the plan is drawn at 1/4\" = 1'-0\". Dimension strings are correct and must override the note. scale_text is as printed; scale_ratio is the TRUE ratio (48).")
    s, e, n, w = p.loop([(0, 0), (30, 0), (30, 22), (0, 22)], MAS12)
    x16 = p.wall((16, 0), (16, 22), INT4)
    y10 = p.wall((0, 10), (16, 10), INT4)
    y12 = p.wall((16, 12), (30, 12), INT4)
    x24 = p.wall((24, 12), (24, 22), INT4)
    p.door(s, 8, 3.0)
    p.door(y10, 8, 6.0, "cased")
    p.door(x16, 6, 3.0, side=-1)
    p.door(y12, 4, 2.5)
    p.door(y12, 11, 4.0, "sliding")
    p.window(n, at_x(p, n, 8), 5)
    p.window(e, 6, 4)
    p.window(w, at_x(p, w, 5), 3)
    p.room("R101", "KITCHEN", "101", "kitchen", (8, 5))
    p.room("R102", "LIVING", "102", "living", (8, 16))
    p.room("R103", "BEDROOM", "103", "bedroom", (23, 6))
    p.room("R104", "BATH", "104", "bathroom", (20, 17))
    p.room("R105", "CLOSET", "105", "closet", (27, 17))
    p.s["scale_ratio"] = 48
    p.s["scale_text_printed"] = '1/8" = 1\'-0"'
    p.s["scale_text"] = '1/8" = 1\'-0"'
    return p.done()


def S12():
    p = P("S12", "CHILD CARE CENTER", 96, None, "ANSI_B", "filled", "medium", 10.0, "Scale is shown ONLY by a graphic scale bar (no scale text). 1/8\" = 1'-0\"; 12\" masonry south wall, CMU elsewhere; an L-shaped corridor.")
    s, e, n, w = p.loop([(0, 0), (64, 0), (64, 40), (0, 40)], CMU8, {0: MAS12})
    x16 = p.wall((16, 0), (16, 40), INT4)
    x22a = p.wall((22, 0), (22, 20), INT4)
    x22b = p.wall((22, 24), (22, 40), INT4)
    y20 = p.wall((22, 20), (64, 20), INT4)
    y24 = p.wall((22, 24), (64, 24), INT4)
    x43 = p.wall((43, 0), (43, 20), INT4)
    x30 = p.wall((30, 24), (30, 40), INT4)
    x38 = p.wall((38, 24), (38, 40), INT4)
    x50 = p.wall((50, 24), (50, 40), INT4)
    y16 = p.wall((0, 16), (16, 16), INT4)
    y28 = p.wall((0, 28), (16, 28), INT4)
    p.door(s, 8, 6.0, "double")
    p.door(x16, 8, 3.0)
    p.door(x16, 22, 3.0)
    p.door(x16, 34, 3.0)
    p.door(y20, at_x(p, y20, 32), 3.0, side=-1)
    p.door(y20, at_x(p, y20, 54), 3.0, side=-1)
    p.door(y24, at_x(p, y24, 26), 3.0)
    p.door(y24, at_x(p, y24, 34), 3.0)
    p.door(y24, at_x(p, y24, 44), 3.0)
    p.door(y24, at_x(p, y24, 57), 3.0)
    p.door(e, 22, 3.5, side=-1)
    for x in (30, 36, 50, 58):
        p.window(s, x, 4)
    p.window(w, at_x(p, w, 8), 4)
    for args in [
        ("R101", "LOBBY", "101", "lobby", (8, 8)),
        ("R102", "OFFICE", "102", "office", (8, 22)),
        ("R103", "STORAGE", "103", "storage", (8, 34)),
        ("R104", "CORRIDOR", "104", "corridor", (19, 30)),
        ("R105", "CLASSROOM", "105", "other", (32.5, 10)),
        ("R106", "CLASSROOM", "106", "other", (53.5, 10)),
        ("R107", "RESTROOM", "107", "restroom", (26, 32)),
        ("R108", "RESTROOM", "108", "restroom", (34, 32)),
        ("R109", "KITCHEN", "109", "kitchen", (44, 32)),
        ("R110", "STAFF", "110", "break_room", (57, 32)),
    ]:
        p.room(*args)
    p.s["scale_bar"] = True
    return p.done()


def office_suite(pid, notes):
    p = P(pid, "PROFESSIONAL OFFICE SUITE", 96, '1/8" = 1\'-0"', "ARCH_C", "filled", "hard", 9.0, notes)
    s, e, n, w = p.loop([(0, 0), (72, 0), (72, 48), (0, 48)], CMU8)
    x20 = p.wall((20, 0), (20, 48), INT4)
    x26a = p.wall((26, 0), (26, 22), INT4)
    x26b = p.wall((26, 28), (26, 48), INT4)
    y22 = p.wall((26, 22), (72, 22), INT4)
    y28 = p.wall((26, 28), (72, 28), INT4)
    y18 = p.wall((0, 18), (20, 18), INT4)
    y34 = p.wall((0, 34), (20, 34), INT4)
    x42 = p.wall((42, 0), (42, 22), INT4)
    x57 = p.wall((57, 0), (57, 22), INT4)
    x38 = p.wall((38, 28), (38, 48), INT4)
    x50 = p.wall((50, 28), (50, 48), INT4)
    x62 = p.wall((62, 28), (62, 48), INT4)
    y38 = p.wall((62, 38), (72, 38), INT4)
    p.door(s, 10, 6.0, "double")
    p.door(x20, 9, 3.0)
    p.door(x20, 26, 3.0)
    p.door(x20, 41, 3.0)
    for x in (34, 49.5, 64.5):
        p.door(y22, at_x(p, y22, x), 3.0, side=-1)
    for x in (32, 44, 56, 66):
        p.door(y28, at_x(p, y28, x), 3.0)
    p.door(y38, 5, 3.0, side=-1)
    for x in (34, 49.5, 64.5):
        p.window(s, x, 6)
    for x in (32, 44, 56):
        p.window(n, at_x(p, n, x), 6)
    p.window(w, at_x(p, w, 26), 6)
    for args in [
        ("R101", "LOBBY", "101", "lobby", (10, 9)),
        ("R102", "CONFERENCE", "102", "conference", (10, 26)),
        ("R103", "STORAGE", "103", "storage", (10, 41)),
        ("R104", "CORRIDOR", "104", "corridor", (23, 35)),
        ("R105", "OFFICE", "105", "office", (34, 11)),
        ("R106", "OFFICE", "106", "office", (49.5, 11)),
        ("R107", "OFFICE", "107", "office", (64.5, 11)),
        ("R108", "OFFICE", "108", "office", (32, 38)),
        ("R109", "OFFICE", "109", "office", (44, 38)),
        ("R110", "BREAK", "110", "break_room", (56, 38)),
        ("R111", "MEN", "111", "restroom", (67, 33)),
        ("R112", "WOMEN", "112", "restroom", (67, 43)),
    ]:
        p.room(*args)
    p.s["grid"] = {"x": [0, 24, 48, 72], "y": [0, 24, 48]}
    return p.done()


def S13():
    return office_suite("S13", "Commercial office suite, 12 rooms, filled walls, column grid with bubbles, an L-shaped corridor formed by two L-corners.")


def S14():
    p = P("S14", "OPEN OFFICE FLOOR", 96, '1/8" = 1\'-0"', "ARCH_D", "pairs", "hard", 10.0, "One large open office with partial-height (4'-0\") stub walls: two free-standing and two attached at one end. Stub walls carve the open-office floor but enclose nothing; their wall area uses their own height.")
    s, e, n, w = p.loop([(0, 0), (96, 0), (96, 60), (0, 60)], CMU8)
    y44 = p.wall((0, 44), (96, 44), INT4)
    xs = [10, 20, 28, 36, 54, 76, 86]
    xw = {x: p.wall((x, 44), (x, 60), INT4) for x in xs}
    s1 = p.wall((20, 14), (40, 14), INT4, height=4.0)
    s2 = p.wall((56, 14), (76, 14), INT4, height=4.0)
    s3 = p.wall((48, 0), (48, 10), INT4, height=4.0)
    s4 = p.wall((30, 30), (30, 44), INT4, height=4.0)
    p.door(s, 64, 6.0, "double")
    for x in (5, 15, 24, 32, 45, 65, 81, 91):
        p.door(y44, x, 3.0)
    for x in (10, 30, 80):
        p.window(s, x, 6)
    p.window(e, 22, 6)
    p.window(w, at_x(p, w, 22), 6)
    for args in [
        ("R101", "OPEN OFFICE", "101", "open_office", (60, 28)),
        ("R102", "MEN", "102", "restroom", (5, 52)),
        ("R103", "WOMEN", "103", "restroom", (15, 52)),
        ("R104", "MECH", "104", "mechanical", (24, 52)),
        ("R105", "STORAGE", "105", "storage", (32, 52)),
        ("R106", "BREAK", "106", "break_room", (45, 52)),
        ("R107", "CONFERENCE", "107", "conference", (65, 52)),
        ("R108", "OFFICE", "108", "office", (81, 52)),
        ("R109", "OFFICE", "109", "office", (91, 52)),
    ]:
        p.room(*args)
    p.s["grid"] = {"x": [0, 32, 64, 96], "y": [0, 30, 60]}
    return p.done()


def S15():
    p = P("S15", "BUNGALOW - PLAN AND ENLARGED BATH", 48, '1/4" = 1\'-0"', "ARCH_D", "pairs", "medium", 9.0, "Two views on one sheet: the floor plan at 1/4\" = 1'-0\" and an enlarged bath plan at 1/2\" = 1'-0\". The answer sheet counts the building once (from the plan view).")
    s, e, n, w = p.loop([(0, 0), (36, 0), (36, 28), (0, 28)], EXT6)
    x18 = p.wall((18, 0), (18, 28), INT4)
    y14w = p.wall((0, 14), (18, 14), INT4)
    y14e = p.wall((18, 14), (36, 14), INT4)
    x27 = p.wall((27, 14), (27, 28), INT4)
    p.door(s, 9, 3.0)
    p.door(x18, 7, 4.0, "cased")
    p.door(y14w, 9, 3.0)
    p.door(y14e, 4.5, 3.0)
    p.door(y14e, 13.5, 2.5)
    p.window(s, 27, 5)
    p.window(n, at_x(p, n, 9), 5)
    p.window(n, at_x(p, n, 31.5), 2.5)
    p.window(e, 7, 4)
    p.room("R101", "LIVING", "101", "living", (9, 7))
    p.room("R102", "KITCHEN", "102", "kitchen", (27, 7))
    p.room("R103", "BEDROOM", "103", "bedroom", (9, 21))
    p.room("R104", "BEDROOM", "104", "bedroom", (22.5, 21))
    p.room("R105", "BATH", "105", "bathroom", (31.5, 21))
    p.s["views"] = [{"name": "ENLARGED BATH PLAN", "scale_ratio": 24, "scale_text": '1/2" = 1\'-0"', "box_ft": [25.5, 12.5, 37.5, 29.5]}]
    return p.done()


def S16():
    p = P("S16", "APARTMENT 4B", 100, "1:100", "ANSI_B", "filled", "easy", 2700 * MM, "Metric apartment at 1:100, dimensions in millimetres, 300 mm exterior and 115 mm interior walls. Lengths are reported in feet (converted) and metres.", units="metric")
    m = lambda x, y: (x * 1000 * MM, y * 1000 * MM)
    s, e, n, w = p.loop([m(0, 0), m(12, 0), m(12, 9), m(0, 9)], M_EXT)
    y5 = p.wall(m(0, 5), m(12, 5), M_INT)
    x7 = p.wall(m(7, 0), m(7, 5), M_INT)
    x45 = p.wall(m(4.5, 5), m(4.5, 9), M_INT)
    x6 = p.wall(m(6, 5), m(6, 9), M_INT)
    x85 = p.wall(m(8.5, 5), m(8.5, 9), M_BLK)
    y75 = p.wall(m(6, 7.5), m(8.5, 7.5), M_INT)
    f = 1000 * MM
    p.door(s, 3.5 * f, 1.0 * f)
    p.door(x7, 2.5 * f, 1.2 * f, "cased")
    p.door(y5, 5.25 * f, 0.9 * f, "cased")
    p.door(x45, 1.0 * f, 0.9 * f, side=-1)
    p.door(x6, 1.25 * f, 0.8 * f)
    p.door(x6, 3.0 * f, 0.8 * f)
    p.door(x85, 2.0 * f, 0.9 * f, side=-1)
    p.window(s, 1.5 * f, 1.8 * f)
    p.window(s, 9.5 * f, 1.5 * f)
    p.window(n, 1.75 * f, 1.5 * f)
    p.window(n, 10.25 * f, 1.5 * f)
    p.room("R1", "LIVING", "01", "living", m(3.5, 2.5), True)
    p.room("R2", "KITCHEN", "02", "kitchen", m(9.5, 2.5), True)
    p.room("R3", "BEDROOM", "03", "bedroom", m(2.25, 7), True)
    p.room("R4", "HALL", "04", "hallway", m(5.25, 7), True)
    p.room("R5", "BATH", "05", "bathroom", m(7.25, 6.25), True)
    p.room("R6", "STORE", "06", "storage", m(7.25, 8.25), True)
    p.room("R7", "BEDROOM", "07", "bedroom", m(10.25, 7), True)
    return p.done()


def S17():
    p = P("S17", "RETAIL UNIT 3", 50, "1:50", "ARCH_C", "pairs", "medium", 3200 * MM, "Metric commercial unit at 1:50 with 300 mm exterior, 200 mm block and 115 mm stud walls; dimensions in millimetres.", units="metric")
    m = lambda x, y: (x * 1000 * MM, y * 1000 * MM)
    f = 1000 * MM
    s, e, n, w = p.loop([m(0, 0), m(15, 0), m(15, 10), m(0, 10)], M_EXT)
    x10 = p.wall(m(10, 0), m(10, 10), M_BLK)
    y4 = p.wall(m(10, 4), m(15, 4), M_INT)
    y6 = p.wall(m(10, 6), m(15, 6), M_INT)
    x125 = p.wall(m(12.5, 6), m(12.5, 10), M_INT)
    y8 = p.wall(m(12.5, 8), m(15, 8), M_INT)
    p.door(s, 5 * f, 2.4 * f, "double")
    p.door(x10, 5 * f, 1.0 * f)
    p.door(y4, 1.5 * f, 1.0 * f, side=-1)
    p.door(y6, 1.25 * f, 0.9 * f)
    p.door(x125, 1.0 * f, 0.8 * f, side=-1)
    p.door(x125, 3.0 * f, 0.9 * f, side=-1)
    p.door(e, 2 * f, 1.0 * f, side=-1)
    p.window(s, 1.75 * f, 2.5 * f)
    p.window(s, 8.25 * f, 2.5 * f)
    p.window(w, 5 * f, 3.0 * f)
    p.room("R1", "SALES FLOOR", "01", "other", m(5, 5))
    p.room("R2", "STOCK", "02", "storage", m(12.5, 2))
    p.room("R3", "CORRIDOR", "03", "corridor", m(12.5, 5))
    p.room("R4", "OFFICE", "04", "office", m(11.25, 8))
    p.room("R5", "WC", "05", "restroom", m(13.75, 7))
    p.room("R6", "STAFF", "06", "break_room", m(13.75, 9))
    return p.done()


def raster_of(pid, source, dpi, rotate, noise, notes):
    return {"id": pid, "raster_of": source, "dpi": dpi, "rotate_deg": rotate, "noise": noise, "notes": notes}


def all_plans():
    plans = [S01(), S02(), S03(), S04(), S05(), S06(), S07(), S08(), S09(), S10(), S11(), S12(), S13(), S14(), S15(), S16(), S17()]
    plans += [
        raster_of("S18", "S02", 300, 0.3, 0.0, "Raster copy of S02 at 300 DPI, nearly clean (0.3 degree skew). Image only, no text layer."),
        raster_of("S19", "S08", 150, 1.2, 0.012, "Raster copy of S08 at 150 DPI, rotated 1.2 degrees, speckle noise and blur. Image only."),
        raster_of("S20", "S13", 300, -0.8, 0.004, "Raster copy of S13 at 300 DPI, rotated -0.8 degrees, light noise. Image only."),
    ]
    return plans
