import { describe, expect, it } from "vitest";
import { strokesFromBitmap, type Bitmap } from "./rasterStrokes";

/**
 * ── THE GEOMETRY, ON PIXELS WHOSE ANSWER IS KNOWN BY CONSTRUCTION ──
 *
 * `raster.eval.ts` grades this against the vector originals, which is the real
 * measurement and needs the fixture PDFs. These cases are the other half: a
 * bitmap drawn by hand, where the right answer is arithmetic rather than a
 * comparison, so a wrong COORDINATE is caught here instead of showing up as a
 * slightly worse score on twenty sheets.
 *
 * Everything is at 72 dpi unless it is about dpi, so one pixel is one point
 * and the expected numbers can be read off the drawing.
 */

const DPI = 72;

/** A white page with a drawing on it. `ink` paints one pixel black. */
function page(width: number, height: number, ink: (set: (x: number, y: number) => void) => void): Bitmap {
  const grey = new Uint8Array(width * height).fill(255);
  ink((x, y) => {
    if (x >= 0 && x < width && y >= 0 && y < height) grey[y * width + x] = 0;
  });
  return { grey, width, height };
}

const hLine = (x0: number, x1: number, y: number, thick = 1) =>
  (set: (x: number, y: number) => void) => {
    for (let t = 0; t < thick; t += 1) for (let x = x0; x <= x1; x += 1) set(x, y + t);
  };

describe("finding a line", () => {
  it("GIVES A THICK LINE ITS TWO FACES, which is the decision the score turned on", () => {
    // ── THE CENTRELINE VERSION SCORED 5% AND LOOKED RIGHT ──
    //
    // Reporting one segment down the middle of each band is the obvious
    // answer and it is the wrong one. A vector drawing gives a wall as TWO
    // lines, one per face, and `findWallsOnSheet` builds a wall by PAIRING
    // parallel faces — so a lone centreline pairs with nothing and becomes no
    // wall. Measured on the scanned office suite: 31 feet of wall against the
    // drawing's 555 with centrelines, 505 with faces.
    const got = strokesFromBitmap(page(200, 60, hLine(20, 119, 30, 4)), { dpi: DPI });
    const h = got.segments.filter((s) => s.y1 === s.y2).sort((a, b) => a.y1 - b.y1);
    expect(h).toHaveLength(2);
    for (const face of h) {
      // 20..119 inclusive is 100 pixels, so 100 points at 72 dpi.
      expect(face.x2 - face.x1).toBeCloseTo(100, 1);
      // Both faces carry the band's thickness, as a vector pen width does.
      expect(face.width).toBeCloseTo(4, 1);
    }
    // Four rows of ink centred on 31.5, so the faces sit at 30 and 33.
    expect(h[0].y1).toBeCloseTo(30, 1);
    expect(h[1].y1).toBeCloseTo(33, 1);
    expect(h[1].y1 - h[0].y1, "the faces should be a wall's thickness apart").toBeCloseTo(3, 1);
  });

  it("gives a vertical line the same treatment", () => {
    const got = strokesFromBitmap(
      page(60, 200, (set) => {
        for (let y = 10; y <= 109; y += 1) for (let t = 0; t < 3; t += 1) set(20 + t, y);
      }),
      { dpi: DPI },
    );
    const v = got.segments.filter((s) => s.x1 === s.x2).sort((a, b) => a.x1 - b.x1);
    expect(v).toHaveLength(2);
    for (const face of v) {
      expect(face.y2 - face.y1).toBeCloseTo(100, 1);
      expect(face.width).toBeCloseTo(3, 1);
    }
    expect(v[0].x1).toBeCloseTo(20, 1);
    expect(v[1].x1).toBeCloseTo(22, 1);
  });

  it("leaves a HAIRLINE as one line, so the pairer is not handed an invented partner", () => {
    // A dimension line, a leader and a grid line have one side, not two.
    // Splitting them would manufacture exactly the parallel pair that
    // `findWallsOnSheet` is looking for, and invent walls out of annotation.
    const got = strokesFromBitmap(page(200, 60, hLine(20, 119, 30, 1)), { dpi: DPI });
    expect(got.segments.filter((s) => s.y1 === s.y2)).toHaveLength(1);
  });

  it("READS THE SAME DRAWING THE SAME WAY AT ANY RESOLUTION", () => {
    // ── WHY THIS IS THE LOAD-BEARING CASE ──
    //
    // Every threshold in the module is stated in POINTS and converted by dpi.
    // Get one of those conversions wrong and the detector still works
    // perfectly at whatever resolution it was tuned on, and quietly finds
    // different lines at any other — the kind of defect that surfaces as an
    // unexplained score change months later.
    const at = (dpi: number) => {
      const k = dpi / 72;
      const w = Math.round(200 * k);
      const h = Math.round(60 * k);
      return strokesFromBitmap(
        page(w, h, hLine(Math.round(20 * k), Math.round(120 * k) - 1, Math.round(30 * k), Math.round(4 * k))),
        { dpi },
      ).segments.filter((s) => s.y1 === s.y2);
    };
    for (const dpi of [72, 150, 300]) {
      const found = at(dpi);
      expect(found, `at ${dpi} dpi`).toHaveLength(2);
      for (const face of found) {
        expect(face.x2 - face.x1, `length at ${dpi} dpi`).toBeCloseTo(100, 0);
        expect(face.width, `width at ${dpi} dpi`).toBeCloseTo(4, 0);
      }
    }
  });
});

