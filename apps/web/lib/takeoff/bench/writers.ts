import { deflateSync } from "node:zlib";
import type { Pt } from "./model";
import type { Prim, Sheet } from "./sheets";

/**
 * THREE WRITERS FOR ONE DISPLAY LIST, plus a raster "scan".
 *
 *   `writePdf`  — hand-rolled PDF, the way `syntheticSheet.ts` does it, but able
 *                 to emit what real CAD exports carry: Form XObjects with their
 *                 own /Matrix (nested), optional-content layers, clip paths,
 *                 /Rotate with a CropBox off the origin, a whole page printed
 *                 at a reduced size, compressed streams, an image-only page.
 *   `writeSvg`  — the same drawing as SVG, which Chromium prints to PDF through
 *                 Skia: a genuinely different PDF producer, with its own path
 *                 encoding, font embedding and group structure.
 *   `writeDxf`  — DXF R12, in PAPER INCHES at 1:1, so a person can open a sheet
 *                 in real CAD and plot a true CAD export for the next round.
 *
 * No PDF library: the repo ships `pdfjs-dist`, which reads, and adding a writer
 * would be a new dependency for something that is a few hundred lines of text.
 */

export type PdfOptions = {
  compress?: boolean;
  /** Group block instances (`Prim.inst`) into Form XObjects with their own /Matrix. */
  forms?: boolean;
  /** Put every non-title-block primitive into one Form XObject (an "xref") whose
   *  /Matrix is `0.5 / k` and which is drawn under a viewport `cm` of 2 — the
   *  composition comes out exactly 1:1 on paper. `k` is the xref's own unit scale. */
  xref?: { k: number };
  /** Layers on optional content: names that are OFF and names that are ON. */
  ocg?: { off: string[]; on: string[] };
  /** A viewport clip path in paper points: [x0, y0, x1, y1]. */
  clip?: [number, number, number, number];
  /** Landscape content in a portrait MediaBox with /Rotate 90, and a CropBox
   *  `margin` points in from a MediaBox that is `margin` bigger on every side. */
  rotate90?: { margin: number };
  /** Print the sheet at a reduced size onto a different page. */
  printAt?: { scale: number; widthPt: number; heightPt: number };
  /** Instead of vectors: an 8-bit grey image of the sheet. */
  raster?: { dpi: number; skewDeg: number; noise: number; seed: number };
  /** Primitives drawn OUTSIDE the CropBox (rotate variant): plot stamp, strays. */
  outsideCrop?: Prim[];
};

const HELV: Record<string, number> = {
  " ": 278, "'": 191, '"': 355, "-": 333, "/": 278, ".": 278, ",": 278, ":": 278, "(": 333, ")": 333, "#": 556, "=": 584, "+": 584, x: 500,
};
for (const d of "0123456789") HELV[d] = 556;
for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") HELV[c] = "IJ".includes(c) ? 400 : "MW".includes(c) ? 850 : 680;
for (const c of "abcdefghijklmnopqrstuvwxyz") HELV[c] = HELV[c] ?? 520;

/** Helvetica advance width of a string at a size, in points — close enough to
 *  centre a label the way pdfjs will measure it. */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += HELV[ch] ?? 600;
  return (w / 1000) * size;
}

