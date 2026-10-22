"""Builds every fixture from code. Deterministic: run it twice, get identical files.

    .venv/bin/python generate.py

Writes spec/SXX.json (the source of truth plus where it was drawn), and for each
plan synthetic/SXX/plan.pdf (or plan_raster.pdf), expected.json and
answer_key.png, then synthetic/contact_sheet.png.
"""
from __future__ import annotations

import copy
import io
import json
import math
import os
import random

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from common import answers, footprints, main_piece, rooms
from draw import PAGES, render
from plans import all_plans

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, "spec")
OUT = os.path.join(HERE, "synthetic")
KEY_PX = 2000  # answer-key image width


def scale_text_true(ratio: int, units: str) -> str:
    if units == "metric":
        return f"1:{ratio}"
    return {48: '1/4" = 1\'-0"', 96: '1/8" = 1\'-0"', 64: '3/16" = 1\'-0"', 24: '1/2" = 1\'-0"'}[ratio]


def expected_for(spec: dict, placement: dict, file: str, kind: str) -> dict:
    a = answers(spec)
    exp = {
        "id": spec["id"],
        "file": file,
        "page": 1,
        "kind": kind,
        "units": spec["units"],
        "scale_text": spec.get("scale_text_printed"),
        "scale_ratio": spec["scale_ratio"],
        "sheet_type": "floor_plan",
        "ceiling_height_ft": round(spec["ceiling_height_ft"], 2),
        "totals": a["totals"],
        "walls": a["walls"],
        "openings": a["openings"],
        "rooms": a["rooms"],
        "notes": spec["notes"],
    }
    if spec["units"] == "metric":
        for w in exp["walls"]:
            w["length_m"] = round(w["length_ft"] * 0.3048, 3)
    if len(placement["views"]) > 1:
        exp["viewports"] = [{"name": v["name"], "scale_ratio": v["scale_ratio"], "scale_text": scale_text_true(v["scale_ratio"], spec["units"])} for v in placement["views"]]
    return exp


def pdf_to_image(path: str, dpi: float) -> Image.Image:
    pdf = pdfium.PdfDocument(path)
    page = pdf[0]
    img = page.render(scale=dpi / 72, grayscale=False).to_pil().convert("RGB")
    pdf.close()
    return img


def answer_key(spec: dict, exp: dict, base: Image.Image, to_px) -> Image.Image:
    """The plan with the correct walls, rooms and openings drawn over it."""
    img = base.convert("RGBA")
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    union, _ = footprints(spec)
    palette = [(66, 135, 245), (245, 166, 35), (126, 211, 33), (189, 16, 224), (80, 227, 194), (248, 231, 28), (245, 80, 80), (144, 19, 254)]
    for i, r in enumerate(rooms(spec, union)):
        col = palette[i % len(palette)]
        polys = r["poly"].geoms if hasattr(r["poly"], "geoms") else [r["poly"]]
        for poly in polys:
            d.polygon([to_px(p) for p in poly.exterior.coords], fill=col + (60,))
    for w in exp["walls"]:
        pts = [to_px(p) for p in (centerline_pts(w))]
        d.line(pts, fill=(220, 0, 0, 255) if w["exterior"] else (0, 70, 220, 255), width=4)
    for o in exp["openings"]:
        x, y = to_px(o["center_ft"])
        d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(0, 170, 0, 255) if o["kind"] == "door" else (0, 200, 200, 255))
    img = Image.alpha_composite(img, over)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 18)
        big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 24)
    except OSError:
        font = big = ImageFont.load_default()
    for r in exp["rooms"]:
        x, y = to_px(r["centroid_ft"])
        txt = f"{r['area_sf']:.1f} SF"
        d.text((x, y + 30), txt, fill=(0, 0, 0, 255), font=font, anchor="mm", stroke_width=3, stroke_fill=(255, 255, 255, 255))
    t = exp["totals"]
    lines = [
        f"{exp['id']}  {spec.get('title', '')}  ({exp['kind']}, 1:{exp['scale_ratio']})",
        f"walls {t['wall_lf_gross']:.2f} LF gross / {t['wall_lf_net']:.2f} net   ext {t['wall_lf_exterior_gross']:.2f}  int {t['wall_lf_interior_gross']:.2f}",
        f"gross area {t['gross_building_area_sf']:.2f} SF   rooms {t['room_count']}   doors {t['door_count']}   windows {t['window_count']}",
        "red = exterior wall centerline   blue = interior   green dot = door   teal dot = window   tint = room (area shown)",
    ]
    d.rectangle([10, 10, 1100, 20 + 30 * len(lines)], fill=(255, 255, 255, 235))
    for i, s in enumerate(lines):
        d.text((20, 18 + i * 30), s, fill=(0, 0, 0, 255), font=big if i == 0 else font)
    return img.convert("RGB")


def centerline_pts(w: dict):
    if w.get("arc"):
        a = w["arc"]
        n = 48
        return [(a["center"][0] + a["radius"] * math.cos(math.radians(a["start_deg"] + (a["end_deg"] - a["start_deg"]) * i / n)), a["center"][1] + a["radius"] * math.sin(math.radians(a["start_deg"] + (a["end_deg"] - a["start_deg"]) * i / n))) for i in range(n + 1)]
    return [w["start_ft"], w["end_ft"]]


