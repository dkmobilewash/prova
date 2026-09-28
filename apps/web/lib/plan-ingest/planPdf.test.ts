import { describe, expect, it } from "vitest";
import { ARCH_D, planSetPdf, scannedSheet, sheetWithTitleBlock } from "./planFixtures";
import { hasTextLayer, openPlanPdf, titleBlockRegion, titleBlockText } from "./planPdf";

/**
 * THE SERVER CAN READ A PLAN SET, AND THE TITLE-BLOCK FILTER SURVIVES ROTATION.
 *
 * Six comments in this repo said a server-side stage could not open a plan file at
 * all until something rasterised it. This file is the refutation, run rather than
 * argued: a real multi-page PDF, opened in Node, with the sheet number coming back
 * out of the region a title block actually occupies.
 *
 * THE ROTATION CASES ARE THE POINT. `getTextContent()` reports each item's
 * position in UNROTATED PDF user space; `getViewport()` is what applies the page's
 * `/Rotate`. AutoCAD exports plan sheets with `/Rotate 90` routinely, so a filter
 * on the raw x/y reads a strip down the wrong edge on exactly those sheets — and
 * hands the model a region with no title block in it, which then looks like the
 * model failing. The first draft of `planPdf.ts` had that bug.
 *
 * MUTATION-PROVEN, and the exact result is worth recording rather than rounded up.
 * Replacing the `Util.transform` call with the rotation-unaware version — y flipped
 * off the MediaBox, `/Rotate` ignored, which is identical at 0 — turns ROTATE 180
 * AND 270 RED and leaves 0 and 90 green. Two of the four cases discriminate,
 * not all four: at 90 the naive position happens to still satisfy the region's
 * union test (right 40% OR bottom 25%), so it passes for the wrong reason. Keep 90
 * anyway — it costs nothing and a later change to the region's shape could make it
 * the discriminating one — but do not read a green 90 as evidence of anything.
 *
 * The load-bearing fact is that ROTATE 0 STAYS GREEN: a test suite with only an
 * unrotated sheet in it would have shipped this.
 *
 * (A note for whoever edits this header. Writing a bold marker immediately before
 * a slash — two asterisks then "/Rotate" — closes the block comment, and the rest
 * of the file becomes syntax errors. It happened twice while writing this: once in
 * the text, and once again in the sentence warning about it, which spelled the
 * offending pair out. Say it in words. The full suite reports this as a TRANSFORM
 * failure with every one of its 8,184 tests still passing, because a file that
 * cannot be parsed contributes no failing assertions — which reads nothing at all
 * like a broken test.)
 */

async function read(pdf: Buffer, pageNumber = 1) {
  const doc = await openPlanPdf(pdf);
  try {
    return { page: await doc.pageText(pageNumber), pageCount: doc.pageCount };
  } finally {
    await doc.close();
  }
}

describe("reading a plan set in Node", () => {
  it("opens a multi-page set and reports its page count", async () => {
    const pdf = planSetPdf([
      sheetWithTitleBlock({ sheetNumber: "A-101", title: "FIRST FLOOR PLAN" }),
      sheetWithTitleBlock({ sheetNumber: "A-102", title: "SECOND FLOOR PLAN" }),
      sheetWithTitleBlock({ sheetNumber: "A-201", title: "EXTERIOR ELEVATIONS" }),
    ]);
    const { pageCount } = await read(pdf);
    expect(pageCount).toBe(3);
  });

  it("reads each sheet's own title block, not the first sheet's", async () => {
    // A set where every page is identical but for its number would let a bug that
    // always reads page 1 pass.
    const pdf = planSetPdf([
      sheetWithTitleBlock({ sheetNumber: "A-101", title: "FIRST FLOOR PLAN" }),
      sheetWithTitleBlock({ sheetNumber: "A-102", title: "SECOND FLOOR PLAN" }),
    ]);
    const first = await read(pdf, 1);
    const second = await read(pdf, 2);
    expect(titleBlockText(first.page).text).toContain("A-101");
    expect(titleBlockText(first.page).text).not.toContain("A-102");
    expect(titleBlockText(second.page).text).toContain("A-102");
    expect(titleBlockText(second.page).text).not.toContain("A-101");
  });

  it("reports the sheet's size in points, so inches are knowable server-side", async () => {
    const { page } = await read(planSetPdf([sheetWithTitleBlock({ sheetNumber: "A-101", title: "PLAN" })]));
    expect(page.widthPt).toBe(ARCH_D.widthPt);
    expect(page.heightPt).toBe(ARCH_D.heightPt);
    // 2592pt / 72 = 36 inches. The number that makes the rasterisation arithmetic
    // in this module's header checkable.
    expect(page.widthPt / 72).toBe(36);
  });
});

