import { describe, expect, it } from "vitest";
import { findWallsOnSheet, fromBaseline, inPageWidthUnits } from "./findWallsOnSheet";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── THE TWO CONVERSIONS THE PIPELINE DOES ITSELF ──
 *
 * Both were lines inside a React component until the pipeline was lifted, and
 * both were MUTATION-TESTED AS UNCATCHABLE at that point: dropping the glyph
 * shift, and reversing its sign, left every one of the 11,042 tests in this
 * repo green. That is the worst shape a defect can have here — nothing throws,
 * and the only symptom is a wall quietly miscounted on a drawing nobody is
 * going to re-measure by hand.
 *
 * These are cheap because the pipeline is a function now. That is the whole
 * argument for having lifted it.
 */
describe("the conversions the caller must not do", () => {
  describe("fromBaseline — a word's baseline becomes its top edge", () => {
    it("MOVES THE BOX UP BY THE GLYPH HEIGHT, not down and not nowhere", () => {
      // `planPdf.pageText` stores `y: m[5]`, the BASELINE. Every consumer here
      // wants the top edge, with the box growing downwards by `height`.
      const word = { str: "A1", x: 40, y: 100, width: 12, height: 10 };
      expect(fromBaseline(word).y).toBe(90);
    });

    it("leaves x, width, height and the string alone", () => {
      // The shift is in one axis. A version that also touched `height` would
      // make the box the wrong SIZE as well as the wrong place, and the
      // lettering filter tests a wall's midpoint against that box.
      const word = { str: "EXT-1", x: 40, y: 100, width: 12, height: 10 };
      expect(fromBaseline(word)).toEqual({ str: "EXT-1", x: 40, y: 90, width: 12, height: 10 });
    });

    it("a zero-height item is unmoved, which is degenerate and not an error", () => {
      expect(fromBaseline({ str: "", x: 5, y: 7, width: 0, height: 0 }).y).toBe(7);
    });
  });

  describe("inPageWidthUnits — points become fractions of this page's width", () => {
    it("CARRIES `curved`, which is the bench's own drift", () => {
      // `wallRuns.ts` filters `curved !== true` to keep flattened arcs out of
      // the room engine. This rebuilds the object field by field, so a dropped
      // flag reads as "not curved" and the arc goes back in — the lobby wall
      // billed twice, 1,957 ft against a key of 1,894. The bench's copy of this
      // conversion dropped it, which is half of why the pipeline was lifted.
      const arc = { x1: 0, y1: 0, x2: 10, y2: 0, width: 2, curved: true };
      expect(inPageWidthUnits(100)(arc).curved).toBe(true);
    });

    it("does not INVENT a flag for an ordinary segment", () => {
      // `!== true` would read a fabricated `false` the same way, so this is not
      // about the filter — it is about not telling a later reader that
      // something was measured when it was not.
      const straight = { x1: 0, y1: 0, x2: 10, y2: 0, width: 2 };
      expect(inPageWidthUnits(100)(straight).curved).toBeUndefined();
    });

    it("scales the COORDINATES and deliberately not the pen", () => {
      const one = inPageWidthUnits(200)({ x1: 50, y1: 100, x2: 150, y2: 100, width: 3 });
      expect([one.x1, one.y1, one.x2, one.y2]).toEqual([0.25, 0.5, 0.75, 0.5]);
      // `width` stays in points: the pen is compared against other pens on the
      // same sheet, never against a distance, so scaling it would be arithmetic
      // with no meaning.
      expect(one.width).toBe(3);
    });
  });
  describe("the layer filter actually reaches the detector", () => {
    // ── A MUTATION SURVIVED HERE AND THIS IS THE TEST IT OWED ──
    //
    // Computing the filtered set and then handing the detector `input.segments`
    // anyway left every test green: the panel would report lines dropped while
    // measuring every one of them. The same quiet shape the template census
    // already guards — "compute it, report the count, feed the detector the
    // unfiltered list" — one filter further down.
    //
    // ENOUGH WALLS TO BE A BUILDING. `wallsInTheBuilding` keeps the biggest
    // connected group and returns NOTHING below `NOT_A_BOX` runs, so a fixture
    // of three walls measures the building filter rather than this one. The
    // first attempt did exactly that and its control read zero.
    const pair = (y: number, layer: string) => [
      { x1: 100, y1: y, x2: 460, y2: y, width: 0.7, layer },
      { x1: 100, y1: y + 3.656, x2: 460, y2: y + 3.656, width: 0.7, layer },
    ];
    /** Twelve partitions and four pieces of furniture, stacked close enough to
     *  be one building. */
    const sheetOf = (furnitureLayer: string | undefined) => [
      ...Array.from({ length: 12 }, (_, i) => pair(200 + i * 20, "A-WALL")).flat(),
      ...Array.from({ length: 4 }, (_, i) => pair(460 + i * 20, furnitureLayer as string)).flat(),
    ];

    const run = (segments: StrokeSegment[]) =>
      findWallsOnSheet({
        segments,
        textItems: [],
        pageSize: { widthPt: 1224, heightPt: 792 },
        // 1224pt at 1/8" = 1'-0" is 136 ft across.
        feetPerUnit: 136,
        wallTypes: [],
        sampledSheets: null,
      });

    it("measures the walls and not the furniture beside them", () => {
      const control = run(sheetOf(undefined).map((g) => ({ ...g, layer: undefined })));
      const filtered = run(sheetOf("A-FURN"));

      // THE CONTROL IS THE POINT: without layers all sixteen are walls, so the
      // drawing really does contain sixteen wall-shaped things and the filter
      // is what removes four of them. Without this the test would pass on a
      // fixture that produced nothing at all.
      expect(control.walls.length, "the control found nothing — the fixture is wrong").toBe(16);
      expect(filtered.walls.length).toBe(12);
      expect(filtered.layerDropped).toEqual([{ layer: "A-FURN", verdict: "not-wall", segments: 8 }]);
    });

    it("reports nothing dropped on a sheet with no layers", () => {
      expect(run(sheetOf(undefined).map((g) => ({ ...g, layer: undefined }))).layerDropped).toEqual([]);
    });
  });

  describe("the doors drawn in the walls it found", () => {
    // The same building, with one wall broken for a 3 ft doorway (27pt at
    // 136 ft across 1224pt), its door drawn, and NO layers — the way most
    // exported sheets arrive, and the way the bench's corridor doors are.
    const walls = (withDoor: boolean): StrokeSegment[] =>
      Array.from({ length: 12 }, (_, i) => {
        const y = 200 + i * 20;
        if (i !== 5 || !withDoor) {
          return [
            { x1: 100, y1: y, x2: 460, y2: y, width: 0.7, layer: "A-WALL" },
            { x1: 100, y1: y + 3.656, x2: 460, y2: y + 3.656, width: 0.7, layer: "A-WALL" },
          ];
        }
        return [
          { x1: 100, y1: y, x2: 280, y2: y, width: 0.7, layer: "A-WALL" },
          { x1: 307, y1: y, x2: 460, y2: y, width: 0.7, layer: "A-WALL" },
          { x1: 100, y1: y + 3.656, x2: 280, y2: y + 3.656, width: 0.7, layer: "A-WALL" },
          { x1: 307, y1: y + 3.656, x2: 460, y2: y + 3.656, width: 0.7, layer: "A-WALL" },
        ];
      }).flat();
    // The leaf, standing open as a thin rectangle from the hinge, and the swing
    // from its tip back to the far jamb — the way the bench and most CAD
    // libraries draw a door.
    const leaf: StrokeSegment[] = [
      { x1: 280, y1: 300, x2: 280, y2: 273, width: 0.35, layer: "A-DOOR" },
      { x1: 280, y1: 273, x2: 281.3, y2: 273, width: 0.35, layer: "A-DOOR" },
      { x1: 281.3, y1: 273, x2: 281.3, y2: 300, width: 0.35, layer: "A-DOOR" },
      { x1: 281.3, y1: 300, x2: 280, y2: 300, width: 0.35, layer: "A-DOOR" },
    ];
    // AND THE DOOR'S TAG, a small circle in front of the opening. This is the
    // part that matters: `gridBubbles` reads a tag circle as a column-grid
    // bubble, and `linesIntoBubbles` then drops every stroke with an END
    // inside it — which, on the bench, was three of the five pieces of every
    // corridor door's swing. The finder is right to drop them for PAIRING;
    // the proposal must read the strokes as drawn.
    const tag: StrokeSegment[] = Array.from({ length: 16 }, (_, k) => {
      const s = (k * 2 * Math.PI) / 16;
      const e = ((k + 1) * 2 * Math.PI) / 16;
      return { x1: 293.5 + 5 * Math.cos(s), y1: 280.2 + 5 * Math.sin(s), x2: 293.5 + 5 * Math.cos(e), y2: 280.2 + 5 * Math.sin(e), width: 0.3, curved: true, layer: "A-ANNO-SYMB" };
    });
    const swing: StrokeSegment[] = [...leaf, ...tag, ...Array.from({ length: 8 }, (_, k) => {
      const s = (-k * 90 * Math.PI) / 180 / 8;
      const e = (-(k + 1) * 90 * Math.PI) / 180 / 8;
      return {
        x1: 280 + 27 * Math.cos(s),
        y1: 300 + 27 * Math.sin(s),
        x2: 280 + 27 * Math.cos(e),
        y2: 300 + 27 * Math.sin(e),
        width: 0.35,
        curved: true,
        layer: "A-DOOR",
      };
    })];
    const find = (segments: StrokeSegment[]) =>
      findWallsOnSheet({
        segments: segments.map((s) => ({ ...s, layer: undefined })),
        textItems: [],
        pageSize: { widthPt: 1224, heightPt: 792 },
        feetPerUnit: 136,
        wallTypes: [],
        sampledSheets: null,
      });

    it("attaches the door to the run it is in, measured jamb to jamb", () => {
      const found = find([...walls(true), ...swing]);
      const withDoors = found.walls.filter((w) => (w.proposedOpenings ?? []).length > 0);
      expect(withDoors).toHaveLength(1);
      const [door] = withDoors[0].proposedOpenings!;
      expect(door.kind).toBe("door");
      expect(door.widthFt).toBeCloseTo(3, 2);
      // And the group the panel shows carries it too — that is what it reads.
      const inGroups = found.groups.flatMap((g) => g.runs).filter((r) => (r.proposedOpenings ?? []).length > 0);
      expect(inGroups).toHaveLength(1);
    });

    it("changes no wall: the runs are the same with the swing drawn as without it", () => {
      // The control for the whole module's promise. A swing is evidence about
      // an opening, and the finder's walls must not move because one is there.
      const strip = (ws: ReturnType<typeof find>["walls"]) =>
        ws.map((w) => ({ ...w, proposedOpenings: undefined }));
      const plain = find(walls(true));
      const swung = find([...walls(true), ...swing]);
      expect(plain.walls.every((w) => w.proposedOpenings === undefined)).toBe(true);
      expect(strip(swung.walls)).toEqual(strip(plain.walls));
    });
  });
});
