"""One scanned test sheet (a dental clinic nobody has seen), plus its answer key
kept in a separate folder.

    .venv/bin/python scan_test.py ~/Desktop/scanned-test
"""
from __future__ import annotations

import json
import math
import os
import sys

from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from draw import PAGES, render
from generate import answer_key, expected_for, make_raster
from plans import CMU8, INT4, P

NAME = "C01"


def clinic():
    p = P(NAME, "RIDGEVIEW DENTAL CLINIC", 48, '1/4" = 1\'-0"', "ARCH_C", "pairs", "medium", 9.0, "Scanned sheet: 200 DPI, rotated 0.7 degrees, light noise. Scale is printed (1/4\" = 1'-0\"), shown by a graphic scale bar, and readable from the dimension strings - but only as pixels: there is no text layer.")
    s, e, n, w = p.loop([(0, 0), (48, 0), (48, 36), (0, 36)], CMU8)
    x16 = p.wall((16, 0), (16, 36), INT4)
    y14 = p.wall((0, 14), (16, 14), INT4)
    y22 = p.wall((0, 22), (16, 22), INT4)
    x10 = p.wall((10, 22), (10, 36), INT4)
    y30 = p.wall((10, 30), (16, 30), INT4)
    x21a = p.wall((21, 0), (21, 16), INT4)
    x21b = p.wall((21, 20), (21, 36), INT4)
    y16 = p.wall((21, 16), (48, 16), INT4)
    y20 = p.wall((21, 20), (48, 20), INT4)
    x30a = p.wall((30, 0), (30, 16), INT4)
    x39a = p.wall((39, 0), (39, 16), INT4)
    x30b = p.wall((30, 20), (30, 36), INT4)
    x39b = p.wall((39, 20), (39, 36), INT4)
    p.door(s, 8, 3.5)
    p.door(x16, 7, 4.0, "cased")
    p.door(y14, 8, 6.0, "cased")
    p.door(x16, 18, 3.0, side=-1)
    p.door(y22, 5, 3.0)
    p.door(x16, 26, 3.0, side=-1)
    p.door(x16, 33, 3.0, side=-1)
    for x in (25.5, 34.5, 43.5):
        p.door(y16, x - 21, 3.0, side=-1)
        p.door(y20, x - 21, 3.0)
    p.door(e, 18, 3.5, side=-1)
    p.window(s, 3, 3)
    p.window(s, 12.5, 4)
    for x in (25.5, 34.5, 43.5):
        p.window(s, x, 4)
        p.window(n, 48 - x, 4)
    p.window(n, 48 - 5, 4)
    p.window(w, 36 - 7, 4)
    p.window(w, 36 - 29, 4)
    for args in [
        ("R101", "WAITING", "101", "lobby", (8, 7)),
        ("R102", "RECEPTION", "102", "office", (8, 18)),
        ("R103", "OFFICE", "103", "office", (5, 29)),
        ("R104", "RESTROOM", "104", "restroom", (13, 26)),
        ("R105", "STAFF", "105", "break_room", (13, 33)),
        ("R106", "CORRIDOR", "106", "corridor", (18.5, 30)),
        ("R107", "X-RAY", "107", "other", (25.5, 8)),
        ("R108", "STERILIZATION", "108", "utility", (34.5, 8)),
        ("R109", "STORAGE", "109", "storage", (43.5, 8)),
        ("R110", "OPERATORY", "110", "other", (25.5, 28)),
        ("R111", "OPERATORY", "111", "other", (34.5, 28)),
        ("R112", "OPERATORY", "112", "other", (43.5, 28)),
    ]:
        p.room(*args)
    p.s["scale_bar"] = True
    return p.done()


