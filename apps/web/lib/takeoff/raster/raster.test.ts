import { describe, expect, it } from "vitest";
import { blank, drawLine, readPgm, writePgm } from "./pgm";
import { blur3, degrade, SCAN_LIKE, skew, speckle } from "./rasterDegrade";
import { estimateSkewDegrees, pageSizeOf, rasterLines } from "./rasterLines";

const DPI = 100; // 1 px = 0.72 pt; minimum run 15 px; a line thicker than 4 px is a fill

describe("PGM", () => {
  it("round-trips a page with a line on it", () => {
    const page = blank(40, 20);
    drawLine(page, 5, 10, 35, 10, 2);
    const back = readPgm(writePgm(page));
    expect([back.width, back.height]).toEqual([40, 20]);
    expect(Array.from(back.data)).toEqual(Array.from(page.data));
    expect(page.data.filter((v) => v === 0).length).toBe(32 * 2);
  });
});

describe("lines off a bitmap", () => {
  it("two thin parallel lines come out as two segments along their middles, in points", () => {
    const page = blank(400, 200);
    drawLine(page, 50, 80, 350, 80, 2);
    drawLine(page, 50, 92, 350, 92, 2);
    const lines = rasterLines(page, { dpi: DPI });
    expect(lines.map((l) => l.axis)).toEqual(["h", "h"]);
    expect(lines.map((l) => Math.round(l.y1 / 0.72))).toEqual([80, 92]);
    expect(lines.map((l) => [Math.round(l.x1 / 0.72), Math.round(l.x2 / 0.72)])).toEqual([
      [49, 351],
      [49, 351],
    ]);
    expect(lines.every((l) => !l.filled)).toBe(true);
    expect(pageSizeOf(page, DPI)).toEqual({ widthPt: 288, heightPt: 144 });
  });

  it("a light-grey fill — an existing wall's poché — comes out as its two faces by the fill pass, not the ink pass", () => {
    const page = blank(400, 200);
    drawLine(page, 50, 100, 350, 100, 12, 230);
    expect(rasterLines(page, { dpi: DPI, fillThreshold: 0 }).length).toBe(0);
    for (const fills of ["runs", "contour"] as const) {
      const lines = rasterLines(page, { dpi: DPI, fills }).filter((l) => l.axis === "h");
      expect(lines.length, fills).toBe(2);
      expect(lines.every((l) => l.filled)).toBe(true);
    }
  });

  it("by contour, a grey room with lettering inside it gives faces on its walls only, and two rooms either side of a wall gap give the wall's two faces", () => {
    const page = blank(400, 300);
    for (let y = 40; y < 140; y += 1) drawLine(page, 40, y, 360, y, 1, 230); // room A
    for (let y = 80; y < 92; y += 1) drawLine(page, 150, y, 250, y, 1, 255); // white lettering inside A
    for (let y = 150; y < 260; y += 1) drawLine(page, 40, y, 360, y, 1, 230); // room B, a 10 px wall gap below A
    const faces = rasterLines(page, { dpi: DPI }).filter((l) => l.filled && l.axis === "h" && Math.abs(l.x2 - l.x1) > 200 * 0.72);
    const ys = [...new Set(faces.map((l) => Math.round(l.y1 / 0.72)))].sort((a, b) => a - b);
    // A's top and bottom, B's top and bottom — nothing at the lettering rows (80–92).
    expect(ys.length).toBe(4);
    expect(ys.every((y) => y < 45 || (y > 135 && y < 155) || y > 255)).toBe(true);
  });

  it("a filled band — a poché wall — comes out as its two faces", () => {
    const page = blank(400, 200);
    drawLine(page, 50, 100, 350, 100, 12);
    // The ink pass finds it, and the fill pass finds it again; both say "faces".
    const lines = rasterLines(page, { dpi: DPI, fillThreshold: 0 });
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.filled && l.axis === "h")).toBe(true);
    const ys = lines.map((l) => l.y1 / 0.72).sort((a, b) => a - b);
    // The two faces sit on the fill's first and last ink rows, twelve rows apart.
    expect(ys[1] - ys[0]).toBeCloseTo(11, 0);
  });

  it("a vertical line is a vertical segment, and lettering-sized marks are dropped", () => {
    const page = blank(200, 400);
    drawLine(page, 100, 20, 100, 380, 1);
    for (let i = 0; i < 10; i += 1) drawLine(page, 20 + i * 8, 50, 20 + i * 8, 58, 1); // 9 px marks
    const lines = rasterLines(page, { dpi: DPI });
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatchObject({ axis: "v" });
    expect(Math.round(lines[0].y2 / 0.72) - Math.round(lines[0].y1 / 0.72)).toBe(361);
  });

  it("a slightly tilted line — a skewed scan — is one segment corner to corner, not a fill", () => {
    const page = blank(600, 200);
    drawLine(page, 50, 100, 550, 100, 2);
    const tilted = skew(page, 1);
    const lines = rasterLines(tilted, { dpi: DPI });
    // The same sense `skew()` applies, so the eval turns the page back by minus this.
    expect(estimateSkewDegrees(lines, 100)).toBeCloseTo(1, 0);
    const long = lines.filter((l) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 300);
    expect(long.length).toBe(1);
    expect(long[0].filled).toBe(false);
    const angle = (Math.atan2(long[0].y2 - long[0].y1, long[0].x2 - long[0].x1) * 180) / Math.PI;
    expect(Math.abs(angle)).toBeGreaterThan(0.5);
    expect(Math.abs(angle)).toBeLessThan(1.5);
  });
});

