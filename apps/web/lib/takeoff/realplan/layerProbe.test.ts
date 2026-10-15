import { describe, expect, it } from "vitest";
import { writePdf } from "../bench/writers";
import type { Prim, Sheet } from "../bench/sheets";
import { readLayers } from "./layerProbe";

/**
 * ── A PROBE NOBODY HAS PROVED CAN SEE A LAYER IS NOT A PROBE ──
 *
 * `layerProbe.ts` exists to answer one question before a week of work starts:
 * do real plan sets name their layers? The dangerous outcome is not a wrong
 * number, it is `0 layers` — because that reads as a finding about the
 * ARCHITECT'S FILE when it may be a fact about this reader. A broken probe
 * would answer "no, abandon the idea" on every file in the world, confidently,
 * in one line.
 *
 * So it is pointed at a PDF this repo wrote, whose layers are known because we
 * put them there. That is the whole of what this file does, and it is CLAUDE.md's
 * standing rule about a check that derives its input: assert the SIZE of the set
 * against something that cannot drift with the parser, or a pattern matching
 * nothing passes every assertion downstream.
 *
 * It is also the positive control the other direction needs: the `no layers`
 * case is asserted against the SAME geometry written without optional content,
 * so "found nothing" is proved to mean something.
 */

const WIDTH = 1224;

/** A line on a named layer. The geometry is irrelevant here — only which group
 *  the operator lands in — so these are the simplest strokes that exist. */
const line = (y: number, layer: string): Prim => ({
  k: "path",
  pts: [
    { x: 100, y },
    { x: 460, y },
  ],
  w: 0.7,
  role: "wall",
  layer,
});

function pdfOf(prims: Prim[], ocg?: { off: string[]; on: string[] }) {
  const sheet: Sheet = {
    id: "P",
    title: "P",
    widthPt: WIDTH,
    heightPt: 792,
    prims,
    views: [],
    printedScale: "",
    traps: [],
    expectWalls: true,
  };
  return writePdf(sheet, prims, ocg ? { ocg } : {});
}

const PRIMS = [
  line(400, "A-WALL"),
  line(403, "A-WALL"),
  line(500, "S-GRID"),
  line(600, "A-FURN"),
  line(700, "A-WALL-DEMO"),
];

describe("the layer probe can see a layer", () => {
  it("names every layer and counts the geometry on each", async () => {
    const bytes = pdfOf(PRIMS, { off: ["A-WALL-DEMO"], on: ["A-WALL", "S-GRID", "A-FURN"] });
    const [page] = await readLayers(bytes, [1]);

    const names = page.byLayer.map((l) => l.name).sort();
    expect(names).toEqual(["A-FURN", "A-WALL", "A-WALL-DEMO", "S-GRID"]);
    // Two strokes on A-WALL, one on each of the others — so the count is doing
    // arithmetic rather than reporting presence.
    expect(page.byLayer.find((l) => l.name === "A-WALL")?.pathOperators).toBe(2);
    expect(page.byLayer.find((l) => l.name === "S-GRID")?.pathOperators).toBe(1);
  });

  it("knows which layer the drawing has switched OFF", async () => {
    // The half that matters most for wall detection: a layer in `/OFF` is in the
    // file and NOT on the sheet, and today it is measured as though it were.
    const bytes = pdfOf(PRIMS, { off: ["A-WALL-DEMO"], on: ["A-WALL", "S-GRID", "A-FURN"] });
    const [page] = await readLayers(bytes, [1]);

    expect(page.byLayer.find((l) => l.name === "A-WALL-DEMO")?.visible).toBe(false);
    expect(page.byLayer.find((l) => l.name === "A-WALL")?.visible).toBe(true);
  });

  it("counts every path operator, so 'no layers' can be told from 'no geometry'", async () => {
    const bytes = pdfOf(PRIMS, { off: [], on: ["A-WALL", "S-GRID", "A-FURN", "A-WALL-DEMO"] });
    const [page] = await readLayers(bytes, [1]);

    // THE CONTROL THE REPORT PRINTS. Without it a scanned sheet and an export
    // with no layer information produce the same line.
    expect(page.pathOperators).toBeGreaterThanOrEqual(page.underOptionalContent);
    expect(page.underOptionalContent).toBeGreaterThan(0);
  });

  it("reports NO layers on the same drawing written without optional content", async () => {
    // The negative arm. `pathOperators` must still be non-zero, or this would
    // pass on a PDF that failed to parse — which is the exact confusion the
    // report's control line exists to prevent.
    const [page] = await readLayers(pdfOf(PRIMS), [1]);

    expect(page.byLayer).toEqual([]);
    expect(page.underOptionalContent).toBe(0);
    expect(page.pathOperators).toBeGreaterThan(0);
  });

  it("skips a page that is not in the document rather than inventing one", async () => {
    expect(await readLayers(pdfOf(PRIMS), [9])).toEqual([]);
  });
});