def key_pdf(path, exp, png):
    """A readable answer key: the totals, every wall, opening and room, and the picture."""
    c = canvas.Canvas(path, pagesize=landscape(letter), invariant=1)
    W, H = landscape(letter)
    t = exp["totals"]
    y = H - 40
    c.setFont("Helvetica-Bold", 15)
    c.drawString(36, y, f"ANSWER KEY - {exp['id']} RIDGEVIEW DENTAL CLINIC (scanned)")
    y -= 18
    c.setFont("Helvetica", 9)
    for line in [
        f"File: {exp['file']}    Scale: {exp['scale_text']} (1:{exp['scale_ratio']})    Ceiling: {exp['ceiling_height_ft']} ft    Kind: raster, {exp['raster']['dpi']} DPI, rotated {exp['raster']['rotate_deg']} deg",
        f"Expected behaviour: the sheet has no text layer, so a text-based scale reader should DECLINE honestly. A raster/OCR reader should find {exp['scale_text']}.",
        f"Walls: {t['wall_lf_gross']:.2f} LF gross / {t['wall_lf_net']:.2f} LF net   (exterior {t['wall_lf_exterior_gross']:.2f}, interior {t['wall_lf_interior_gross']:.2f})",
        f"Wall area (net LF x {exp['ceiling_height_ft']} ft): exterior {t['wall_sf_exterior_net']:.2f} SF, interior {t['wall_sf_interior_net']:.2f} SF",
        f"Gross building area: {t['gross_building_area_sf']:.2f} SF    Rooms: {t['room_count']}    Doors: {t['door_count']}    Windows: {t['window_count']}",
        "Rules: centerline lengths; L-corners meet at the corner point; a T branch stops at the through wall's centerline; net = gross minus opening widths;",
        "room area and perimeter to the inside faces of walls; gross area to the outside face of exterior walls.",
    ]:
        c.drawString(36, y, line)
        y -= 13
    y -= 6

    def table(x, y, title, head, rows, widths):
        c.setFont("Helvetica-Bold", 9)
        c.drawString(x, y, title)
        y -= 12
        c.setFont("Helvetica-Bold", 7)
        cx = x
        for h, w_ in zip(head, widths):
            c.drawString(cx, y, h)
            cx += w_
        c.setFont("Helvetica", 7)
        for r in rows:
            y -= 9.5
            cx = x
            for v, w_ in zip(r, widths):
                c.drawString(cx, y, str(v))
                cx += w_
        return y

    walls = [(w["id"], w["type"], "EXT" if w["exterior"] else "INT", f"{w['length_ft']:.2f}", f"{w['net_length_ft']:.2f}", f"({w['start_ft'][0]:g},{w['start_ft'][1]:g})-({w['end_ft'][0]:g},{w['end_ft'][1]:g})") for w in exp["walls"]]
    table(36, y, "WALLS (ft, centerline)", ["ID", "TYPE", "", "GROSS", "NET", "CENTERLINE"], walls, [28, 52, 26, 38, 38, 120])
    rooms = [(r["id"], r["label"], r["type"], f"{r['area_sf']:.2f}", f"{r['perimeter_lf']:.2f}") for r in exp["rooms"]]
    yr = table(350, y, "ROOMS (inside faces)", ["ID", "LABEL", "TYPE", "AREA SF", "PERIM LF"], rooms, [32, 110, 60, 46, 46])
    ops = [(o["id"], o["kind"], o["subtype"], o["wall"], f"{o['width_ft']:.2f}") for o in exp["openings"]]
    table(350, yr - 18, "OPENINGS", ["ID", "KIND", "SUBTYPE", "WALL", "WIDTH FT"], ops, [32, 40, 70, 40, 46])
    c.showPage()
    img = ImageReader(png)
    iw, ih = img.getSize()
    s = min((W - 40) / iw, (H - 40) / ih)
    c.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s)
    c.showPage()
    c.save()


def main(out):
    plan_dir = os.path.join(out, "plan")
    key_dir = os.path.join(out, "answer-key")
    os.makedirs(plan_dir, exist_ok=True)
    os.makedirs(key_dir, exist_ok=True)
    spec = clinic()
    vec = os.path.join(key_dir, "C01_vector_original.pdf")
    placement = render(spec, vec)
    scan = os.path.join(plan_dir, "ridgeview-dental-scanned.pdf")
    dpi, rot = 200, 0.7
    img, (w0, h0) = make_raster(vec, scan, PAGES[spec["page"]], dpi, rot, 0.006, seed=21)
    exp = expected_for(spec, placement, "ridgeview-dental-scanned.pdf", "raster")
    exp["raster"] = {"dpi": dpi, "rotate_deg": rot, "noise": 0.006}
    with open(os.path.join(key_dir, "expected.json"), "w") as f:
        json.dump(exp, f, indent=1)
    v = placement["views"][0]
    ph = placement["page_size_pt"][1]
    th = math.radians(rot)
    W, H = img.size

    def to_px(p):
        x = (v["origin_pt"][0] + p[0] * v["pt_per_ft"]) * dpi / 72
        y = (ph - (v["origin_pt"][1] + p[1] * v["pt_per_ft"])) * dpi / 72
        dx, dy = x - w0 / 2, y - h0 / 2
        return (W / 2 + dx * math.cos(th) + dy * math.sin(th), H / 2 - dx * math.sin(th) + dy * math.cos(th))

    key = answer_key(spec, exp, img.convert("RGB"), to_px)
    key = key.resize((2400, int(key.height * 2400 / key.width)))
    png = os.path.join(key_dir, "answer_key.png")
    key.save(png)
    key_pdf(os.path.join(key_dir, "ANSWER-KEY.pdf"), exp, png)
    print(json.dumps(exp["totals"], indent=1))


if __name__ == "__main__":
    main(os.path.expanduser(sys.argv[1]))
