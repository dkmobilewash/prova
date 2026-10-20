import { describe, expect, it } from "vitest";
import { shapeFromLegend, tagSymbols, type TextForSymbol } from "./tagSymbols";
import type { StrokeSegment } from "./wallVectors";

/**
 * Sizes are in POINTS at 72 per paper inch, which is what the real evals pass,
 * so a radius here means the same thing it does on a sheet. The symbols
 * measured on Camp Bow Wow A101 run 0.19in to 0.36in, and its detail callouts
 * are 0.20in — both inside the band this file accepts.
 */
const PER_INCH = 72;

/** A regular polygon, drawn the way a CAD export emits one: edge by edge. */
function polygon(cx: number, cy: number, radius: number, sides: number): StrokeSegment[] {
  const at = (i: number) => ({
    x: cx + radius * Math.cos((i / sides) * Math.PI * 2),
    y: cy + radius * Math.sin((i / sides) * Math.PI * 2),
  });
  const out: StrokeSegment[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = at(i);
    const b = at(i + 1);
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return out;
}

/** Text centred at a point, sized roughly as drawing lettering. */
function label(str: string, cx: number, cy: number): TextForSymbol {
  const width = str.length * 4;
  return { str, x: cx - width / 2, y: cy - 3, width, height: 6 };
}

const R = 0.22 * PER_INCH;

describe("finding the tag symbols on a sheet", () => {
  it("finds a hexagon with a code in it", () => {
    const got = tagSymbols({
      segments: polygon(100, 100, R, 6),
      text: [label("A1", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].shape).toBe("hexagon");
    expect(got[0].corners).toBe(6);
    expect(got[0].text).toBe("A1");
    expect(got[0].rejected).toBeNull();
  });

  it("calls a many-sided polygon a circle", () => {
    // A CAD circle arrives as a great many short segments, not as an arc.
    const got = tagSymbols({
      segments: polygon(100, 100, R, 32),
      text: [label("B", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].shape).toBe("circle");
    expect(got[0].rejected).toBeNull();
  });

  it("tells a diamond from a hexagon, which is how a set's own shape is learned", () => {
    const got = tagSymbols({
      segments: polygon(100, 100, R, 4),
      text: [label("P2", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].shape).toBe("square");
    expect(got[0].corners).toBe(4);
  });

  it("ignores a shape far too big or too small to be a tag", () => {
    const tiny = tagSymbols({
      segments: polygon(100, 100, 0.01 * PER_INCH, 6),
      text: [label("A1", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    const huge = tagSymbols({
      segments: polygon(400, 400, 2 * PER_INCH, 6),
      text: [label("A1", 400, 400)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(tiny).toHaveLength(0);
    expect(huge).toHaveLength(0);
  });

  /**
   * ── TWO MUTANTS SURVIVE HERE, AND BOTH ARE EQUIVALENT ──
   *
   * Deleting the closed-loop turn check, and deleting the `unitsPerPaperInch > 0`
   * guard, both leave every test green. Neither is a hole; in each case a later
   * check is already doing the work, which is what this repo's rule says to look
   * for before strengthening anything:
   *
   *   - an OPEN shape has its centroid pulled toward the drawn side, so its
   *     vertices are no longer equidistant and the roundness test rejects it.
   *     Worked through for arcs: below about 270 degrees roundness rejects well
   *     before the turn check would, and above about 330 both accept. The turn
   *     check only decides the narrow band between, and no fixture here is in
   *     it;
   *   - a scale of zero makes every size bound zero, so the segment-length
   *     filter keeps nothing and the walk has nothing to walk.
   *
   * Both are kept rather than deleted, because each is the guard that STATES
   * the intent — and a reader who removes the later check, believing the guard
   * covers it, would then have neither. No fixture is contrived to kill them:
   * a test written to catch an equivalent mutant tests the mutation, not the
   * code.
   */
  it("ignores a shape that does not close", () => {
    // Three sides of a hexagon is a door swing or a stray polyline.
    const open = polygon(100, 100, R, 6).slice(0, 3);
    expect(
      tagSymbols({ segments: open, text: [label("A1", 100, 100)], unitsPerPaperInch: PER_INCH }),
    ).toHaveLength(0);
  });

  it("takes only the text INSIDE the symbol", () => {
    const got = tagSymbols({
      segments: polygon(100, 100, R, 6),
      text: [label("A1", 100, 100), label("CORRIDOR 114", 400, 400)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].text).toBe("A1");
  });
});

describe("telling a tag from a detail callout", () => {
  it("rejects a symbol holding a sheet reference", () => {
    // Camp Bow Wow A101 is covered in these: A001, A201, A501, A140.
    const got = tagSymbols({
      segments: polygon(100, 100, R, 32),
      text: [label("A501", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].rejected).toBe("sheet-reference");
  });

  it("rejects a symbol split by a line through its middle", () => {
    // The detail number sits above the divider and the sheet below it.
    const segments = [
      ...polygon(100, 100, R, 32),
      { x1: 100 - R, y1: 100, x2: 100 + R, y2: 100 },
    ];
    const got = tagSymbols({
      segments,
      text: [label("4", 100, 94), label("A140", 100, 106)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].split).toBe(true);
    expect(got[0].rejected).not.toBeNull();
  });

  it("does NOT call a wall passing behind the tag a split", () => {
    // THE CASE A MEASUREMENT FOUND. The first version asked only that a line
    // span the symbol's middle, which on a floor plan is any partition running
    // behind it — and genuine `B` tags on Camp Bow Wow A101 were rejected as
    // callouts. A callout's divider begins and ends at the symbol's own edge.
    const segments = [
      ...polygon(100, 100, R, 32),
      { x1: -500, y1: 100, x2: 900, y2: 100 },
    ];
    const got = tagSymbols({
      segments,
      text: [label("B", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].split).toBe(false);
    expect(got[0].rejected).toBeNull();
  });

  it("rejects a symbol whose contents are a sentence", () => {
    // A101 has circles around "BREAK/PREP ROOM 104" and "ELECT. EQUIPMENT".
    const got = tagSymbols({
      segments: polygon(100, 100, 0.35 * PER_INCH, 32),
      text: [label("ELECT. EQUIPMENT", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].rejected).toBe("code-too-long");
  });

  it("reports an empty symbol rather than dropping it", () => {
    // A sheet that is all empty symbols and a sheet where the text lookup
    // broke look identical if these are discarded.
    const got = tagSymbols({
      segments: polygon(100, 100, R, 6),
      text: [],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].rejected).toBe("no-text");
  });

  it("refuses a nonsense scale rather than finding symbols at any size", () => {
    expect(
      tagSymbols({
        segments: polygon(100, 100, R, 6),
        text: [label("A1", 100, 100)],
        unitsPerPaperInch: 0,
      }),
    ).toHaveLength(0);
  });
});

describe("learning a set's own tag shape from its legend", () => {
  const hex = (n: number, text: string) =>
    tagSymbols({
      segments: polygon(100 + n * 200, 100, R, 6),
      text: [label(text, 100 + n * 200, 100)],
      unitsPerPaperInch: PER_INCH,
    });

  it("names the shape the legend mostly uses", () => {
    const symbols = [...hex(0, "A"), ...hex(1, "B"), ...hex(2, "C")];
    expect(shapeFromLegend(symbols)).toBe("hexagon");
  });

  it("says nothing when no shape dominates", () => {
    // A legend using three shapes equally has not told us anything, and
    // picking the commonest by a nose hard-codes a shape by accident.
    const mixed = [
      ...tagSymbols({
        segments: polygon(100, 100, R, 6),
        text: [label("A", 100, 100)],
        unitsPerPaperInch: PER_INCH,
      }),
      ...tagSymbols({
        segments: polygon(400, 100, R, 4),
        text: [label("B", 400, 100)],
        unitsPerPaperInch: PER_INCH,
      }),
    ];
    expect(shapeFromLegend(mixed)).toBeNull();
  });

  it("says nothing from a single symbol", () => {
    expect(shapeFromLegend(hex(0, "A"))).toBeNull();
  });

  it("ignores the callouts on the legend sheet when learning", () => {
    // A legend page carries detail callouts too, and they are circles on every
    // set measured. Counting them would teach the wrong shape.
    const callouts = tagSymbols({
      segments: [...polygon(900, 100, R, 32), { x1: 900 - R, y1: 100, x2: 900 + R, y2: 100 }],
      text: [label("4", 900, 94), label("A140", 900, 106)],
      unitsPerPaperInch: PER_INCH,
    });
    const symbols = [...hex(0, "A"), ...hex(1, "B"), ...callouts, ...callouts];
    expect(shapeFromLegend(symbols)).toBe("hexagon");
  });
});