describe("the title-block region", () => {
  it("finds the sheet number and leaves the drawing content out", async () => {
    const { page } = await read(
      planSetPdf([sheetWithTitleBlock({ sheetNumber: "A-101", title: "FIRST FLOOR PLAN" })]),
    );
    const region = titleBlockRegion(page);
    expect(region.source).toBe("region");
    const text = region.items.map((i) => i.str).join(" ");
    expect(text).toContain("A-101");
    expect(text).toContain("FIRST FLOOR PLAN");
    // THE HALF THAT PROVES THE FILTER IS DOING ANYTHING. A filter that returned
    // every item would pass every assertion above.
    expect(text).not.toContain("PARTITION TYPE A");
    expect(text).not.toContain("CORRIDOR 1-08");
  });

  it.each([90, 180, 270] as const)("still finds it on a /Rotate %i sheet", async (rotation) => {
    const { page } = await read(
      planSetPdf([sheetWithTitleBlock({ sheetNumber: "A-101", title: "FIRST FLOOR PLAN", rotation })]),
    );
    // The viewport reports the sheet as DISPLAYED, so a 90/270 rotation swaps the
    // reported dimensions. Asserted because it is the evidence the transform was
    // applied at all.
    const swapped = rotation === 90 || rotation === 270;
    expect(page.widthPt).toBe(swapped ? ARCH_D.heightPt : ARCH_D.widthPt);
    expect(page.rotation).toBe(rotation);

    const region = titleBlockRegion(page);
    const text = region.items.map((i) => i.str).join(" ");
    expect(text, `the sheet number should be in the title-block region at /Rotate ${rotation}`).toContain("A-101");
    expect(text, `drawing content should stay out of the region at /Rotate ${rotation}`).not.toContain(
      "PARTITION TYPE A",
    );
  });

  it("puts the title block in reading order, not content-stream order", async () => {
    const { page } = await read(
      planSetPdf([sheetWithTitleBlock({ sheetNumber: "A-101", title: "FIRST FLOOR PLAN" })]),
    );
    const { text } = titleBlockText(page);
    const lines = text.split("\n");
    // The architect's name is plotted highest in the block and the sheet number
    // lowest, so top-down ordering puts them at opposite ends. Content-stream
    // order happens to agree here, which is why the assertion is on POSITION
    // rather than on the order the fixture wrote them.
    expect(lines[0]).toContain("ZZ SYNTHETIC ARCHITECTS");
    expect(lines.at(-1)).toContain("A-101");
  });
});

describe("a sheet with no text layer", () => {
  it("is reported as a fact, and its region does not pretend to have found one", async () => {
    const { page } = await read(planSetPdf([scannedSheet()]));
    // The writer always adds its own reference code, so "no text layer" here means
    // nothing beyond that one marking — which is the shape a scanned sheet has.
    expect(page.items.length).toBeLessThan(3);
    expect(hasTextLayer(page)).toBe(false);
  });

  it("falls back to the whole page rather than handing over an empty region", async () => {
    // A sheet whose title block sits somewhere this module does not expect: text
    // exists, but not where the filter looks. An empty region would be
    // indistinguishable from a scan, so the fallback answers correctly and says so.
    const { page } = await read(
      planSetPdf([
        {
          ...ARCH_D,
          items: [
            { x: 120, y: ARCH_D.heightPt - 120, text: "A-101" },
            { x: 120, y: ARCH_D.heightPt - 160, text: "FIRST FLOOR PLAN" },
            { x: 120, y: ARCH_D.heightPt - 200, text: "ARCHITECTURAL" },
            { x: 120, y: ARCH_D.heightPt - 240, text: "ISSUED 2026-03-04" },
          ],
        },
      ]),
    );
    const region = titleBlockRegion(page);
    expect(region.source).toBe("whole-page");
    expect(region.items.map((i) => i.str).join(" ")).toContain("A-101");
    expect(hasTextLayer(page)).toBe(true);
  });
});
