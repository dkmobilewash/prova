import { describe, expect, it } from "vitest";
import {
  UNDECIDED_TOKENS,
  droppedLayersSentence,
  layerTokens,
  layerVerdict,
  withoutNonWallLayers,
} from "./layerNames";
import type { StrokeSegment } from "./wallVectors";

const seg = (layer?: string): StrokeSegment => ({ x1: 0, y1: 0, x2: 10, y2: 0, layer });

describe("reading a CAD layer name", () => {
  it("names the things that were actually measured as walls and are not", () => {
    // Every one of these is a reported defect rather than a category somebody
    // imagined. The logo and the cars came off a dealership bid set with
    // pictures; the rest come off the bench's own zero-wall sheets.
    expect(layerVerdict("G-ANNO-TTLB")).toBe("not-wall"); // the architect's logo
    expect(layerVerdict("A-FURN")).toBe("not-wall"); // the cars
    expect(layerVerdict("S-GRID")).toBe("not-wall"); // the column grid
    expect(layerVerdict("M-DUCT")).toBe("not-wall"); // 2,200 phantom ft on M-101
    expect(layerVerdict("A-CLNG-GRID")).toBe("not-wall"); // 2,300 phantom ft on A-111
    expect(layerVerdict("A-ANNO-DIMS")).toBe("not-wall");
    expect(layerVerdict("E-LITE")).toBe("not-wall");
    expect(layerVerdict("P-FIXT")).toBe("not-wall");
  });

  it("calls a wall a wall", () => {
    expect(layerVerdict("A-WALL")).toBe("wall");
    expect(layerVerdict("A-WALL-FULL-NEWW")).toBe("wall");
    expect(layerVerdict("ARCH-PARTITION")).toBe("wall");
  });

  it("reads existing and demolition as OUT OF SCOPE even when the name says WALL", () => {
    // THE ORDER OF THE CHECKS IS THE POINT. `A-WALL-DEMO` contains `WALL`, and
    // reading it as a wall would price a demolition as new construction — the
    // most expensive single mistake available on this screen, and the thing
    // the dealership report asked for in as many words.
    expect(layerVerdict("A-WALL-DEMO")).toBe("out-of-scope");
    expect(layerVerdict("A-WALL-EXST")).toBe("out-of-scope");
    expect(layerVerdict("A-WALL-EXISTING")).toBe("out-of-scope");
    expect(layerVerdict("A-AREA-NIC")).toBe("out-of-scope");
    // AND THE CASE THAT PINS THE ORDER rather than the outcome. The three
    // assertions above pass whichever way round the two checks run, because
    // none of those names carries a `not-wall` token as well — so a mutation
    // swapping them stayed GREEN. This name carries both, and it is the common
    // one: an annotation layer for the demolition notes.
    expect(layerVerdict("A-ANNO-DEMO")).toBe("out-of-scope");
    expect(layerVerdict("A-FURN-EXST")).toBe("out-of-scope");
  });

  describe("the NCS status letter, which is how a real set actually says it", () => {
    // Measured on West Herr's A-101 — 47 layers, every stroke on one, and the
    // out-of-scope bucket came back ZERO while the drawing carried `A-Wall-E`
    // with 281 path operators on it. The spelled-out words above are a house
    // style; a single trailing letter is the published standard.
    it("reads a trailing E, D or X as not-new-work", () => {
      expect(layerVerdict("A-WALL-E")).toBe("out-of-scope");
      expect(layerVerdict("A-WALL-D")).toBe("out-of-scope");
      expect(layerVerdict("A-WALL-X")).toBe("out-of-scope");
      // Spelled as the xref-prefixed names actually arrive on the real file.
      expect(layerVerdict("07231.14 - Base|A-Wall-E")).toBe("out-of-scope");
      expect(layerVerdict("07231.14 - Base|A-Wall-Blow-E")).toBe("out-of-scope");
    });

    it("does NOT read a LEADING E as existing — that is the electrical discipline", () => {
      // The mistake this rule is shaped to avoid. `E-Lite` is lighting, not
      // something existing, and reading it as a scope judgement would be wrong
      // about what the layer even is.
      expect(layerVerdict("E-LITE")).toBe("not-wall");
      expect(layerVerdict("E-POWR")).toBe("not-wall");
      // A layer called just `E` has no last field to judge.
      expect(layerVerdict("E")).toBe("unknown");
    });

    it("leaves N, R, T and F alone, because each of those is work", () => {
      // `N` is new and is the whole point of the bid. `R` relocated and `T`
      // temporary are things somebody is paid to do. `F` future is genuinely
      // out of contract and is STILL left in scope, because a lone F is also
      // how more than one office abbreviates FURRING — and dropping furring
      // drops a wall.
      expect(layerVerdict("A-WALL-N")).toBe("wall");
      expect(layerVerdict("A-WALL-R")).toBe("wall");
      expect(layerVerdict("A-WALL-T")).toBe("wall");
      expect(layerVerdict("A-WALL-F")).toBe("wall");
    });

    it("does not fire on a multi-letter last field", () => {
      // `A-WALL-EXT` is an EXTERIOR wall, not an existing one. Only a single
      // character is a status code, and the difference is a whole envelope.
      expect(layerVerdict("A-WALL-EXT")).toBe("wall");
      expect(layerVerdict("A-WALL-FULL")).toBe("wall");
    });
  });

  it("says UNKNOWN for anything it cannot place, which is what keeps it safe", () => {
    // These are the real names that defeat any vocabulary: AutoCAD's default
    // layer, a drafter's scratch layer, a house style nobody standardised.
    // Every one of them must survive, because a missing wall reaches a bid and
    // a phantom one does not.
    expect(layerVerdict("0")).toBe("unknown");
    expect(layerVerdict("Layer1")).toBe("unknown");
    expect(layerVerdict("MYSTERY")).toBe("unknown");
    expect(layerVerdict("")).toBe("unknown");
    expect(layerVerdict(undefined)).toBe("unknown");
  });

  it("leaves the arguable tokens undecided ON PURPOSE, and says which", () => {
    // The difference between "we measured and decided not to" and "nobody
    // thought of it". Each of these is a judgement somebody will be tempted to
    // make; `layerNames.ts` carries the reason for each.
    for (const token of UNDECIDED_TOKENS) {
      expect(layerVerdict(`A-${token}`), `A-${token} should still be undecided`).toBe("unknown");
    }
    // The one that would cost the most: in a fill-only Revit export the hatch
    // can be the ONLY geometry a wall has.
    expect(layerVerdict("A-WALL-PATT")).toBe("wall");
  });

  it("survives the ways real exports spell a name", () => {
    expect(layerTokens("A-WALL-FULL")).toEqual(["A", "WALL", "FULL"]);
    expect(layerTokens("A_WALL_FULL")).toEqual(["A", "WALL", "FULL"]);
    expect(layerTokens("A-WALL [Walls]")).toEqual(["A", "WALL", "WALLS"]);
    // Trailing digits stripped, so GRID01 is not a stranger to GRID.
    expect(layerVerdict("S-GRID01")).toBe("not-wall");
    expect(layerVerdict("a-furn")).toBe("not-wall");
  });
});

