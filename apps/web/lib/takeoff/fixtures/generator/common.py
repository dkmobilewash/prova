"""Spec -> geometry -> answers. Shared by generate.py and validate.py.

Every answer is computed from the spec with shapely. Nothing here reads a PDF.

Measurement rules (README.md states them for people):
  * Wall length: along the centerline. Walls are specified so their centerlines
    meet at L-corners and a T branch stops at the through wall's centerline, so
    the centerline length IS the takeoff length.
  * Net LF = gross minus the widths of the openings in that wall.
  * Wall SF = net LF x height, where height is the ceiling height, or the wall's
    own height where the spec marks it partial-height (and it is lower).
  * Rooms are the holes of the wall-footprint union: area and perimeter to the
    inside faces. Door gaps do not merge rooms (rooms are computed without them).
  * Gross building area: inside the outside face of the exterior walls.
"""
from __future__ import annotations

import math
from typing import Dict, List, Tuple

from shapely.geometry import LineString, MultiPoint, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

ROOM_TYPES = [
    "bedroom", "bathroom", "kitchen", "living", "dining", "family", "office", "closet", "laundry",
    "hallway", "entry", "garage", "utility", "storage", "open_office", "conference", "restroom",
    "break_room", "lobby", "corridor", "mechanical", "other",
]

EPS = 1e-6


def arc_points(arc: dict, n: int = 96) -> List[Tuple[float, float]]:
    cx, cy = arc["center"]
    r = arc["radius"]
    a0, a1 = math.radians(arc["start_deg"]), math.radians(arc["end_deg"])
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def centerline(w: dict) -> LineString:
    return LineString(arc_points(w["arc"]) if w.get("arc") else [w["a"], w["b"]])


def wall_length(w: dict) -> float:
    if w.get("arc"):
        return w["arc"]["radius"] * abs(math.radians(w["arc"]["end_deg"] - w["arc"]["start_deg"]))
    return math.dist(w["a"], w["b"])


def t_ft(w: dict) -> float:
    return w["thickness_in"] / 12.0


def end_dir(w: dict, at_start: bool) -> Tuple[float, float]:
    """Unit direction pointing INTO the wall from the given end (tangent for arcs)."""
    pts = centerline(w).coords
    p, q = (pts[0], pts[1]) if at_start else (pts[-1], pts[-2])
    d = (q[0] - p[0], q[1] - p[1])
    L = math.hypot(*d)
    return (d[0] / L, d[1] / L)


def _same(p, q) -> bool:
    return abs(p[0] - q[0]) < 1e-6 and abs(p[1] - q[1]) < 1e-6


def _line_intersect(p, u, q, v):
    den = u[0] * v[1] - u[1] * v[0]
    if abs(den) < 1e-12:
        return None
    t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den
    return (p[0] + u[0] * t, p[1] + u[1] * t)


def footprints(spec: dict) -> Tuple[Polygon, List[Polygon]]:
    """Each wall as a flat-capped strip, plus a miter filler wherever two or more
    walls end at one point and leave a wedge wider than 180 degrees (an outside
    corner). A T branch needs nothing: its flat end sits inside the through wall."""
    walls = spec["walls"]
    parts = [centerline(w).buffer(t_ft(w) / 2, cap_style=2, join_style=2) for w in walls]
    # Group wall ends by point.
    ends: Dict[Tuple[float, float], List[Tuple[dict, bool]]] = {}
    for w in walls:
        pts = centerline(w).coords
        for at_start, pt in ((True, pts[0]), (False, pts[-1])):
            key = None
            for k in ends:
                if _same(k, pt):
                    key = k
            ends.setdefault(key or (pt[0], pt[1]), []).append((w, at_start))
    fillers = []
    for P, members in ends.items():
        if len(members) < 2:
            continue
        items = []
        for w, at_start in members:
            u = end_dir(w, at_start)
            items.append((math.atan2(u[1], u[0]) % (2 * math.pi), u, t_ft(w)))
        items.sort(key=lambda x: x[0])
        for i in range(len(items)):
            a1, u1, t1 = items[i]
            a2, u2, t2 = items[(i + 1) % len(items)]
            gap = (a2 - a1) % (2 * math.pi)
            if len(items) == 1 or gap <= math.pi + 1e-9:
                continue
            n1 = (-u1[1], u1[0])  # left of the wall that starts the wedge
            n2 = (u2[1], -u2[0])  # right of the wall that ends it
            f1 = (P[0] + n1[0] * t1 / 2, P[1] + n1[1] * t1 / 2)
            f2 = (P[0] + n2[0] * t2 / 2, P[1] + n2[1] * t2 / 2)
            m = _line_intersect(f1, u1, f2, u2)
            pts = [P, f1, f2] + ([m] if m and math.dist(m, P) < 4 * max(t1, t2) else [])
            fillers.append(MultiPoint(pts).convex_hull)
    union = unary_union(parts + [f for f in fillers if f is not None])
    return union, parts


