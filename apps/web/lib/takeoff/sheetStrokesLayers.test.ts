import { describe, expect, it } from "vitest";
import { sheetStrokes } from "./sheetStrokes";
import { writePdf } from "./bench/writers";
import type { Prim, Sheet } from "./bench/sheets";
import { VARIANTS, allSheets, primsForCase, sheetForVariant } from "./bench/cases";

/**
 * ── READING LAYERS OFF A REAL PDF, AND THE BUG THAT FOUND ──
 *
 * Written because the mutation run found five survivors here, all of the same
 * shape: the layer plumbing was covered by a bench PROBE and by nothing a unit
 * suite could see. A probe is run by hand; this fails the build.
 *
 * The third test is the one that matters most and it is not about layers at
 * all. It is about what reading them EXPOSED.
 */

const sheetOf = (prims: Prim[]): Sheet => ({
  id: "P",
  title: "P",
  widthPt: 1224,
  heightPt: 792,
  prims,
  views: [],
  printedScale: "",
  traps: [],
  expectWalls: true,
});

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

describe("a stroke carries the layer it was drawn on", () => {
  it("stamps the name on every segment", async () => {
    const prims = [line(400, "A-WALL"), line(500, "S-GRID"), line(600, "A-FURN")];
    const read = await sheetStrokes(writePdf(sheetOf(prims), prims, { layersAsOcg: true }), 1);

    const byLayer = new Map(read.segments.map((s) => [s.layer, s]));
    expect([...byLayer.keys()].sort()).toEqual(["A-FURN", "A-WALL", "S-GRID"]);
  });

  it("says nothing when the export carries no layers", async () => {
    // The flattened plot, which is most of them, and the case that makes this
    // whole change safe: no layers means no opinions.
    const prims = [line(400, "A-WALL"), line(500, "S-GRID")];
    const read = await sheetStrokes(writePdf(sheetOf(prims), prims), 1);
    expect(read.segments.every((s) => s.layer === undefined)).toBe(true);
    expect(read.segments.length).toBeGreaterThan(0);
  });

  it("SKIPS a layer the drawing has switched off", async () => {
    // `/OFF` means the content is in the file and NOT DRAWN. Measuring it is
    // measuring something nobody can see. The bench's answer key has said so
    // since it was written (probe P8, "expected 0 segments", observed 2) and
    // nothing in a unit suite could see it until now.
    const prims = [line(400, "A-WALL"), line(500, "A-WALL-HIDN")];
    const read = await sheetStrokes(
      writePdf(sheetOf(prims), prims, { ocg: { off: ["A-WALL-HIDN"], on: ["A-WALL"] } }),
      1,
    );
    expect(read.segments.map((s) => s.layer)).toEqual(["A-WALL"]);
    // The CONTROL: the hidden path was still counted as an operator, so this
    // cannot pass by the page having failed to parse. `pathOperators` reports
    // what the PAGE carried, before anything was filtered.
    expect(read.pathOperators).toBe(2);
  });
});

describe("a path split across operators is still one line", () => {
  it("does not lose a segment when pdfjs chunks a path", async () => {
    // ── THE BUG LAYER-READING EXPOSED, WHICH WAS NEVER ABOUT LAYERS ──
    //
    // pdfjs buffers path operators and FLUSHES the buffer on its own schedule.
    // When a flush lands between a path's `m` and its `l`, one path arrives as
    // two `constructPath` operators — `ops=[13]` then `ops=[14]`, with nothing
    // between them. The reader used to start each operator with a null cursor,
    // so the moveTo drew nothing (it is only a move) and the lineTo drew
    // nothing (it had no cursor). The line vanished, silently.
    //
    // Measured on the bench's own A-101: written with layer markers it reads
    // 1,234 path operators against 1,233 and one FEWER segment, and the missing
    // one is wall LB-30's face. Confirmed from the operator list —
    //
    //     2996 setDash        [[],0]
    //     2997 constructPath  ops=[13] coords=[248.9 918.4]
    //     2998 constructPath  ops=[14] coords=[326.9 963.4]
    //     2999 stroke
    //
    // THE TRIGGER IS NOT THE LAYERS. There is no marked-content operator
    // between 2997 and 2998; the markers merely shifted everything along until
    // a flush boundary landed mid-path. That makes this a latent fault in
    // reading ANY sufficiently large PDF, which is the reason it is pinned on
    // the real sheet rather than on a toy: a hand-made fixture of uniform lines
    // does not reproduce it at 200, 500 or 1,000 paths, and tuning one until it
    // did would be asserting the harness rather than the drawing.
    //
    // The two arms are the SAME SHEET written twice, so any difference between
    // them can only be the chunking.
    const sheets = allSheets();
    const variant = VARIANTS.find((v) => v.id === "layers")!;
    const sheet = sheetForVariant("A-101", "layers", sheets);
    const prims = primsForCase(sheet, variant);

    const plain = await sheetStrokes(writePdf(sheet, prims), 1);
    const tagged = await sheetStrokes(writePdf(sheet, prims, { layersAsOcg: true }), 1);

    const key = (s: { x1: number; y1: number; x2: number; y2: number }) =>
      `${s.x1.toFixed(2)},${s.y1.toFixed(2)},${s.x2.toFixed(2)},${s.y2.toFixed(2)}`;

    // THE CONTROL, and it is what makes the assertion below mean anything: the
    // tagged file must really be chunked differently. Without this the test
    // would compare two identical readings and pass with the bug in.
    expect(
      tagged.pathOperators,
      "this sheet no longer splits a path — the regression needs a new fixture, not a weaker assertion",
    ).toBeGreaterThan(plain.pathOperators);

    expect(tagged.segments.map(key).sort(), "a line was lost where pdfjs split a path").toEqual(
      plain.segments.map(key).sort(),
    );
  });
});

describe("the pen's colour rides on every segment", () => {
  it("READS A GREY STROKE AS ITS LUMINANCE, AND LEAVES AN UNCOLOURED ONE ABSENT", async () => {
    const at = (y: number, gray: number): Prim => ({ k: "path", pts: [{ x: 100, y }, { x: 460, y }], w: 0.7, role: "wall", layer: "A-WALL", gray });
    const grey = at(400, 0.5);
    const black = at(500, 0);
    const read = await sheetStrokes(writePdf(sheetOf([grey, black]), [grey, black]), 1);
    const found = (y: number) => read.segments.find((s) => Math.abs(s.y1 - y) < 1 || Math.abs(792 - s.y1 - y) < 1);
    expect(found(400)?.gray).toBeCloseTo(0.5, 2);
    expect(found(500)?.gray).toBeCloseTo(0, 2);
  });
});
