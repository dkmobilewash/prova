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

/**
 * Text centred at a point, sized roughly as drawing lettering.
 *
 * `y` is the BASELINE, as `planPdf` reports it — so a string centred on `cy`
 * has its baseline half a height below it. A fixture that put the top edge
 * at `y` passed every test here while the real sheets read the halves of a
 * split tag the wrong way round.
 */
function label(str: string, cx: number, cy: number): TextForSymbol {
  const width = str.length * 4;
  return { str, x: cx - width / 2, y: cy + 3, width, height: 6 };
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
    // `polygon` starts a vertex on the x axis, so four sides is a diamond —
    // corners on the axes, edges on the diagonals — which is what Camp Bow
    // Wow draws its wall tags as.
    const got = tagSymbols({
      segments: polygon(100, 100, R, 4),
      text: [label("P2", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].shape).toBe("diamond");
    expect(got[0].corners).toBe(4);
  });

  it("closes a loop whose strokes do not run head to tail", () => {
    // Gen BBQ A101, read 2026-10-20: each wall tag's diamond is four strokes
    // emitted as two leaving the left vertex and two arriving at the right —
    //   (775,846)->(783,837)  (775,846)->(783,854)
    //   (783,837)->(791,846)  (783,854)->(791,846)
    // — so no walk from an end to a start ever closes. 0 of 322 symbols on
    // the sheet carried a legend code, on a plan that tags every wall.
    const flipped = polygon(100, 100, R, 4).map((s, i) =>
      i % 2 === 0 ? s : { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 },
    );
    const got = tagSymbols({
      segments: flipped,
      text: [label("C3", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].shape).toBe("diamond");
    expect(got[0].text).toBe("C3");
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

  it("rejects a symbol holding a dimension, even when a legend code shares the box", () => {
    // Murray Towers A2.01: `3'-0"` in a rectangle resting on a `2` diamond
    // read as one split symbol, and the chain tagged a dimension as type 2.
    const got = tagSymbols({
      segments: polygon(100, 100, R, 4),
      text: [label("3'-0\"", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].rejected).toBe("dimension");
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

/** An axis-aligned square: edges on the axes, corners on the diagonals. */
function axisSquare(cx: number, cy: number, half: number): StrokeSegment[] {
  const c = [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
  return c.map((a, i) => ({ x1: a.x, y1: a.y, x2: c[(i + 1) % 4].x, y2: c[(i + 1) % 4].y }));
}

describe("a diamond is not a square, and a split box is not always a callout", () => {
  /**
   * ── MEASURED ON CAMP BOW WOW A101 ──
   *
   * Wall tags are diamonds, door marks are axis-aligned pills, room numbers
   * sit in axis-aligned boxes. All three have four corners. Calling them all
   * "square" meant the legend's shape could not separate a wall tag from a
   * door mark, which is the one thing the shape is for.
   */
  it("calls an axis-aligned four-sided box a square and a cornered one a diamond", () => {
    const square = tagSymbols({
      segments: axisSquare(100, 100, R * 0.7),
      text: [label("102", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    const diamond = tagSymbols({
      segments: polygon(300, 100, R, 4),
      text: [label("A", 300, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(square[0].shape).toBe("square");
    expect(diamond[0].shape).toBe("diamond");
  });

  /**
   * ── MEASURED ON ELEVEN03 A4.B.1 ──
   *
   * Every wall tag on that sheet is a box split by a line: the type code above
   * (`MC`) and the fire rating below (`1 HR`). The first version rejected all
   * nineteen as detail callouts, because a callout is split too. The halves
   * are what tell them apart — a callout's lower half names a SHEET.
   */
  it("keeps a split box whose halves are a code and a rating, with the halves apart", () => {
    const segments = [
      ...axisSquare(100, 100, R * 0.8),
      { x1: 100 - R * 0.8, y1: 100, x2: 100 + R * 0.8, y2: 100 },
    ];
    const got = tagSymbols({
      segments,
      text: [label("MC", 100, 94), label("1 HR", 100, 106)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].split).toBe(true);
    expect(got[0].rejected).toBeNull();
    expect(got[0].parts).toEqual(["MC", "1 HR"]);
  });

  it("still rejects a split box whose lower half is a sheet reference", () => {
    const segments = [
      ...axisSquare(100, 100, R * 0.8),
      { x1: 100 - R * 0.8, y1: 100, x2: 100 + R * 0.8, y2: 100 },
    ];
    const got = tagSymbols({
      segments,
      text: [label("3", 100, 94), label("A501", 100, 106)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].rejected).toBe("sheet-reference");
  });

  it("rejects a symbol only when EVERY half is too long to be a code", () => {
    const segments = [
      ...axisSquare(100, 100, R * 0.8),
      { x1: 100 - R * 0.8, y1: 100, x2: 100 + R * 0.8, y2: 100 },
    ];
    const tag = tagSymbols({
      segments,
      text: [label("WT-12", 100, 94), label("2 HR RATED", 100, 106)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(tag[0].rejected).toBeNull();
    const note = tagSymbols({
      segments,
      text: [label("SEE NOTE 4", 100, 94), label("ON SHEET", 100, 106)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(note[0].rejected).toBe("code-too-long");
  });
});

describe("one symbol drawn twice, and the leader off its edge", () => {
  /**
   * Camp Bow Wow draws each wall tag as a diamond inside a diamond. Both loops
   * close around one letter, and before this the inner one was reported as a
   * second, nine-cornered "other" symbol at the same place — which then
   * counted as an odd-shaped tag the legend did not draw.
   */
  it("keeps ONE of concentric symbols holding the same code — the drawn shape, not the mask", () => {
    // On the plan: a diamond, a diamond inside it, and the masking box AROUND
    // both. The box is the largest and is not the symbol.
    const plan = tagSymbols({
      segments: [...axisSquare(100, 100, R), ...polygon(100, 100, R, 4), ...polygon(100, 100, R * 0.8, 4)],
      text: [label("A", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].shape).toBe("diamond");
    expect(plan[0].radius).toBeCloseTo(R * 0.8, 5);
    // On the legend: a bigger diamond with the letter's masking box INSIDE
    // it. The box is the smallest and is still not the symbol.
    const legend = tagSymbols({
      segments: [...polygon(300, 100, R * 1.5, 4), ...axisSquare(300, 100, R * 0.6)],
      text: [label("A", 300, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(legend).toHaveLength(1);
    expect(legend[0].shape).toBe("diamond");
  });

  it("reads a diamond drawn with chamfered corners as a diamond, not an eight-cornered other", () => {
    // Each vertex arrives as two points 0.3pt apart, which is how the real
    // export draws it.
    const pts = [0, 1, 2, 3].map((i) => ({ x: 100 + R * Math.cos((i / 4) * Math.PI * 2), y: 100 + R * Math.sin((i / 4) * Math.PI * 2) }));
    const segments: StrokeSegment[] = [];
    for (let i = 0; i < 4; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const ux = (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y);
      const uy = (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y);
      segments.push({ x1: a.x + ux * 0.3, y1: a.y + uy * 0.3, x2: b.x - ux * 0.3, y2: b.y - uy * 0.3 });
      const c = pts[(i + 2) % 4];
      const vx = (c.x - b.x) / Math.hypot(c.x - b.x, c.y - b.y);
      const vy = (c.y - b.y) / Math.hypot(c.x - b.x, c.y - b.y);
      segments.push({ x1: b.x - ux * 0.3, y1: b.y - uy * 0.3, x2: b.x + vx * 0.3, y2: b.y + vy * 0.3 });
    }
    const got = tagSymbols({ segments, text: [label("A", 100, 100)], unitsPerPaperInch: PER_INCH });
    expect(got).toHaveLength(1);
    expect(got[0].corners).toBe(4);
    expect(got[0].shape).toBe("diamond");
  });

  it("does not merge two symbols that merely sit near each other", () => {
    const got = tagSymbols({
      segments: [...polygon(100, 100, R, 4), ...polygon(100 + R * 2.5, 100, R * 0.7, 4)],
      text: [label("A", 100, 100), label("A", 100 + R * 2.5, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(2);
  });

  it("follows a straight leader from the symbol's edge to its far end", () => {
    // The stem leaves the diamond's bottom corner and runs 3 radii down.
    const got = tagSymbols({
      segments: [...polygon(100, 100, R, 4), { x1: 100, y1: 100 + R, x2: 100, y2: 100 + R * 4 }],
      text: [label("A", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].leader).not.toBeNull();
    expect(got[0].leader?.x).toBeCloseTo(100, 5);
    expect(got[0].leader?.y).toBeCloseTo(100 + R * 4, 5);
  });

  it("follows a bent leader to the end of its last stroke", () => {
    const got = tagSymbols({
      segments: [
        ...polygon(100, 100, R, 4),
        { x1: 100, y1: 100 + R, x2: 100, y2: 100 + R * 3 },
        { x1: 100, y1: 100 + R * 3, x2: 100 + R * 3, y2: 100 + R * 3 },
      ],
      text: [label("A", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got[0].leader?.x).toBeCloseTo(100 + R * 3, 5);
    expect(got[0].leader?.y).toBeCloseTo(100 + R * 3, 5);
  });

  it("does not take a wall passing behind the tag, or a grid line, for a leader", () => {
    const behind = tagSymbols({
      segments: [...polygon(100, 100, R, 4), { x1: -900, y1: 100, x2: 900, y2: 100 }],
      text: [label("A", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(behind[0].leader).toBeNull();
    // A grid line ends at the bubble and runs the height of the building.
    const grid = tagSymbols({
      segments: [...polygon(100, 100, R, 32), { x1: 100, y1: 100 + R, x2: 100, y2: 100 + R * 60 }],
      text: [label("3", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(grid[0].leader).toBeNull();
  });

  it("learns the legend's shape from the symbols that hold its codes, not from its note numbers", () => {
    // A130 numbers its general notes in small boxes; five diamonds carry the
    // types. Without the codes the boxes outvote the diamonds.
    const symbols = [
      ...["A", "B", "C", "D", "E"].flatMap((code, i) =>
        tagSymbols({
          segments: polygon(100 + i * 100, 100, R, 4),
          text: [label(code, 100 + i * 100, 100)],
          unitsPerPaperInch: PER_INCH,
        }),
      ),
      ...["10.", "11.", "12.", "13.", "14.", "15.", "16.", "17."].flatMap((n, i) =>
        tagSymbols({
          segments: axisSquare(100 + i * 60, 400, R * 0.5),
          text: [label(n, 100 + i * 60, 400)],
          unitsPerPaperInch: PER_INCH,
        }),
      ),
    ];
    expect(shapeFromLegend(symbols)).toBe("square");
    expect(shapeFromLegend(symbols, { codes: ["A", "B", "C", "D", "E"] })).toBe("diamond");
  });
});

describe("the shape outranks the size when one symbol is drawn several times", () => {
  it("keeps the named shape over a smaller unnamed loop at the same place", () => {
    // A diamond with a stray three-sided loop inside it — a triangle is
    // "other" and must not become the symbol by being the smallest.
    const got = tagSymbols({
      segments: [...polygon(100, 100, R, 4), ...polygon(100, 100, R * 0.6, 3)],
      text: [label("A", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].shape).toBe("diamond");
  });
});


describe("a loop the walk goes round twice", () => {
  it("is read per lap: two coincident diamonds are one four-cornered diamond", () => {
    // The second diamond is a hair larger and shares its vertex keys with the
    // first, which is what makes the walk step from one onto the other.
    const inner = polygon(100, 100, R, 4);
    const outer = polygon(100, 100, R + 0.05, 4);
    const got = tagSymbols({
      segments: [...inner, ...outer],
      text: [label("A", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].corners).toBe(4);
    expect(got[0].shape).toBe("diamond");
  });
});

describe("a walk that starts on the leader", () => {
  it("still finds the diamond the leader ends on, when the leader is drawn first", () => {
    // Camp Bow Wow's export emits the stem before the diamond. The stem ends
    // exactly on the diamond's lower vertex, so a walk beginning on the stem
    // goes round the diamond and comes back to that vertex with nowhere to
    // go — an open path whose cycle is the tag.
    const diamond = polygon(100, 100, R, 4);
    // polygon(…, 4) puts a vertex at angle 90°, i.e. (100, 100 + R).
    const stem = { x1: 100, y1: 100 + R * 4, x2: 100, y2: 100 + R };
    const got = tagSymbols({
      segments: [stem, ...diamond],
      text: [label("A", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].shape).toBe("diamond");
    expect(got[0].leader?.y).toBeCloseTo(100 + R * 4, 5);
  });
});

describe("when the only named shape in a family is a square", () => {
  it("keeps the square over a smaller unnamed loop at the same place", () => {
    const got = tagSymbols({
      segments: [...axisSquare(100, 100, R), ...polygon(100, 100, R * 0.6, 3)],
      text: [label("102", 100, 100)],
      unitsPerPaperInch: PER_INCH,
    });
    expect(got).toHaveLength(1);
    expect(got[0].shape).toBe("square");
  });
});
