import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import type { TakeoffSummary } from "./summaryExport";
import { placeEmbedded, takeoffSummaryPdf } from "./summaryPdf";

const box = { x: 40, y: 40, width: 712, height: 500 };

describe("placing an embedded sheet the way a viewer shows it", () => {
  it("an unrotated sheet is drawn at the box's corner, scaled to fit", () => {
    const at = placeEmbedded(0, 2592, 1728, box);
    expect(at).toMatchObject({ x: 40, y: 40, rotateDegrees: 0 });
    expect(at.shown.width).toBeCloseTo(712);
    expect(at.shown.height).toBeCloseTo((712 * 1728) / 2592);
  });
  it("a /Rotate 90 sheet is turned clockwise and its origin lifted so the turned page lands in the box", () => {
    const at = placeEmbedded(90, 1728, 2592, box);
    // Displayed 2592 wide × 1728 tall, like the unrotated sheet.
    expect(at.shown.width).toBeCloseTo(712);
    expect(at.rotateDegrees).toBe(-90);
    // Rotating (u, v) by -90° gives (v, -u): the page's own width hangs below the origin.
    expect(at.x).toBeCloseTo(40);
    expect(at.y).toBeCloseTo(40 + 1728 * at.scale);
  });
  it("270 and 360 are read as a quarter turn the other way and no turn", () => {
    expect(placeEmbedded(270, 1728, 2592, box).rotateDegrees).toBe(-270);
    expect(placeEmbedded(360, 2592, 1728, box).rotateDegrees).toBe(0);
    expect(placeEmbedded(270, 1728, 2592, box).shown.width).toBeCloseTo(712);
  });
});

const summary: TakeoffSummary = {
  walls: [{ name: "P1", typeCode: "P1", linearFt: 35, heightFt: 10, boardSqFt: 700, studs: 30, trackFt: 70, sheets: ["Sheet 1"] }],
  rooms: [{ name: "OFFICE", number: "101", squareFeet: 100, perimeterFt: 40, sheet: "Sheet 1" }],
  areas: [],
  doors: [],
  sheets: [
    {
      pageNumber: 1,
      label: "Sheet 1",
      runs: [{ x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5, name: "P1" }],
      polygons: [{ xs: [0.5, 0.6, 0.6, 0.5], ys: [0.5, 0.5, 0.6, 0.6], name: "101 OFFICE", kind: "room" }],
    },
  ],
};
const meta = { jobName: "Test job", fileName: "plan.pdf", revisionLabel: null, exportedOn: "2026-10-27" };

describe("the summary PDF", () => {
  it("is the tables then one page per measured sheet, with the sheet embedded", async () => {
    const plan = readFileSync("e2e/fixtures/plan-sheet.pdf");
    const bytes = await takeoffSummaryPdf(summary, meta, plan);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
    // The embedded sheet is a form XObject on the second page.
    const xobjects = out.getPage(1).node.Resources()?.lookup(out.context.obj("XObject"));
    expect(String(xobjects)).toMatch(/EmbeddedPdfPage\S* \d+ \d+ R/);
  });
  it("says so on the sheet page when the plan file is missing, will not open, or has a page with nothing on it", async () => {
    const empty = await PDFDocument.create();
    empty.addPage([200, 200]);
    for (const plan of [null, new Uint8Array([1, 2, 3]), await empty.save()]) {
      const out = await PDFDocument.load(await takeoffSummaryPdf(summary, meta, plan));
      expect(out.getPageCount()).toBe(2);
      expect(String(out.getPage(1).node.Resources()?.lookup(out.context.obj("XObject")))).not.toMatch(/EmbeddedPdfPage/);
    }
  });
  it("a rotated sheet embeds without error", async () => {
    const src = await PDFDocument.create();
    const sheet = src.addPage([200, 300]);
    sheet.setRotation(degrees(90));
    sheet.drawLine({ start: { x: 10, y: 10 }, end: { x: 190, y: 290 } });
    const out = await PDFDocument.load(await takeoffSummaryPdf(summary, meta, await src.save()));
    expect(out.getPageCount()).toBe(2);
  });
});