describe("what it refuses", () => {
  it("ignores a run too short to be a line", () => {
    const got = strokesFromBitmap(page(200, 60, hLine(20, 24, 30)), { dpi: DPI });
    expect(got.segments).toEqual([]);
  });

  it("IGNORES LETTERING, and this case is why the floor is 14pt and not 6", () => {
    // THE CASE THAT CORRECTED THE MODULE. The floor was 6pt, on the reasoning
    // that a run is CONSECUTIVE ink and lettering is strokes with paper
    // between them. True across a word, false down a letter: these forty 9pt
    // letters have solid 9pt STEMS, and the detector returned eighty vertical
    // segments. The fix was the threshold, not this fixture.
    const got = strokesFromBitmap(
      page(400, 60, (set) => {
        for (let i = 0; i < 40; i += 1) {
          const x = 20 + i * 9;
          for (let y = 26; y <= 34; y += 1) {
            set(x, y);
            set(x + 4, y);
          }
          for (let d = 0; d <= 4; d += 1) set(x + d, 30);
        }
      }),
      { dpi: DPI },
    );
    expect(got.segments, "a row of H-shaped letters was read as lines").toEqual([]);
  });

  it("DOES NOT clear display type, which is recorded rather than pretended away", () => {
    // A title block's sheet number is drawn at twenty-odd points, so its stems
    // are genuine runs and this module finds them. The building filter
    // discards title-block ink downstream, and a floor high enough to exclude
    // display type would start excluding real walls — so the honest thing is
    // to pin the limitation rather than let somebody rediscover it.
    const got = strokesFromBitmap(
      page(200, 100, (set) => {
        for (let y = 20; y <= 49; y += 1) for (let t = 0; t < 3; t += 1) set(40 + t, y);
      }),
      { dpi: DPI },
    );
    expect(got.segments.length, "30pt display type is expected to survive the run floor").toBeGreaterThan(0);
  });
});

describe("the cases four surviving mutations asked for", () => {
  it("REFUSES A SHORT LINE AT EVERY RESOLUTION, which is what makes the floor a point and not a pixel", () => {
    // The resolution case above uses a line far above the floor, so dropping
    // the dpi conversion entirely left it green: at 150 dpi a 100-point line
    // clears a 14-PIXEL floor just as easily as a 14-point one. The
    // conversion only bites near the threshold, so the test has to be near it.
    //
    // Ten points is below the 14-point floor and must be refused everywhere.
    // Without the conversion it is 21 pixels at 150 dpi and sails through.
    for (const dpi of [72, 150, 300]) {
      const k = dpi / 72;
      const w = Math.round(200 * k);
      const got = strokesFromBitmap(
        page(w, Math.round(60 * k), hLine(Math.round(20 * k), Math.round(30 * k) - 1, Math.round(30 * k), Math.round(3 * k))),
        { dpi },
      );
      expect(got.segments, `a 10pt line was accepted at ${dpi} dpi`).toEqual([]);
    }
  });

  it("CROSSES A SPECK WITHOUT BREAKING THE LINE", () => {
    // What a scan actually does to a wall. Without gap bridging each speck
    // splits one run into two, and a wall crossed by a few of them becomes
    // fragments — measured on the one speckled fixture, 953 segments against
    // 336 real lines.
    const got = strokesFromBitmap(
      page(300, 60, (set) => {
        for (let x = 20; x <= 219; x += 1) {
          if ((x - 20) % 40 === 39) continue; // one dropped pixel, repeatedly
          for (let t = 0; t < 4; t += 1) set(x, 30 + t);
        }
      }),
      { dpi: DPI },
    );
    const h = got.segments.filter((s) => s.y1 === s.y2);
    expect(h, "the speckled wall came back as fragments").toHaveLength(2);
    expect(h[0].x2 - h[0].x1, "the bridged line should span the whole wall").toBeGreaterThan(190);
  });

  it("KEEPS THE FULL EXTENT OF A BAND WITH RAGGED ENDS", () => {
    // A scanned line does not begin and end on the same pixel in every row.
    // The band has to grow to the UNION of its runs, or the last row read
    // decides where the wall ends and the wall gets shorter than it is.
    const got = strokesFromBitmap(
      page(300, 60, (set) => {
        const starts = [20, 24, 22, 26];
        const ends = [219, 210, 215, 205];
        for (let t = 0; t < 4; t += 1) for (let x = starts[t]; x <= ends[t]; x += 1) set(x, 30 + t);
      }),
      { dpi: DPI },
    );
    const h = got.segments.filter((s) => s.y1 === s.y2);
    expect(h.length).toBeGreaterThan(0);
    const longest = Math.max(...h.map((f) => f.x2 - f.x1));
    expect(longest, "the band should reach the widest row, 20..219").toBeCloseTo(200, 0);
  });

  it("REPORTS A PART-DIAGONAL PAGE AS PART UNSEEN — a figure, not a zero", () => {
    // The mask version of this was asserted only with `toBeLessThan(0.1)`,
    // which a saturated ZERO satisfies perfectly — so the broken
    // area-summing version stayed green. A figure has to be pinned from BOTH
    // sides to be a measurement.
    //
    // Half the ink here is axis-aligned and half is a diagonal this module
    // cannot see, so the answer must land in the middle rather than at either
    // end.
    const got = strokesFromBitmap(
      page(400, 400, (set) => {
        for (let x = 20; x <= 319; x += 1) for (let t = 0; t < 4; t += 1) set(x, 100 + t);
        for (let i = 0; i < 300; i += 1) for (let t = 0; t < 4; t += 1) set(20 + i, 200 + i + t);
      }),
      { dpi: DPI },
    );
    expect(got.segments.length, "the axis-aligned half should still be found").toBeGreaterThan(0);
    expect(got.diagonalInk, "a half-diagonal page reported too little unseen ink").toBeGreaterThan(0.25);
    expect(got.diagonalInk, "a half-diagonal page reported too much unseen ink").toBeLessThan(0.75);
  });
});

