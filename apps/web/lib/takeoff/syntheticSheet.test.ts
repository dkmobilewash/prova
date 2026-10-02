import { describe as group, expect, it } from "vitest";
import { effectiveDpi, SHEETS, synthesiseSheet, trueCount, type SheetSpec } from "./syntheticSheet";

/**
 * THE FIXTURE HAS TO BE PROVED BEFORE ANYTHING IS MEASURED AGAINST IT.
 *
 * This repo's hardest-won harness rule, from the #418 investigation: **"A control
 * that fails is the instruction to fix the harness, not a result to read."**
 * Three arms of that investigation produced confident wrong numbers and every
 * one was caught by its own control rather than by inspection.
 *
 * A symbol-counting eval graded against a MALFORMED pdf would be the same shape
 * wearing a worse disguise. The model would report a low count or decline, the
 * eval would record "cannot count symbols", and the finding would be about this
 * file instead of about the model — with nothing anywhere to say so. A fixture
 * that is silently repaired by a lenient reader is just as bad: it works, and
 * nobody can reason about what was actually sent.
 *
 * So: every sheet is opened with the same `pdfjs-dist` the app ships, and the
 * page count, the media box and the drawing-operator count are all asserted.
 * `planPdf.ts` established which pdfjs calls work server-side (`numPages`,
 * `getViewport`, `getTextContent` yes; `render()` no, it needs a canvas), so
 * this stays inside that envelope deliberately.
 */

const sheet = (over: Partial<SheetSpec> = {}): SheetSpec => ({
  id: "test",
  sheetSize: "ARCH_D",
  sheetNumber: "A-201",
  symbols: [{ kind: "columnBubble", count: 6 }],
  ...over,
});

async function openSheet(spec: SheetSpec) {
  // The legacy build is what runs in Node — the same import `planPdf.ts` uses.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = synthesiseSheet(spec);
  return pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
}

group("the synthetic sheet is a real PDF", () => {
  it("opens, and has exactly one page", async () => {
    const doc = await openSheet(sheet());
    expect(doc.numPages).toBe(1);
  });

  it("reports the sheet size it claims, in points", async () => {
    // If this drifts, every DPI figure derived from it is wrong, and the whole
    // point of the two-arm eval is the DPI difference between the arms.
    const doc = await openSheet(sheet({ sheetSize: "ARCH_D" }));
    const page = await doc.getPage(1);
    const view = page.getViewport({ scale: 1 });
    expect(view.width).toBeCloseTo(36 * 72, 1);
    expect(view.height).toBeCloseTo(24 * 72, 1);
  });

  it("the DETAIL arm really is the higher-resolution one", async () => {
    // The control's entire reason for existing. If these were equal the eval
    // could not distinguish "cannot count" from "cannot see".
    expect(effectiveDpi("DETAIL")).toBeGreaterThan(effectiveDpi("ARCH_D") * 3);
    expect(Math.round(effectiveDpi("ARCH_D"))).toBe(44);
    expect(Math.round(effectiveDpi("DETAIL"))).toBe(143);
  });

  it("CONTAINS DRAWING, and more of it when more symbols are asked for", async () => {
    // The assertion that catches an empty page. A fixture that emits a valid PDF
    // with nothing on it would pass every test above, and an eval against it
    // would report that the model cannot count — truthfully, and about nothing.
    const few = await (await openSheet(sheet({ symbols: [{ kind: "columnBubble", count: 2 }] }))).getPage(1);
    const many = await (await openSheet(sheet({ symbols: [{ kind: "columnBubble", count: 20 }] }))).getPage(1);
    const fewOps = (await few.getOperatorList()).fnArray.length;
    const manyOps = (await many.getOperatorList()).fnArray.length;
    expect(fewOps).toBeGreaterThan(10);
    expect(manyOps).toBeGreaterThan(fewOps);
  });

  it("draws the title block text, so the page reads as a sheet", async () => {
    const page = await (await openSheet(sheet({ sheetNumber: "A-404" }))).getPage(1);
    const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(" ");
    expect(text).toContain("A-404");
    // And it declares itself, so a synthetic sheet can never be mistaken for a
    // real one if a fixture ever escapes into a report or a screenshot.
    expect(text).toContain("SYNTHETIC");
  });

  it("is byte-identical across runs, so a measurement is reproducible", () => {
    // The jitter is seeded. Two runs that differ would make an eval's result
    // depend on which invocation it was.
    expect(synthesiseSheet(sheet()).equals(synthesiseSheet(sheet()))).toBe(true);
  });

  it("counts its own truth", () => {
    const spec = sheet({
      symbols: [
        { kind: "columnBubble", count: 6 },
        { kind: "door", count: 4 },
      ],
    });
    expect(trueCount(spec)).toBe(10);
    expect(trueCount(spec, "door")).toBe(4);
  });

  it("knows both sheet sizes it offers", () => {
    expect(Object.keys(SHEETS).sort()).toEqual(["ARCH_D", "DETAIL"]);
  });
});
