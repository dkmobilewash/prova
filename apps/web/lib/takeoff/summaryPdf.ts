import type { PDFDocument as PdfDoc, PDFPage as PdfPage } from "pdf-lib";
import type { TakeoffSummary, SheetMarkup } from "./summaryExport";

/**
 * ── THE TAKEOFF SUMMARY AS A PDF: the tables, then one marked-up sheet each ──
 *
 * Letter landscape. The tables first (walls, rooms, areas, doors), then one
 * page per measured sheet: the sheet itself EMBEDDED from the plan file with
 * `pdf-lib` — vector, so it prints clean at any size and needs no rasteriser,
 * which this server does not have — with the measured runs and polygons drawn
 * over it and a legend underneath.
 *
 * `pdf-lib` is imported dynamically, as `lib/estimating/bid-package.ts` does
 * and for the same reason: it is only needed when somebody presses the button.
 */

export type SummaryPdfMeta = {
  jobName: string;
  fileName: string | null;
  revisionLabel: string | null;
  exportedOn: string;
};

const PAGE = { width: 792, height: 612 } as const;
const MARGIN = 40;
const LINE = 13;

/**
 * Where to draw an embedded page so that it DISPLAYS inside `box` the way a
 * viewer displays it — honouring the page's own `/Rotate`, which pdf-lib's
 * `drawPage` does not apply by itself. `width`/`height` are the embedded
 * page's unrotated size; the result is `drawPage`'s origin, scale and
 * rotation plus the displayed size. Pure, so the arithmetic has a test.
 */