describe("making a render look like a scan", () => {
  it("speckle is deterministic and bounded; blur spreads ink; the scan-like recipe keeps the line findable", () => {
    const page = blank(300, 100);
    drawLine(page, 20, 50, 280, 50, 2);
    const a = speckle(page, 0.01, 3);
    const b = speckle(page, 0.01, 3);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const changed = a.data.filter((v, i) => v !== page.data[i]).length;
    expect(changed).toBeGreaterThan(100);
    expect(changed).toBeLessThanOrEqual(300);
    const soft = blur3(page);
    expect(soft.data[49 * 300 + 100]).toBeLessThan(255);
    const scanned = degrade(page, SCAN_LIKE);
    // A dropout can break the line; what matters is that most of it survives
    // in one piece and nothing long is found away from it.
    const long = rasterLines(scanned, { dpi: DPI }).filter((l) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 50 * 0.72);
    expect(Math.max(...long.map((l) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) / 0.72))).toBeGreaterThan(200);
    expect(long.every((l) => Math.abs(l.y1 / 0.72 - 50) < 5 && Math.abs(l.y2 / 0.72 - 50) < 5)).toBe(true);
  });
});

describe("what a scan does to lines, and what the extractor does back", () => {
  it("a thick drawn line is ONE line, not its middle plus its two contour edges", () => {
    const page = blank(400, 200);
    drawLine(page, 50, 100, 350, 100, 3); // under the fill cutoff (4 px at 100 dpi), so a line, not a poché
    const lines = rasterLines(page, { dpi: DPI });
    expect(lines.filter((l) => l.axis === "h").length).toBe(1);
  });
  it("a face cut by a joining wall's width is bridged; a door's width is not; dashes stay dashes", () => {
    const page = blank(600, 200);
    drawLine(page, 50, 60, 200, 60, 2);
    drawLine(page, 206, 60, 350, 60, 2); // a 5-px gap: a 5-in join at 1/8", under 0.08 in
    drawLine(page, 50, 120, 200, 120, 2);
    drawLine(page, 240, 120, 350, 120, 2); // a 39-px gap: a door
    for (let x = 50; x < 350; x += 20) drawLine(page, x, 160, x + 8, 160, 2); // 8-px dashes, 12-px gaps, each under the 15-px cut
    const lines = rasterLines(page, { dpi: DPI, fillThreshold: 0 });
    const at = (y: number) => lines.filter((l) => l.axis === "h" && Math.round(l.y1 / 0.72) === y);
    expect(at(60).length).toBe(1);
    expect(at(120).length).toBe(2);
    expect(at(160).length).toBe(0);
  });
  it("a hairline the blur greyed past the ink threshold is found by the faint pass, and a blurred speck is not", () => {
    const page = blank(400, 200);
    drawLine(page, 50, 100, 350, 100, 1, 150); // a light hairline, one pixel: grey 150
    page.data[60 * 400 + 200] = 0; // one black speck
    const blurred = blur3(page); // the hairline is now ~220 at its centre, the speck ~227
    expect(rasterLines(blurred, { dpi: DPI, fillThreshold: 0, faintThreshold: 0 }).length).toBe(0);
    const lines = rasterLines(blurred, { dpi: DPI, fillThreshold: 0 });
    expect(lines.length).toBe(1);
    expect(Math.round(lines[0].y1 / 0.72)).toBe(100);
  });
});

describe("the faint pass beside the ink pass", () => {
  it("a faint face seven pixels from an inked one is a second face, not a copy of the first", () => {
    const page = blank(400, 200);
    drawLine(page, 50, 100, 350, 100, 1); // the darker face: black, found at the ink threshold
    drawLine(page, 50, 107, 350, 107, 1, 150); // the fainter face
    const blurred = blur3(page);
    const ys = rasterLines(blurred, { dpi: DPI, fillThreshold: 0 }).filter((l) => l.axis === "h").map((l) => Math.round(l.y1 / 0.72)).sort((a, b) => a - b);
    expect(ys).toEqual([100, 107]);
  });
  it("faint lines in a field of parallels — a hatch — are not reported; a lone pair is", () => {
    const page = blank(400, 400);
    for (let y = 60; y <= 180; y += 10) drawLine(page, 50, y, 350, y, 1, 150); // thirteen hatch lines, a tenth of an inch apart
    drawLine(page, 50, 300, 350, 300, 1, 150);
    drawLine(page, 50, 307, 350, 307, 1, 150); // a hairline wall, both faces faint
    const ys = rasterLines(blur3(page), { dpi: DPI, fillThreshold: 0 }).filter((l) => l.axis === "h").map((l) => Math.round(l.y1 / 0.72)).sort((a, b) => a - b);
    expect(ys.filter((y) => y < 200).length).toBeLessThanOrEqual(2); // at most the field's two outermost lines, which have neighbours on one side only
    expect(ys.filter((y) => y >= 200)).toEqual([300, 307]);
  });
});