describe("dropping the strokes that are not walls", () => {
  it("keeps the walls and the unknowns, drops the rest", () => {
    const out = withoutNonWallLayers([
      seg("A-WALL"),
      seg("A-WALL"),
      seg("0"),
      seg(undefined),
      seg("S-GRID"),
      seg("A-FURN"),
      seg("A-WALL-DEMO"),
    ]);
    expect(out.kept).toHaveLength(4);
    expect(out.dropped.map((d) => d.layer).sort()).toEqual(["A-FURN", "A-WALL-DEMO", "S-GRID"]);
  });

  it("CHANGES NOTHING on a sheet with no layer information", () => {
    // The flattened plot, which is most of them. This is the assertion that
    // makes the whole change safe to ship before anybody has proved a real set
    // carries layers: with no layers, the output is the input.
    const plain = [seg(undefined), seg(undefined), seg(undefined)];
    const out = withoutNonWallLayers(plain);
    expect(out.kept).toEqual(plain);
    expect(out.dropped).toEqual([]);
  });

  it("REFUSES TO EMPTY A SHEET, which is the guard that matters most", () => {
    // If a name list ever matched the layer actually carrying the building —
    // a house style calling its partitions A-SITE-WALL, a mis-tagged export —
    // this would delete the whole takeoff and the screen would say "no walls
    // found", a sentence it already says honestly for scans. Nobody would
    // think to look at layer names.
    const all = [seg("A-FURN"), seg("S-GRID"), seg("M-DUCT")];
    const out = withoutNonWallLayers(all);
    expect(out.kept).toEqual(all);
    expect(out.dropped).toEqual([]);
  });

  it("counts per layer, biggest first, so the sentence names the one that mattered", () => {
    const out = withoutNonWallLayers([
      seg("A-WALL"),
      ...Array.from({ length: 5 }, () => seg("A-ANNO-TEXT")),
      ...Array.from({ length: 9 }, () => seg("S-GRID")),
    ]);
    expect(out.dropped[0]).toEqual({ layer: "S-GRID", verdict: "not-wall", segments: 9 });
    expect(out.dropped[1]).toEqual({ layer: "A-ANNO-TEXT", verdict: "not-wall", segments: 5 });
  });
});

describe("what the panel says about it", () => {
  it("says nothing when nothing was dropped", () => {
    expect(droppedLayersSentence([])).toBeNull();
  });

  it("separates the arguable drop from the obvious one", () => {
    // Furniture is a filter nobody will overturn. EXISTING is a judgement about
    // SCOPE, and a sub doing a remodel may be pricing exactly those walls —
    // burying it inside the furniture count would hide the only one worth
    // questioning.
    const sentence = droppedLayersSentence([
      { layer: "S-GRID", verdict: "not-wall", segments: 120 },
      { layer: "A-WALL-DEMO", verdict: "out-of-scope", segments: 44 },
    ]);
    expect(sentence).toContain("120 lines");
    expect(sentence).toContain("S-GRID");
    expect(sentence).toContain("44 on existing or demolition layers");
    expect(sentence).toContain("A-WALL-DEMO");
  });

  it("never reports FEET, because none of this was ever measured", () => {
    // Feet would say these were found as walls and then subtracted. They never
    // reached the pairer, and a number in feet beside a wall list is a number
    // somebody will try to reconcile.
    const sentence = droppedLayersSentence([{ layer: "A-FURN", verdict: "not-wall", segments: 7 }]);
    expect(sentence).not.toMatch(/\bft\b|feet/i);
  });
});