const f = (n: number) => (Math.abs(n) < 1e-9 ? "0" : Number(n.toFixed(3)).toString());
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** The content-stream operators for one primitive, in whatever space is current. */
function primOps(p: Prim, map: (pt: Pt) => Pt = (pt) => pt, penScale = 1): string {
  if (p.k === "text") {
    const at = map(p.at);
    const size = p.size * penScale;
    const rot = ((p.rot ?? 0) * Math.PI) / 180;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const shift = p.anchor === "middle" ? textWidth(p.s, size) / 2 : 0;
    const x = at.x - c * shift;
    const y = at.y - s * shift;
    return `BT /F1 ${f(size)} Tf ${f(c)} ${f(s)} ${f(-s)} ${f(c)} ${f(x)} ${f(y)} Tm (${esc(p.s)}) Tj ET`;
  }
  const ops: string[] = [];
  const gray = p.gray ?? 0;
  ops.push(`${f(gray)} G ${f(gray)} g`);
  ops.push(`${f(p.w * penScale)} w`);
  ops.push(p.dash ? `[${p.dash.map((d) => f(d * penScale)).join(" ")}] 0 d` : "[] 0 d");
  if (p.k === "bez") {
    const s0 = map(p.start);
    ops.push(`${f(s0.x)} ${f(s0.y)} m`);
    for (const [c1, c2, e] of p.segs) {
      const [a, b, c] = [map(c1), map(c2), map(e)];
      ops.push(`${f(a.x)} ${f(a.y)} ${f(b.x)} ${f(b.y)} ${f(c.x)} ${f(c.y)} c`);
    }
    ops.push("S");
    return ops.join("\n");
  }
  const pts = p.pts.map(map);
  ops.push(`${f(pts[0].x)} ${f(pts[0].y)} m`);
  for (const q of pts.slice(1)) ops.push(`${f(q.x)} ${f(q.y)} l`);
  if (p.closed) ops.push("h");
  const stroke = p.stroke !== false;
  const fill = p.fill !== undefined;
  ops.push(fill && stroke ? `${f(p.fill!)} g B` : fill ? `${f(p.fill!)} g f` : stroke ? "S" : "n");
  return ops.join("\n");
}

const isTitle = (p: Prim) => p.role === "border" || p.role === "titleblock" || (p.k === "path" && p.layer === "A-REVS" && p.role === "cloud" && false);

type Obj = { body: string; stream?: Buffer };