export function placeEmbedded(
  rotation: number,
  width: number,
  height: number,
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number; scale: number; rotateDegrees: number; shown: { width: number; height: number } } {
  const turns = (((Math.round(rotation / 90) % 4) + 4) % 4) * 90;
  const sideways = turns === 90 || turns === 270;
  const shownW = sideways ? height : width;
  const shownH = sideways ? width : height;
  const scale = Math.min(box.width / shownW, box.height / shownH);
  // drawPage scales, then rotates about the origin, then translates: find
  // where the scaled-and-rotated rectangle's lowest corner lands and shift the
  // origin so that corner sits at the box's corner.
  const theta = (-turns * Math.PI) / 180;
  const cos = Math.round(Math.cos(theta));
  const sin = Math.round(Math.sin(theta));
  const corners = [
    [0, 0],
    [width * scale, 0],
    [0, height * scale],
    [width * scale, height * scale],
  ].map(([u, v]) => [u * cos - v * sin, u * sin + v * cos]);
  const minX = Math.min(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  return {
    x: box.x - minX,
    y: box.y - minY,
    scale,
    rotateDegrees: -turns || 0,
    shown: { width: shownW * scale, height: shownH * scale },
  };
}

/** A colour per name, stable within one document, readable on a white sheet. */
const PALETTE: [number, number, number][] = [
  [0.85, 0.1, 0.1],
  [0.1, 0.3, 0.85],
  [0.1, 0.6, 0.2],
  [0.8, 0.45, 0],
  [0.55, 0.1, 0.7],
  [0, 0.6, 0.6],
  [0.6, 0.4, 0.1],
  [0.85, 0.1, 0.55],
];

export async function takeoffSummaryPdf(
  summary: TakeoffSummary,
  meta: SummaryPdfMeta,
  plan: Uint8Array | null,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (page: PdfPage, s: string, x: number, y: number, size = 9, heavy = false) =>
    page.drawText(s, { x, y, size, font: heavy ? bold : font, color: rgb(0.1, 0.1, 0.1) });

  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };
  const need = (lines: number) => {
    if (y - lines * LINE < MARGIN) newPage();
  };

  text(page, `Takeoff summary — ${meta.jobName}`, MARGIN, y, 16, true);
  y -= 20;
  text(
    page,
    [meta.fileName, meta.revisionLabel, `exported ${meta.exportedOn}`, "quantities only, no prices"].filter(Boolean).join(" · "),
    MARGIN,
    y,
    9,
  );
  y -= 24;

  const table = (title: string, columns: { head: string; width: number; align?: "right" }[], rows: string[][], empty: string) => {
    need(3);
    text(page, title, MARGIN, y, 12, true);
    y -= LINE + 4;
    if (rows.length === 0) {
      text(page, empty, MARGIN, y, 9);
      y -= LINE * 2;
      return;
    }
    const drawRow = (cells: string[], heavy: boolean) => {
      let x = MARGIN;
      cells.forEach((cell, i) => {
        const col = columns[i];
        const size = 8.5;
        const shown = cell.length > 0 ? cell : "";
        let drawX = x;
        if (col.align === "right") drawX = x + col.width - (heavy ? bold : font).widthOfTextAtSize(shown, size) - 12;
        // Clip long text to its column rather than let it run into the next.
        let fit = shown;
        while (fit.length > 1 && font.widthOfTextAtSize(fit, size) > col.width - 6) fit = fit.slice(0, -2) + "…";
        text(page, fit, drawX, y, size, heavy);
        x += col.width;
      });
      y -= LINE;
    };
    drawRow(
      columns.map((c) => c.head),
      true,
    );
    for (const row of rows) {
      need(1);
      if (y === PAGE.height - MARGIN) drawRow(columns.map((c) => c.head), true);
      drawRow(row, false);
    }
    y -= LINE;
  };

  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));
  table(
    "Walls by type",
    [
      { head: "Type", width: 190 },
      { head: "Feet", width: 60, align: "right" },
      { head: "Height ft", width: 60, align: "right" },
      { head: "Board sq ft", width: 70, align: "right" },
      { head: "Studs", width: 55, align: "right" },
      { head: "Track ft", width: 60, align: "right" },
      { head: "Sheets", width: 210 },
    ],
    summary.walls.map((w) => [w.name, n(w.linearFt), n(w.heightFt), n(w.boardSqFt), n(w.studs), n(w.trackFt), w.sheets.join("; ")]),
    "No walls found yet. Open a sheet and press Find the walls.",
  );
  table(
    "Rooms",
    [
      { head: "Room", width: 220 },
      { head: "Number", width: 70 },
      { head: "Sq ft", width: 70, align: "right" },
      { head: "Perimeter ft", width: 80, align: "right" },
      { head: "Sheet", width: 260 },
    ],
    summary.rooms.map((r) => [r.name, r.number ?? "", n(r.squareFeet), n(r.perimeterFt), r.sheet]),
    "No rooms saved yet.",
  );
  table(
    "Areas by item (ceilings, floors, …)",
    [
      { head: "Item", width: 220 },
      { head: "Measured", width: 70, align: "right" },
      { head: "Sq ft", width: 70, align: "right" },
      { head: "Perimeter ft", width: 80, align: "right" },
      { head: "Sheets", width: 260 },
    ],
    summary.areas.map((a) => [a.item, String(a.measurements), n(a.squareFeet), n(a.perimeterFt), a.sheets.join("; ")]),
    "No areas traced yet.",
  );
  table(
    "Doors, from the schedule",
    [
      { head: "Mark", width: 60 },
      { head: "Description", width: 170 },
      { head: "Size", width: 110 },
      { head: "Qty", width: 40, align: "right" },
      { head: "Notes", width: 190 },
      { head: "Sheet", width: 140 },
    ],
    summary.doors.map((d) => [d.mark, d.description ?? "", d.size ?? "", String(d.quantity), d.notes ?? "", d.sheet]),
    "No door schedule has been read for this set.",
  );

  // ── ONE MARKED-UP SHEET PER MEASURED PAGE ──
  if (summary.sheets.length > 0) {
    let source: PdfDoc | null = null;
    let why: string | null = plan === null ? "the plan file could not be read" : null;
    if (plan !== null) {
      try {
        source = await PDFDocument.load(plan);
      } catch {
        why = "the plan file could not be opened (it may be encrypted)";
      }
    }
    for (const sheet of summary.sheets) {
      newPage();
      text(page, sheet.label, MARGIN, y, 12, true);
      y -= LINE + 4;
      const legendLines = Math.min(6, legendOf(sheet).length) + 1;
      const box = { x: MARGIN, y: MARGIN + legendLines * LINE, width: PAGE.width - 2 * MARGIN, height: y - MARGIN - legendLines * LINE };
      const index = sheet.pageNumber - 1;
      if (source === null || index < 0 || index >= source.getPageCount()) {
        text(page, `Sheet image unavailable: ${why ?? "no such page in the file"}.`, MARGIN, y, 9);
        continue;
      }
      const original = source.getPage(index);
      // A page with no content stream cannot be embedded — pdf-lib throws at
      // `save()`, after the fact — so it is checked here and said so instead.
      if (original.node.Contents() === undefined) {
        text(page, "Sheet image unavailable: this page of the plan file is empty.", MARGIN, y, 9);
        continue;
      }
      const [embedded] = await doc.embedPdf(source, [index]);
      const at = placeEmbedded(original.getRotation().angle, embedded.width, embedded.height, box);
      page.drawPage(embedded, { x: at.x, y: at.y, xScale: at.scale, yScale: at.scale, rotate: degrees(at.rotateDegrees) });
      // Stored coordinates are fractions of the DISPLAYED page width, y down
      // from the top — the viewer's own convention.
      const X = (fx: number) => box.x + fx * at.shown.width;
      const Y = (fy: number) => box.y + at.shown.height - fy * at.shown.width;
      // `drawSvgPath` reads its path y-DOWN from the origin it is given, so the
      // origin is the page's top-left and the path's y is measured from there.
      const svgY = (fy: number) => PAGE.height - Y(fy);
      const colours = colourMap(sheet);
      for (const poly of sheet.polygons) {
        const [r, g, b] = colours.get(poly.name) ?? PALETTE[0];
        const path = poly.xs.map((x, i) => `${i === 0 ? "M" : "L"} ${X(x).toFixed(2)} ${svgY(poly.ys[i]).toFixed(2)}`).join(" ") + " Z";
        page.drawSvgPath(path, { x: 0, y: PAGE.height, color: rgb(r, g, b), opacity: 0.18, borderColor: rgb(r, g, b), borderWidth: 1 });
      }
      for (const run of sheet.runs) {
        const [r, g, b] = colours.get(run.name) ?? PALETTE[0];
        page.drawLine({ start: { x: X(run.x1), y: Y(run.y1) }, end: { x: X(run.x2), y: Y(run.y2) }, thickness: 1.5, color: rgb(r, g, b), opacity: 0.85 });
      }
      let ly = box.y - LINE;
      for (const name of legendOf(sheet).slice(0, 6)) {
        const [r, g, b] = colours.get(name) ?? PALETTE[0];
        page.drawRectangle({ x: MARGIN, y: ly - 1, width: 10, height: 8, color: rgb(r, g, b) });
        text(page, name, MARGIN + 14, ly, 8);
        ly -= LINE;
      }
    }
  }
  return doc.save();
}

function legendOf(sheet: SheetMarkup): string[] {
  return [...new Set([...sheet.runs.map((r) => r.name), ...sheet.polygons.map((p) => p.name)])];
}

function colourMap(sheet: SheetMarkup): Map<string, [number, number, number]> {
  return new Map(legendOf(sheet).map((name, i) => [name, PALETTE[i % PALETTE.length]]));
}