def make_raster(src_pdf: str, dst_pdf: str, page_in, dpi: int, rotate: float, noise: float, seed: int):
    img = pdf_to_image(src_pdf, dpi).convert("L")
    w0, h0 = img.size
    rot = img.rotate(rotate, resample=Image.BICUBIC, expand=True, fillcolor=255)
    rng = random.Random(seed)
    if noise > 0:
        px = rot.load()
        W, H = rot.size
        for _ in range(int(W * H * noise)):
            x, y = rng.randrange(W), rng.randrange(H)
            px[x, y] = rng.choice((0, 60, 200, 255))
        rot = rot.filter(ImageFilter.GaussianBlur(0.7))
    else:
        rot = rot.filter(ImageFilter.GaussianBlur(0.35))
    W, H = rot.size
    page_w, page_h = page_in[0] * 72, page_in[1] * 72
    c = canvas.Canvas(dst_pdf, pagesize=(page_w, page_h), invariant=1)
    buf = io.BytesIO()
    rot.save(buf, format="PNG", optimize=False)
    buf.seek(0)
    dw, dh = W / dpi * 72, H / dpi * 72
    c.drawImage(ImageReader(buf), (page_w - dw) / 2, (page_h - dh) / 2, dw, dh)
    c.showPage()
    c.save()
    return rot, (w0, h0)


def main():
    os.makedirs(SPEC, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    plans = all_plans()
    by_id = {p["id"]: p for p in plans}
    built = {}
    keys = []
    for sp in plans:
        pid = sp["id"]
        d = os.path.join(OUT, pid)
        os.makedirs(d, exist_ok=True)
        if "raster_of" in sp:
            src = by_id[sp["raster_of"]]
            spec = copy.deepcopy(src)
            spec["notes"] = sp["notes"]
            placement = built[src["id"]]["placement"]
            pdf = os.path.join(d, "plan_raster.pdf")
            rot, (w0, h0) = make_raster(os.path.join(OUT, src["id"], "plan.pdf"), pdf, PAGES[src["page"]], sp["dpi"], sp["rotate_deg"], sp["noise"], seed=int(pid[1:]))
            exp = expected_for(src, placement, "plan_raster.pdf", "raster")
            exp["id"] = pid
            exp["notes"] = sp["notes"]
            exp["raster"] = {"source": src["id"], "dpi": sp["dpi"], "rotate_deg": sp["rotate_deg"], "noise": sp["noise"]}
            with open(os.path.join(SPEC, f"{pid}.json"), "w") as f:
                json.dump({"id": pid, "raster_of": src["id"], "dpi": sp["dpi"], "rotate_deg": sp["rotate_deg"], "noise": sp["noise"], "notes": sp["notes"]}, f, indent=1)
            # Answer key on the rotated scan: map ft -> source px -> rotated px.
            v = placement["views"][0]
            dpi = sp["dpi"]
            th = math.radians(sp["rotate_deg"])
            W, H = rot.size
            ph = placement["page_size_pt"][1]

            def to_px_r(p, v=v, dpi=dpi, th=th, W=W, H=H, w0=w0, h0=h0, ph=ph):
                x = (v["origin_pt"][0] + p[0] * v["pt_per_ft"]) * dpi / 72
                y = (ph - (v["origin_pt"][1] + p[1] * v["pt_per_ft"])) * dpi / 72
                dx, dy = x - w0 / 2, y - h0 / 2
                return (W / 2 + dx * math.cos(th) + dy * math.sin(th), H / 2 - dx * math.sin(th) + dy * math.cos(th))

            key = answer_key(src, exp, rot.convert("RGB"), to_px_r)
            scale = KEY_PX / key.width
            key = key.resize((KEY_PX, int(key.height * scale)), Image.LANCZOS)
        else:
            pdf = os.path.join(d, "plan.pdf")
            placement = render(sp, pdf)
            exp = expected_for(sp, placement, "plan.pdf", "vector")
            with open(os.path.join(SPEC, f"{pid}.json"), "w") as f:
                json.dump({**sp, "placement": placement}, f, indent=1)
            dpi = KEY_PX / PAGES[sp["page"]][0]
            base = pdf_to_image(pdf, dpi)
            v = placement["views"][0]
            ph = placement["page_size_pt"][1]

            def to_px(p, v=v, dpi=dpi, ph=ph):
                return ((v["origin_pt"][0] + p[0] * v["pt_per_ft"]) * dpi / 72, (ph - (v["origin_pt"][1] + p[1] * v["pt_per_ft"])) * dpi / 72)

            key = answer_key(sp, exp, base, to_px)
            built[pid] = {"placement": placement}
        with open(os.path.join(d, "expected.json"), "w") as f:
            json.dump(exp, f, indent=1)
        key.save(os.path.join(d, "answer_key.png"), optimize=False)
        keys.append((pid, key))
        print(f"{pid}: {exp['totals']['wall_lf_gross']:.2f} LF, {exp['totals']['room_count']} rooms")
    # Contact sheet, 5 x 4.
    tw = 640
    thumbs = [(pid, k.resize((tw, int(k.height * tw / k.width)), Image.LANCZOS)) for pid, k in keys]
    th = max(t.height for _, t in thumbs)
    sheet = Image.new("RGB", (tw * 5 + 60, (th + 40) * 4 + 50), "white")
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    for i, (pid, t) in enumerate(thumbs):
        x = 10 + (i % 5) * (tw + 10)
        y = 10 + (i // 5) * (th + 40)
        sheet.paste(t, (x, y + 30))
        dr.text((x, y), pid, fill="black", font=font)
    sheet.save(os.path.join(OUT, "contact_sheet.png"), optimize=False)
    print("wrote", os.path.join(OUT, "contact_sheet.png"))


if __name__ == "__main__":
    main()