def main_piece(union):
    """The building: the largest connected wall footprint. Anything else is a
    free-standing wall standing inside a room (an island)."""
    if isinstance(union, MultiPolygon):
        return max(union.geoms, key=lambda g: g.area), [g for g in union.geoms if g is not max(union.geoms, key=lambda g: g.area)]
    return union, []


def opening_point(spec: dict, op: dict) -> Tuple[float, float]:
    w = wall_by_id(spec, op["wall"])
    p = centerline(w).interpolate(op["at_ft"])
    return (p.x, p.y)


def wall_by_id(spec: dict, wid: str) -> dict:
    for w in spec["walls"]:
        if w["id"] == wid:
            return w
    raise KeyError(wid)


def opening_rect(spec: dict, op: dict, extra: float = 0.02) -> Polygon:
    w = wall_by_id(spec, op["wall"])
    line = centerline(w)
    s0 = op["at_ft"] - op["width_ft"] / 2
    s1 = op["at_ft"] + op["width_ft"] / 2
    # Straight walls only carry openings in this set.
    a = line.interpolate(s0)
    b = line.interpolate(s1)
    return LineString([(a.x, a.y), (b.x, b.y)]).buffer(t_ft(w) / 2 + extra, cap_style=2)


def rooms(spec: dict, union) -> List[dict]:
    main, islands = main_piece(union)
    holes = [Polygon(h) for h in main.interiors]
    if islands:
        holes = [h.difference(unary_union(islands)) for h in holes]
    out = []
    used = set()
    for r in spec["rooms"]:
        pt = Point(r["label_at"])
        hits = [i for i, h in enumerate(holes) if h.contains(pt)]
        if len(hits) != 1:
            raise ValueError(f"{spec['id']}: room {r['id']} label point is in {len(hits)} rooms")
        if hits[0] in used:
            raise ValueError(f"{spec['id']}: two labels in one room ({r['id']})")
        used.add(hits[0])
        out.append({**r, "poly": holes[hits[0]]})
    if len(used) != len(holes):
        raise ValueError(f"{spec['id']}: {len(holes) - len(used)} enclosed spaces have no room label")
    return out


def answers(spec: dict) -> dict:
    union, _ = footprints(spec)
    rms = rooms(spec, union)
    ceiling = spec["ceiling_height_ft"]
    walls_out = []
    tot = {k: 0.0 for k in ["wall_lf_gross", "wall_lf_net", "wall_lf_exterior_gross", "wall_lf_interior_gross", "wall_sf_exterior_net", "wall_sf_interior_net"]}
    for w in spec["walls"]:
        L = wall_length(w)
        ops = [o for o in spec["openings"] if o["wall"] == w["id"]]
        net = L - sum(o["width_ft"] for o in ops)
        h = min(w.get("height_ft") or ceiling, ceiling)
        rec = {
            "id": w["id"],
            "start_ft": [round(c, 4) for c in centerline(w).coords[0]],
            "end_ft": [round(c, 4) for c in centerline(w).coords[-1]],
            "length_ft": round(L, 2),
            "net_length_ft": round(net, 2),
            "thickness_in": w["thickness_in"],
            "type": w["type"],
            "exterior": w["exterior"],
            "height_ft": round(h, 2),
            "wall_sf_net": round(net * h, 2),
        }
        if w.get("arc"):
            rec["arc"] = w["arc"]
        if w.get("height_ft"):
            rec["partial_height"] = True
        walls_out.append(rec)
        tot["wall_lf_gross"] += L
        tot["wall_lf_net"] += net
        if w["exterior"]:
            tot["wall_lf_exterior_gross"] += L
            tot["wall_sf_exterior_net"] += net * h
        else:
            tot["wall_lf_interior_gross"] += L
            tot["wall_sf_interior_net"] += net * h
    gross = Polygon(main_piece(union)[0].exterior).area
    openings_out = []
    for o in spec["openings"]:
        c = opening_point(spec, o)
        openings_out.append({"id": o["id"], "kind": o["kind"], "subtype": o["subtype"], "wall": o["wall"], "width_ft": round(o["width_ft"], 2), "center_ft": [round(c[0], 2), round(c[1], 2)]})
    rooms_out = []
    for r in rms:
        p = r["poly"]
        rooms_out.append({"id": r["id"], "label": r["label"], "type": r["type"], "area_sf": round(p.area, 2), "perimeter_lf": round(p.exterior.length, 2), "centroid_ft": [round(p.centroid.x, 2), round(p.centroid.y, 2)]})
    totals = {k: round(v, 2) for k, v in tot.items()}
    totals.update({
        "gross_building_area_sf": round(gross, 2),
        "room_count": len(rms),
        "door_count": sum(1 for o in spec["openings"] if o["kind"] == "door"),
        "window_count": sum(1 for o in spec["openings"] if o["kind"] == "window"),
    })
    return {
        "totals": totals,
        "walls": walls_out,
        "openings": openings_out,
        "rooms": rooms_out,
        "_check": {"wall_footprint_sf": union.area, "room_sf": sum(r["poly"].area for r in rms), "gross_sf": gross},
    }
