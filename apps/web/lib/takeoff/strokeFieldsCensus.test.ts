import { describe, expect, it } from "vitest";
import { inPageWidthUnits } from "./findWallsOnSheet";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── NOTHING MAY FALL OUT OF A SEGMENT ON THE WAY INTO PAGE-WIDTH UNITS ──
 *
 * `inPageWidthUnits` rebuilds a `StrokeSegment` FIELD BY FIELD, which means
 * every field anybody adds to that type has to be listed there by hand or it is
 * silently gone. Nothing throws. Nothing turns red. The consumer downstream
 * simply receives `undefined` and treats it as "no information", which is
 * indistinguishable from an honest absence.
 *
 * THIS HAS ALREADY HAPPENED ONCE AND COST A MEASUREMENT. `curved` was dropped
 * by the bench's copy of this conversion, which let flattened arcs back into the
 * room engine; the viewer's own comment predicted the result, 1,957 ft against a
 * key of 1,894 — one wall billed twice. All 11,042 tests were green.
 *
 * `layer` is the second field with that shape, and the failure mode is worse
 * because it is INVISIBLE RATHER THAN WRONG: drop it and every segment arrives
 * with no layer, every layer reads as `unknown`, the filter keeps everything,
 * and the whole feature reports a number identical to not having built it.
 *
 * So this asserts the CLASS rather than the instance. The field list is derived
 * from an object with every field populated, so a field added to
 * `StrokeSegment` tomorrow is covered without anybody editing this file — which
 * is the only version of this test that survives the thing it is guarding
 * against.
 */

/**
 * One segment with EVERY field set to a value that cannot be confused with a
 * default. The type annotation is what drags a new field into view: add one to
 * `StrokeSegment` and this object does not have to compile — it is
 * `Required<>`, so typecheck names the missing field before the test runs.
 */
const EVERY_FIELD: Required<StrokeSegment> = {
  x1: 10,
  y1: 20,
  x2: 30,
  y2: 40,
  width: 0.7,
  curved: true,
  layer: "A-WALL",
  gray: 0.5,
};

describe("inPageWidthUnits carries every field of a stroke", () => {
  it("loses none of them", () => {
    const out = inPageWidthUnits(100)(EVERY_FIELD);
    // Derived from the fixture, not written out again here: a hand-written list
    // would rot the moment somebody adds a field, which is the bug.
    for (const field of Object.keys(EVERY_FIELD) as (keyof StrokeSegment)[]) {
      expect(out, `"${field}" was dropped on the way into page-width units`).toHaveProperty(field);
      expect(out[field], `"${field}" arrived undefined`).not.toBeUndefined();
    }
  });

  it("scales the geometry and leaves everything else alone", () => {
    // The census above would pass on a function that copied the fields and
    // scaled NOTHING, so the conversion itself is pinned here. Without this the
    // file would be a shape check wearing a correctness check's name.
    const out = inPageWidthUnits(100)(EVERY_FIELD);
    expect([out.x1, out.y1, out.x2, out.y2]).toEqual([0.1, 0.2, 0.3, 0.4]);
    // The pen is NOT scaled, deliberately — it is compared against other pens
    // on the same sheet, never against a distance, so scaling it would be
    // arithmetic with no meaning. `inPageWidthUnits`'s own comment says so.
    expect(out.width).toBe(0.7);
    expect(out.curved).toBe(true);
    expect(out.layer).toBe("A-WALL");
  });

  it("leaves an absent field absent rather than inventing one", () => {
    // A flattened plot has no layers and a straight line is not curved. Those
    // must stay `undefined` — a filter that read `""` as a layer name would
    // judge every stroke on a layerless sheet.
    const plain: StrokeSegment = { x1: 1, y1: 2, x2: 3, y2: 4 };
    const out = inPageWidthUnits(10)(plain);
    expect(out.layer).toBeUndefined();
    expect(out.curved).toBeUndefined();
  });
});