describe("what the unseen-ink figure is worth", () => {
  it("IS COUNTED ON A MASK, not by summing band areas", () => {
    // The first version multiplied each band's length by its thickness and
    // summed. On a floor plan every crossing is claimed by both the
    // horizontal and the vertical pass, so the sum ran past the ink on the
    // page and the figure clamped to zero — it read 0% unseen on all three
    // scanned fixtures and could never have reported anything else.
    //
    // A cross: two bands, one shared centre. Summing areas double-counts it.
    const got = strokesFromBitmap(
      page(200, 200, (set) => {
        for (let x = 20; x <= 169; x += 1) for (let t = 0; t < 4; t += 1) set(x, 100 + t);
        for (let y = 20; y <= 169; y += 1) for (let t = 0; t < 4; t += 1) set(100 + t, y);
      }),
      { dpi: DPI },
    );
    expect(got.segments.length).toBeGreaterThan(0);
    // Everything here is axis-aligned, so almost nothing should be unseen —
    // and crucially the figure must be a real measurement rather than a
    // saturated zero, so it is asserted as a NUMBER in range.
    expect(got.diagonalInk).toBeLessThan(0.1);
    expect(got.diagonalInk).toBeGreaterThanOrEqual(0);
  });

  it("ignores a filled region, which is poché or a logo rather than a line", () => {
    const got = strokesFromBitmap(page(200, 200, hLine(20, 119, 30, 40)), { dpi: DPI });
    expect(got.segments.filter((s) => s.y1 === s.y2)).toEqual([]);
  });
});

describe("the honesty fields", () => {
  it("reports a blank page as blank rather than as a page with no walls", () => {
    // A failed decode and an empty sheet produce the same empty segment list.
    // This is the only thing that tells them apart.
    const got = strokesFromBitmap(page(100, 100, () => {}), { dpi: DPI });
    expect(got.segments).toEqual([]);
    expect(got.darkFraction).toBe(0);
  });

  it("REPORTS INK IT CANNOT SEE, so a diagonal plan is not read as an empty one", () => {
    // The module's own bound, measured rather than described. A 45-degree line
    // is invisible to an axis-aligned scan, and the difference that matters is
    // between "there are no walls here" and "the walls are ones I cannot see".
    const diagonal = strokesFromBitmap(
      page(200, 200, (set) => {
        for (let i = 0; i < 150; i += 1) for (let t = 0; t < 3; t += 1) set(20 + i, 20 + i + t);
      }),
      { dpi: DPI },
    );
    expect(diagonal.segments).toEqual([]);
    expect(diagonal.darkFraction).toBeGreaterThan(0);
    expect(diagonal.diagonalInk, "a wholly diagonal drawing should report nearly all ink unclaimed").toBeGreaterThan(0.9);

    const square = strokesFromBitmap(page(200, 200, hLine(20, 119, 30, 4)), { dpi: DPI });
    expect(square.diagonalInk, "an axis-aligned line should be almost entirely claimed").toBeLessThan(0.1);
  });
});