export function writePdf(sheet: Sheet, prims: Prim[], o: PdfOptions = {}): Buffer {
  const objects: Obj[] = [];
  const add = (obj: Obj) => {
    objects.push(obj);
    return objects.length;
  };
  const W = sheet.widthPt;
  const H = sheet.heightPt;

  const streamObj = (content: string, dict = ""): Obj => {
    const raw = Buffer.from(content, "latin1");
    const data = o.compress ? deflateSync(raw) : raw;
    return { body: `<< /Length ${data.length}${o.compress ? " /Filter /FlateDecode" : ""}${dict} >>`, stream: data };
  };

  const catalogId = add({ body: "" });
  const pagesId = add({ body: "" });
  const pageId = add({ body: "" });
  const fontId = add({ body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" });

  const xobjects: string[] = [];
  const ocgRefs: Record<string, number> = {};
  if (o.ocg) {
    for (const name of [...o.ocg.off, ...o.ocg.on]) ocgRefs[name] = add({ body: `<< /Type /OCG /Name (${name}) >>` });
  }
  const props = Object.entries(ocgRefs)
    .map(([, id], i) => `/oc${i} ${id} 0 R`)
    .join(" ");
  const ocTag = (layer: string) => {
    const names = Object.keys(ocgRefs);
    const i = names.indexOf(layer);
    return i === -1 ? null : `/oc${i}`;
  };

  let content: string;
  let imageRes = "";
  if (o.raster) {
    const img = rasterise(sheet, prims, o.raster);
    const imgId = add({
      body: `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.data.length} >>`,
      stream: img.data,
    });
    imageRes = `/XObject << /Im0 ${imgId} 0 R >>`;
    content = `q ${f(W)} 0 0 ${f(H)} 0 0 cm /Im0 Do Q`;
  } else {
    // Body primitives (the drawing) and title-block primitives (always plain).
    const body = prims.filter((p) => !isTitle(p));
    const title = prims.filter(isTitle);

    /** Emit a list, grouping block instances into Form XObjects when asked. */
    const emit = (list: Prim[], map: (pt: Pt) => Pt, penScale: number, resFonts: string): string => {
      const out: string[] = [];
      let i = 0;
      let currentOc: string | null = null;
      const setOc = (layer: string) => {
        const tag = o.ocg ? ocTag(layer) : null;
        if (tag !== currentOc) {
          if (currentOc) out.push("EMC");
          if (tag) out.push(`/OC ${tag} BDC`);
          currentOc = tag;
        }
      };
      while (i < list.length) {
        const p = list[i];
        setOc(p.layer);
        if (o.forms && p.inst) {
          const group: Prim[] = [];
          while (i < list.length && list[i].inst === p.inst) group.push(list[i++]);
          // Block definition in "block units": 8 per paper point, anchored at its
          // first point, inserted with a /Matrix that undoes both.
          const anchor = map(firstPoint(group[0]));
          const k = 8;
          const local = (pt: Pt) => {
            const q = map(pt);
            return { x: (q.x - anchor.x) * k, y: (q.y - anchor.y) * k };
          };
          const bbox = boundsOf(group.map((g) => allPoints(g)).flat().map(local));
          const formContent = group.map((g) => primOps(g, local, penScale * k)).join("\n");
          const id = add(
            streamObj(
              formContent,
              ` /Type /XObject /Subtype /Form /BBox [${f(bbox[0] - 50)} ${f(bbox[1] - 50)} ${f(bbox[2] + 50)} ${f(bbox[3] + 50)}] /Matrix [${f(1 / k)} 0 0 ${f(1 / k)} ${f(anchor.x)} ${f(anchor.y)}] /Resources << /Font << ${resFonts} >> >>`,
            ),
          );
          const name = `/Fm${xobjects.length}`;
          xobjects.push(`${name} ${id} 0 R`);
          out.push(`${name} Do`);
          continue;
        }
        out.push(primOps(p, map, penScale));
        i += 1;
      }
      if (currentOc) out.push("EMC");
      return out.join("\n");
    };

    const fonts = `/F1 ${fontId} 0 R`;
    let bodyOps: string;
    if (o.xref) {
      const k = o.xref.k;
      // Inside the xref, coordinates are paper × k. Its /Matrix scales by 0.5/k;
      // the viewport cm scales by 2. Net: 1/k, exactly back to paper.
      const inner = emit(body, (pt) => ({ x: pt.x * k, y: pt.y * k }), k, fonts);
      const xobjsInside = xobjects.splice(0).join(" ");
      const xrefId = add(
        streamObj(
          inner,
          ` /Type /XObject /Subtype /Form /BBox [0 0 ${f(W * k)} ${f(H * k)}] /Matrix [${f(0.5 / k)} 0 0 ${f(0.5 / k)} 0 0] /Resources << /Font << ${fonts} >> /XObject << ${xobjsInside} >> ${o.ocg ? `/Properties << ${props} >>` : ""} >>`,
        ),
      );
      xobjects.push(`/Xref0 ${xrefId} 0 R`);
      bodyOps = "q 1 0 0 1 0 0 cm\nq 2 0 0 2 0 0 cm\nq\n/Xref0 Do\nQ\nQ\nQ";
    } else {
      bodyOps = emit(body, (pt) => pt, 1, fonts);
    }
    if (o.clip) {
      const [x0, y0, x1, y1] = o.clip;
      bodyOps = `q ${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re W n\n${bodyOps}\nQ`;
    }
    content = `${bodyOps}\n${emit(title, (pt) => pt, 1, fonts)}`;
    if (o.outsideCrop && o.outsideCrop.length > 0) content += `\n${o.outsideCrop.map((p) => primOps(p)).join("\n")}`;
  }

  let media = `[0 0 ${f(W)} ${f(H)}]`;
  let extra = "";
  if (o.printAt) {
    const { scale, widthPt, heightPt } = o.printAt;
    const ox = (widthPt - W * scale) / 2;
    const oy = (heightPt - H * scale) / 2;
    content = `q ${f(scale)} 0 0 ${f(scale)} ${f(ox)} ${f(oy)} cm\n${content}\nQ`;
    media = `[0 0 ${f(widthPt)} ${f(heightPt)}]`;
  }
  if (o.rotate90) {
    const m = o.rotate90.margin;
    // Landscape (x, y) → portrait (u, v) = (H + m - y, x + m); /Rotate 90 shows it landscape.
    content = `q 0 1 -1 0 ${f(H + m)} ${f(m)} cm\n${content}\nQ`;
    media = `[0 0 ${f(H + 2 * m)} ${f(W + 2 * m)}]`;
    extra = ` /CropBox [${f(m)} ${f(m)} ${f(H + m)} ${f(W + m)}] /Rotate 90`;
  }

  const contentId = add(streamObj(content));
  const resources = `<< /Font << /F1 ${fontId} 0 R >> ${xobjects.length ? `/XObject << ${xobjects.join(" ")} >>` : imageRes} ${o.ocg ? `/Properties << ${props} >>` : ""} >>`;
  objects[pageId - 1] = { body: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox ${media}${extra} /Resources ${resources} /Contents ${contentId} 0 R >>` };
  objects[pagesId - 1] = { body: `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>` };
  const ocProps = o.ocg
    ? ` /OCProperties << /OCGs [${Object.values(ocgRefs).map((id) => `${id} 0 R`).join(" ")}] /D << /Order [${Object.values(ocgRefs).map((id) => `${id} 0 R`).join(" ")}] /OFF [${o.ocg.off.map((n) => `${ocgRefs[n]} 0 R`).join(" ")}] >> >>`
    : "";
  objects[catalogId - 1] = { body: `<< /Type /Catalog /Pages ${pagesId} 0 R${ocProps} >>` };

  // Serialise with byte-exact xref offsets.
  const parts: Buffer[] = [Buffer.from("%PDF-1.6\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(offset);
    const head = Buffer.from(`${i + 1} 0 obj\n${obj.body}\n`, "latin1");
    const chunk = obj.stream
      ? Buffer.concat([head, Buffer.from("stream\n", "latin1"), obj.stream, Buffer.from("\nendstream\nendobj\n", "latin1")])
      : Buffer.concat([head, Buffer.from("endobj\n", "latin1")]);
    parts.push(chunk);
    offset += chunk.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info << /Producer (prova takeoff bench raw writer) >> >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

function firstPoint(p: Prim): Pt {
  return p.k === "text" ? p.at : p.k === "bez" ? p.start : p.pts[0];
}

function allPoints(p: Prim): Pt[] {
  if (p.k === "text") return [p.at, { x: p.at.x + textWidth(p.s, p.size), y: p.at.y + p.size }];
  if (p.k === "bez") return [p.start, ...p.segs.flat()];
  return p.pts;
}

function boundsOf(pts: Pt[]): [number, number, number, number] {
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ── RASTER ─────────────────────────────────────────────────────────────────────

/** Flatten a cubic into points. */
export function flattenBez(start: Pt, segs: [Pt, Pt, Pt][], perSeg = 12): Pt[] {
  const out: Pt[] = [start];
  let p0 = start;
  for (const [c1, c2, p3] of segs) {
    for (let i = 1; i <= perSeg; i += 1) {
      const t = i / perSeg;
      const mt = 1 - t;
      out.push({
        x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p3.x,
        y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p3.y,
      });
    }
    p0 = p3;
  }
  return out;
}

/** A page "scan": lines rasterised at `dpi`, skewed, with salt-and-pepper noise. */
function rasterise(sheet: Sheet, prims: Prim[], r: NonNullable<PdfOptions["raster"]>) {
  const w = Math.round((sheet.widthPt / 72) * r.dpi);
  const h = Math.round((sheet.heightPt / 72) * r.dpi);
  const img = Buffer.alloc(w * h, 255);
  const k = r.dpi / 72;
  const sk = (r.skewDeg * Math.PI) / 180;
  const cx = sheet.widthPt / 2;
  const cy = sheet.heightPt / 2;
  const toPx = (pt: Pt) => {
    const x = pt.x - cx;
    const y = pt.y - cy;
    const xr = x * Math.cos(sk) - y * Math.sin(sk) + cx;
    const yr = x * Math.sin(sk) + y * Math.cos(sk) + cy;
    return { x: xr * k, y: h - yr * k };
  };
  const plot = (x: number, y: number, v: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && yi >= 0 && xi < w && yi < h) img[yi * w + xi] = Math.min(img[yi * w + xi], v);
  };
  const seg = (a: Pt, b: Pt, pen: number) => {
    const A = toPx(a);
    const B = toPx(b);
    const n = Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y)));
    const rad = Math.max(0, Math.round(pen * k * 0.5));
    for (let i = 0; i <= n; i += 1) {
      const x = A.x + ((B.x - A.x) * i) / n;
      const y = A.y + ((B.y - A.y) * i) / n;
      for (let dx = -rad; dx <= rad; dx += 1) for (let dy = -rad; dy <= rad; dy += 1) plot(x + dx, y + dy, 20);
    }
  };
  for (const p of prims) {
    if (p.k === "path") {
      const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts;
      for (let i = 0; i < pts.length - 1; i += 1) seg(pts[i], pts[i + 1], Math.max(p.w, 0.3));
    } else if (p.k === "bez") {
      const pts = flattenBez(p.start, p.segs);
      for (let i = 0; i < pts.length - 1; i += 1) seg(pts[i], pts[i + 1], p.w);
    } else {
      // Lettering as a smudge the width of the string — a scan has no characters.
      const tw = textWidth(p.s, p.size);
      for (let dy = 0; dy < p.size * 0.7; dy += 72 / r.dpi) seg({ x: p.at.x - (p.anchor === "middle" ? tw / 2 : 0), y: p.at.y + dy }, { x: p.at.x + (p.anchor === "middle" ? tw / 2 : tw), y: p.at.y + dy }, 0.1);
    }
  }
  let seed = r.seed;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < w * h * r.noise; i += 1) img[Math.floor(rnd() * w * h)] = rnd() < 0.5 ? 0 : 255;
  return { w, h, data: deflateSync(img) };
}

// ── SVG (for Chromium → Skia PDF) ──────────────────────────────────────────────

export function writeSvg(sheet: Sheet, prims: Prim[]): string {
  const W = sheet.widthPt;
  const H = sheet.heightPt;
  const out: string[] = [];
  const y = (v: number) => H - v;
  const color = (g?: number) => (g === undefined ? "#000" : `rgb(${Math.round(g * 255)},${Math.round(g * 255)},${Math.round(g * 255)})`);
  for (const p of prims) {
    if (p.k === "text") {
      const rot = -(p.rot ?? 0);
      out.push(
        `<text x="${f(p.at.x)}" y="${f(y(p.at.y))}" font-family="Helvetica, Arial, sans-serif" font-size="${f(p.size)}" text-anchor="${p.anchor === "middle" ? "middle" : "start"}"${rot ? ` transform="rotate(${rot} ${f(p.at.x)} ${f(y(p.at.y))})"` : ""}>${p.s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`,
      );
      continue;
    }
    const dash = p.dash ? ` stroke-dasharray="${p.dash.join(" ")}"` : "";
    const stroke = p.k === "path" && p.stroke === false ? "none" : color(p.gray);
    const fill = p.k === "path" && p.fill !== undefined ? color(p.fill) : "none";
    if (p.k === "bez") {
      const d = `M${f(p.start.x)} ${f(y(p.start.y))} ${p.segs.map(([a, b, c]) => `C${f(a.x)} ${f(y(a.y))} ${f(b.x)} ${f(y(b.y))} ${f(c.x)} ${f(y(c.y))}`).join(" ")}`;
      out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${f(Math.max(p.w, 0.1))}"${dash}/>`);
      continue;
    }
    const d = `M${p.pts.map((q) => `${f(q.x)} ${f(y(q.y))}`).join(" L")}${p.closed ? " Z" : ""}`;
    out.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${f(Math.max(p.w, 0.1))}"${dash}/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W / 72}in" height="${H / 72}in" viewBox="0 0 ${W} ${H}">\n<rect width="${W}" height="${H}" fill="#fff"/>\n${out.join("\n")}\n</svg>\n`;
}

// ── DXF R12 ────────────────────────────────────────────────────────────────────

export function writeDxf(prims: Prim[]): string {
  const layers = [...new Set(prims.map((p) => p.layer))];
  const g = (code: number, value: string | number) => `${code}\n${value}\n`;
  const inch = (v: number) => Number((v / 72).toFixed(5));
  let s = "";
  s += g(0, "SECTION") + g(2, "HEADER") + g(9, "$ACADVER") + g(1, "AC1009") + g(9, "$INSUNITS") + g(70, 1) + g(0, "ENDSEC");
  s += g(0, "SECTION") + g(2, "TABLES");
  s += g(0, "TABLE") + g(2, "LTYPE") + g(70, 2);
  s += g(0, "LTYPE") + g(2, "CONTINUOUS") + g(70, 0) + g(3, "Solid line") + g(72, 65) + g(73, 0) + g(40, 0);
  s += g(0, "LTYPE") + g(2, "DASHED") + g(70, 0) + g(3, "__ __ __") + g(72, 65) + g(73, 2) + g(40, 0.125) + g(49, 0.0833) + g(49, -0.0417);
  s += g(0, "ENDTAB");
  s += g(0, "TABLE") + g(2, "LAYER") + g(70, layers.length);
  layers.forEach((name, i) => {
    s += g(0, "LAYER") + g(2, name) + g(70, 0) + g(62, (i % 7) + 1) + g(6, "CONTINUOUS");
  });
  s += g(0, "ENDTAB") + g(0, "ENDSEC");
  s += g(0, "SECTION") + g(2, "ENTITIES");
  const line = (a: Pt, b: Pt, layer: string, dashed: boolean) => {
    s += g(0, "LINE") + g(8, layer) + (dashed ? g(6, "DASHED") : "") + g(10, inch(a.x)) + g(20, inch(a.y)) + g(30, 0) + g(11, inch(b.x)) + g(21, inch(b.y)) + g(31, 0);
  };
  for (const p of prims) {
    if (p.k === "text") {
      s += g(0, "TEXT") + g(8, p.layer) + g(10, inch(p.at.x)) + g(20, inch(p.at.y)) + g(30, 0) + g(40, inch(p.size * 0.72)) + g(1, p.s) + g(50, p.rot ?? 0);
      if (p.anchor === "middle") s += g(72, 1) + g(11, inch(p.at.x)) + g(21, inch(p.at.y)) + g(31, 0);
      continue;
    }
    const pts = p.k === "bez" ? flattenBez(p.start, p.segs, 8) : p.closed ? [...p.pts, p.pts[0]] : p.pts;
    for (let i = 0; i < pts.length - 1; i += 1) line(pts[i], pts[i + 1], p.layer, !!p.dash);
  }
  s += g(0, "ENDSEC") + g(0, "EOF");
  return s;
}

// ── STROKE FONT (text saved as line work, like SHX) ─────────────────────────────

/**
 * A 14-segment-ish stroke font on a 4×6 cell. Not pretty; it does not need to
 * be. What matters is that the text layer is GONE and the lettering is lines.
 */
const SEG: Record<string, [number, number, number, number][]> = {};
const def = (chars: string, strokes: [number, number, number, number][]) => {
  for (const c of chars) SEG[c] = strokes;
};
const T = [0, 6, 4, 6] as [number, number, number, number];
const M = [0, 3, 4, 3] as [number, number, number, number];
const B = [0, 0, 4, 0] as [number, number, number, number];
const LT = [0, 3, 0, 6] as [number, number, number, number];
const LB = [0, 0, 0, 3] as [number, number, number, number];
const RT = [4, 3, 4, 6] as [number, number, number, number];
const RB = [4, 0, 4, 3] as [number, number, number, number];
const CV = [2, 0, 2, 6] as [number, number, number, number];
def("0O", [T, B, LT, LB, RT, RB]);
def("1I", [CV]);
def("2", [T, RT, M, LB, B]);
def("3", [T, RT, M, RB, B]);
def("4", [LT, M, RT, RB]);
def("5S", [T, LT, M, RB, B]);
def("6", [T, LT, LB, M, RB, B]);
def("7", [T, RT, RB]);
def("8", [T, M, B, LT, LB, RT, RB]);
def("9", [T, M, B, LT, RT, RB]);
def("A", [T, LT, LB, RT, RB, M]);
def("B", [T, M, B, LT, LB, RT, RB, [2, 3, 2, 6]]);
def("C", [T, LT, LB, B]);
def("D", [T, B, CV, RT, RB]);
def("E", [T, M, B, LT, LB]);
def("F", [T, M, LT, LB]);
def("G", [T, LT, LB, B, RB, [2, 3, 4, 3]]);
def("H", [LT, LB, RT, RB, M]);
def("J", [RT, RB, B, LB]);
def("K", [LT, LB, [0, 3, 4, 6], [0, 3, 4, 0]]);
def("L", [LT, LB, B]);
def("M", [LT, LB, RT, RB, [0, 6, 2, 3], [2, 3, 4, 6]]);
def("N", [LT, LB, RT, RB, [0, 6, 4, 0]]);
def("P", [T, M, LT, LB, RT]);
def("Q", [T, B, LT, LB, RT, RB, [2, 2, 4, 0]]);
def("R", [T, M, LT, LB, RT, [2, 3, 4, 0]]);
def("T", [T, CV]);
def("U", [LT, LB, RT, RB, B]);
def("V", [[0, 6, 2, 0], [2, 0, 4, 6]]);
def("W", [LT, LB, RT, RB, B, [2, 0, 2, 3]]);
def("X", [[0, 0, 4, 6], [0, 6, 4, 0]]);
def("Y", [[0, 6, 2, 3], [4, 6, 2, 3], [2, 3, 2, 0]]);
def("Z", [T, [4, 6, 0, 0], B]);
def("'", [[2, 4, 2, 6]]);
def('"', [[1, 4, 1, 6], [3, 4, 3, 6]]);
def("-", [[1, 3, 3, 3]]);
def("/", [[0, 0, 4, 6]]);
def(".", [[2, 0, 2, 0.5]]);
def(",", [[2, 0, 1.5, -1]]);
def(":", [[2, 1, 2, 1.5], [2, 4, 2, 4.5]]);
def("=", [[0, 2, 4, 2], [0, 4, 4, 4]]);
def("(", [[3, 6, 1, 3], [1, 3, 3, 0]]);
def(")", [[1, 6, 3, 3], [3, 3, 1, 0]]);
def("#", [[1, 0, 1, 6], [3, 0, 3, 6], [0, 2, 4, 2], [0, 4, 4, 4]]);
def("x", [[0, 0, 4, 4], [0, 4, 4, 0]]);
def("+", [[2, 1, 2, 5], [0, 3, 4, 3]]);

/** A text primitive as stroked lines. */
export function outlineText(p: Extract<Prim, { k: "text" }>): Prim[] {
  const scale = (p.size * 0.72) / 6;
  const advance = 5.5 * scale;
  const total = p.s.length * advance;
  const rot = ((p.rot ?? 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const shift = p.anchor === "middle" ? total / 2 : 0;
  const out: Prim[] = [];
  [...p.s.toUpperCase()].forEach((ch, i) => {
    const strokes = SEG[ch] ?? (ch === " " ? [] : [T, B, LT, LB, RT, RB]);
    for (const [x1, y1, x2, y2] of strokes) {
      const lx = (x: number) => i * advance - shift + x * scale;
      const map = (x: number, y: number) => ({ x: p.at.x + c * lx(x) - s * y * scale, y: p.at.y + s * lx(x) + c * y * scale });
      out.push({ k: "path", pts: [map(x1, y1), map(x2, y2)], w: Math.max(0.2, p.size / 30), role: p.role, layer: p.layer, inst: p.inst });
    }
  });
  return out;
}
