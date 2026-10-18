import { describe, expect, it } from "vitest";
import { wallFromPair, wallsFromStrokes, type StrokeSegment, type WallFinderOptions,
  clusterByThickness,
  CLUSTER_INCHES,
  wallsInTheBuilding,
  SAME_BUILDING_FEET,
  NOT_A_BOX,
  wallsNotLettering,
  LETTER_FEET,
  wallsNotTheSheetBorder,
  oneWallPerPlace,
  MOST_OF_THE_SHEET,
  type WallCandidate,
  oneFacePerLine,
  SAME_FACE_GAP_FEET,
} from "./wallVectors";

/**
 * Wall detection from vector strokes, with no PDF and no model involved.
 *
 * Every number here is a real one at a real scale. At 1/8" = 1'-0" one foot of
 * building is 9 page points, so `feetPerPoint` is 1/9 — and a 4-7/8" partition
 * (0.406 ft) is 3.66pt of paper. The cases are built in points because that is
 * what a PDF gives us, and asserted in feet because that is what a bid is in.
 */

/** 1/8" = 1'-0": 1 ft of building = 9 pt of paper. */
const EIGHTH: WallFinderOptions = { feetPerPoint: 1 / 9 };

/** A horizontal segment at `y`, from `x` for `len` points. */
const h = (x: number, y: number, len: number): StrokeSegment => ({ x1: x, y1: y, x2: x + len, y2: y });
/** A vertical segment at `x`, from `y` for `len` points. */
const v = (x: number, y: number, len: number): StrokeSegment => ({ x1: x, y1: y, x2: x, y2: y + len });

/** A 4-7/8" partition is 3.66pt at this scale. */
const PARTITION_PT = 0.40625 * 9;

describe("two faces a wall-thickness apart are a wall", () => {
  it("finds a 20ft partition from its two faces", () => {
    // 20 ft at 9pt/ft is 180pt.
    const wall = wallFromPair(h(100, 500, 180), h(100, 500 + PARTITION_PT, 180), EIGHTH);
    expect(wall).not.toBeNull();
    expect(wall?.lengthFeet).toBeCloseTo(20, 1);
    expect(wall?.thicknessFeet).toBeCloseTo(0.406, 2);
  });

  it("puts the centreline between the faces, where somebody tracing would", () => {
    const wall = wallFromPair(h(100, 500, 180), h(100, 500 + PARTITION_PT, 180), EIGHTH);
    // Halfway between y=500 and y=503.66.
    expect(wall?.y1).toBeCloseTo(500 + PARTITION_PT / 2, 1);
    expect(wall?.y2).toBeCloseTo(500 + PARTITION_PT / 2, 1);
  });

  it("works vertically as well as horizontally", () => {
    const wall = wallFromPair(v(100, 300, 180), v(100 + PARTITION_PT, 300, 180), EIGHTH);
    expect(wall?.lengthFeet).toBeCloseTo(20, 1);
  });

  it("finds an 18in shaft wall when ASKED for one — it is no longer the default", () => {
    // A CMU or double-stud shaft really is this thick, so this case is real and
    // stays. What changed is that it must be asked for.
    //
    // The default cap came down to 12in because against a 60-page answer key an
    // 18in cap left 188 ft of one page's exterior walls reading 12.44in — the
    // envelope found, and priced as an assembly on no drawing. The 12.4in band
    // is empty by 12in and the tighter caps the key would argue for (9.2in,
    // its widest real assembly) cost three times the recall for a quarter more
    // of the gain. Swept, not reasoned; the table is in `wallVectors.ts`.
    const asked = wallFromPair(h(100, 500, 180), h(100, 500 + 1.5 * 9, 180), {
      ...EIGHTH,
      maxThicknessFeet: 1.5,
    });
    expect(asked).not.toBeNull();
    expect(asked?.thicknessFeet).toBeCloseTo(1.5, 1);
  });

  it("REFUSES 18in by default, which is the change", () => {
    // The mutation that matters: put the cap back to 1.5 and this reds.
    expect(wallFromPair(h(100, 500, 180), h(100, 500 + 1.5 * 9, 180), EIGHTH)).toBeNull();
  });

  it("still finds a 12in wall, the widest the default admits", () => {
    const wall = wallFromPair(h(100, 500, 180), h(100, 500 + 1.0 * 9, 180), EIGHTH);
    expect(wall).not.toBeNull();
    expect(wall?.thicknessFeet).toBeCloseTo(1.0, 1);
  });
});

describe("what is NOT a wall, which is most of a drawing", () => {
  it("rejects two lines across a CORRIDOR — too far apart to be one wall", () => {
    // A 5ft corridor: 45pt. Two walls, not one.
    expect(wallFromPair(h(100, 500, 180), h(100, 545, 180), EIGHTH)).toBeNull();
  });

  it("rejects two lines a HATCH apart — too close to be a wall", () => {
    // Poché strokes sit a point or two apart: 0.17ft, under the 0.2 floor.
    expect(wallFromPair(h(100, 500, 180), h(100, 501.5, 180), EIGHTH)).toBeNull();
  });

  it("rejects lines that are not parallel", () => {
    const slanted: StrokeSegment = { x1: 100, y1: 503, x2: 280, y2: 530 };
    expect(wallFromPair(h(100, 500, 180), slanted, EIGHTH)).toBeNull();
  });

  it("REJECTS A DIMENSION STRING, which is the case the overlap test exists for", () => {
    // A dimension string's witness lines are parallel to the wall and the right
    // distance from it — but they sit END TO END with it rather than beside it,
    // offset along the wall's own direction. Only the overlap test can tell
    // those apart, and without it every dimensioned wall would yield a phantom.
    const wall = h(100, 500, 180);
    const witness = h(300, 500 + PARTITION_PT, 180);
    expect(wallFromPair(wall, witness, EIGHTH)).toBeNull();
  });

  it("rejects a pair that barely overlaps", () => {
    // 20% overlap is two walls meeting at a corner, not one wall.
    expect(wallFromPair(h(100, 500, 180), h(244, 500 + PARTITION_PT, 180), EIGHTH)).toBeNull();
  });

  it("rejects a JAMB STUB — correct thickness, too short to be a wall", () => {
    // 1 ft of two-sided line at a door jamb. Real geometry, not a wall.
    expect(wallFromPair(h(100, 500, 9), h(100, 500 + PARTITION_PT, 9), EIGHTH)).toBeNull();
  });

  it("rejects a zero-length stroke rather than dividing by it", () => {
    const point: StrokeSegment = { x1: 100, y1: 500, x2: 100, y2: 500 };
    expect(wallFromPair(point, h(100, 503, 180), EIGHTH)).toBeNull();
    expect(wallFromPair(h(100, 500, 180), point, EIGHTH)).toBeNull();
  });

  it("rejects one line on its own", () => {
    expect(wallsFromStrokes([h(100, 500, 180)], EIGHTH)).toEqual([]);
  });
});

describe("the centreline spans only the two-sided part", () => {
  it("measures the OVERLAP, not the longer face", () => {
    // One face runs 30ft, its partner 20ft. Only 20ft of this is two-sided; the
    // rest is another wall's face or a drafting artefact, and claiming it would
    // overstate the footage on every sheet.
    const wall = wallFromPair(h(100, 500, 270), h(100, 500 + PARTITION_PT, 180), EIGHTH);
    expect(wall?.lengthFeet).toBeCloseTo(20, 1);
  });
});

describe("a plan's worth of strokes", () => {
  it("finds every wall of a four-sided room and no more", () => {
    const t = PARTITION_PT;
    const walls = wallsFromStrokes(
      [
        // North and south, 30ft each.
        h(100, 500, 270),
        h(100, 500 + t, 270),
        h(100, 320, 270),
        h(100, 320 + t, 270),
        // East and west, 20ft each.
        v(100, 320, 180),
        v(100 + t, 320, 180),
        v(370 - t, 320, 180),
        v(370, 320, 180),
      ],
      EIGHTH,
    );
    expect(walls).toHaveLength(4);
    const total = walls.reduce((sum, wall) => sum + wall.lengthFeet, 0);
    // 30 + 30 + 20 + 20.
    expect(total).toBeCloseTo(100, 0);
  });

  it("USES EACH FACE ONCE, so a shared wall is not counted twice", () => {
    // Two rooms sharing a middle wall: three parallel lines. That is ONE wall
    // between them plus whatever the outer faces pair with — never two walls
    // claiming the same middle face.
    const t = PARTITION_PT;
    const walls = wallsFromStrokes([h(100, 500, 180), h(100, 500 + t, 180), h(100, 500 + 2 * t, 180)], EIGHTH);
    expect(walls).toHaveLength(1);
  });

  it("does not report a wall twice when the strokes arrive in any order", () => {
    const t = PARTITION_PT;
    const forwards = wallsFromStrokes([h(100, 500, 180), h(100, 500 + t, 180)], EIGHTH);
    const backwards = wallsFromStrokes([h(100, 500 + t, 180), h(100, 500, 180)], EIGHTH);
    expect(forwards).toHaveLength(1);
    expect(backwards).toHaveLength(1);
    expect(forwards[0].lengthFeet).toBeCloseTo(backwards[0].lengthFeet, 3);
  });

  it("finds nothing on an empty sheet", () => {
    expect(wallsFromStrokes([], EIGHTH)).toEqual([]);
  });
});

describe("the scale is the caller's, not a constant here", () => {
  it("reads the SAME geometry as a different wall at a different scale", () => {
    // 3.66pt apart is a 4-7/8" partition at 1/8" scale and a 2-1/2" furring
    // wall at 1/4" — and at 1" = 1'-0" it is barely a quarter inch and not a
    // wall at all. A thickness tolerance in POINTS would have been silently
    // wrong on every sheet but one.
    const faces: [StrokeSegment, StrokeSegment] = [h(100, 500, 180), h(100, 500 + PARTITION_PT, 180)];
    const eighth = wallFromPair(faces[0], faces[1], { feetPerPoint: 1 / 9 });
    const quarter = wallFromPair(faces[0], faces[1], { feetPerPoint: 1 / 18 });
    const detail = wallFromPair(faces[0], faces[1], { feetPerPoint: 1 / 72 });
    expect(eighth?.thicknessFeet).toBeCloseTo(0.406, 2);
    expect(quarter?.thicknessFeet).toBeCloseTo(0.203, 2);
    // Below the 0.2ft floor: at detail scale these two lines are not a wall.
    expect(detail).toBeNull();
  });
});

/**
 * GROUPING THE WALLS A SHEET GAVE UP, which is what turns a list of 542 lines
 * into a decision an estimator can actually make.
 *
 * Shaped by measurement rather than by guesswork: seven real sheets returned
 * 15-21 thickness clusters each, not the three anybody would assume, with the
 * top three holding about half the footage. Both facts are in these tests.
 */
const run = (thicknessInches: number, lengthFeet: number): WallCandidate => ({
  x1: 0,
  y1: 0,
  x2: lengthFeet,
  y2: 0,
  thicknessFeet: thicknessInches / 12,
  lengthFeet,
});

describe("grouping walls by thickness", () => {
  it("merges the SAME wall drawn with CAD's own variation", () => {
    // Measured on a real sheet: 4.92" and 4.64" came back as separate values
    // holding 739ft and 682ft. They are one 4-7/8" partition.
    const clusters = clusterByThickness([run(4.92, 10), run(4.64, 10), run(4.88, 10)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].runs).toHaveLength(3);
    expect(clusters[0].inches).toBeCloseTo(4.813, 2);
  });

  it("KEEPS TWO REAL WALL TYPES APART, which is the whole constraint", () => {
    // A 3-5/8" stud wall and a 4-7/8" partition are different material. Merging
    // them would add one type's footage to the other's — a wrong number on a
    // bid, with nothing on screen looking wrong.
    const clusters = clusterByThickness([run(3.625, 10), run(4.875, 10)]);
    expect(clusters).toHaveLength(2);
  });

  it("does not let a chain of near-misses walk a cluster across that gap", () => {
    // Each step is under the width; the span is 1.2", wider than the gap
    // between two real types. Clustering against the running MEAN would let
    // this drift into one group — it compares against the cluster's first
    // member for exactly this reason.
    const clusters = clusterByThickness([run(3.6, 1), run(4.0, 1), run(4.4, 1), run(4.8, 1)]);
    expect(clusters.length).toBeGreaterThan(1);
  });

  it("sorts by FOOTAGE, not by how many runs there are", () => {
    // The number a bid turns on is feet. Twenty short stubs are not a bigger
    // scope than four long corridor walls, and must not be offered as one.
    const clusters = clusterByThickness([
      ...Array.from({ length: 20 }, () => run(2.5, 3)), //  60 ft over 20 runs
      ...Array.from({ length: 4 }, () => run(4.875, 40)), // 160 ft over 4 runs
    ]);
    expect(clusters[0].inches).toBeCloseTo(4.875, 2);
    expect(clusters[0].feet).toBeCloseTo(160, 5);
    expect(clusters[0].runs).toHaveLength(4);
  });

  it("totals the footage of each group", () => {
    const clusters = clusterByThickness([run(6, 12.5), run(6, 7.5)]);
    expect(clusters[0].feet).toBeCloseTo(20, 5);
  });

  it("returns nothing for no walls, rather than an empty group", () => {
    expect(clusterByThickness([])).toEqual([]);
  });

  it("keeps every run — a wall cannot be lost between the groups", () => {
    // The property that matters most: this is presentation, and presentation
    // must not change the quantities. An estimator accepting every group must
    // get every wall that was found.
    const walls = [run(4.875, 10), run(2.5, 4), run(8, 20), run(4.9, 6), run(15.5, 3)];
    const clusters = clusterByThickness(walls);
    expect(clusters.reduce((n, c) => n + c.runs.length, 0)).toBe(walls.length);
    expect(clusters.reduce((f, c) => f + c.feet, 0)).toBeCloseTo(43, 5);
  });

  it("uses a width that is wider than CAD noise and narrower than a real gap", () => {
    // The constant is load-bearing in both directions, so it is asserted in
    // both: it must merge a 0.28" split and preserve a 1.25" one.
    expect(CLUSTER_INCHES).toBeGreaterThan(0.28);
    expect(CLUSTER_INCHES).toBeLessThan(1.25);
  });
});

/**
 * KEEPING THE BUILDING AND DROPPING THE REST OF THE SHEET.
 *
 * The finder read the whole page, so it returned the title block's ruled lines,
 * the notes column, the sheet border and the wall sections printed above the
 * plan. Every one is a genuine pair of parallel lines at a genuine spacing.
 *
 * Nobody caught it from the numbers — the thicknesses clustered at 4.88", 4.92"
 * and 4.80" across three projects and that was read as proof. It proves
 * nothing. These tests are about POSITION, which is the thing that was never
 * being asked.
 */
const at = (x1: number, y1: number, x2: number, y2: number): WallCandidate => ({
  x1,
  y1,
  x2,
  y2,
  thicknessFeet: 0.40625,
  lengthFeet: Math.hypot(x2 - x1, y2 - y1),
});

// One point per foot, so a gap in these coordinates is a gap in feet.
const FOOT = 1;

describe("keeping only the walls in the building", () => {
  it("drops a title block sitting away from the plan", () => {
    // Plan-sized rather than four walls: `wallsInTheBuilding` now refuses a
    // winner that is merely a box, so a four-run fixture would be refused for
    // the right reason and prove nothing about the title block.
    const plan = Array.from({ length: 14 }, (_, i) => at(0, i * 10, 40, i * 10));
    const titleBlock = [at(300, 0, 340, 0), at(300, 5, 340, 5)];
    const kept = wallsInTheBuilding([...plan, ...titleBlock], FOOT);
    expect(kept).toHaveLength(plan.length);
    expect(kept.every((w) => w.x1 < 300)).toBe(true);
  });

  it("keeps a plan whose runs meet in Ts, not just at corners", () => {
    // The first version compared ENDPOINTS and shattered a real plan into 46
    // pieces, keeping 49 runs of 203 — one corner of the offices. Walls meet in
    // Ts far more often than in Ls: one wall's END against another's MIDDLE.
    const spine = at(0, 0, 200, 0);
    const branches = Array.from({ length: 15 }, (_, i) => at(i * 12, 0, i * 12, 40));
    const kept = wallsInTheBuilding([spine, ...branches], FOOT);
    expect(kept).toHaveLength(16);
  });

  it("bridges a doorway, a corridor and a wall it simply missed", () => {
    // Runs do not touch as often as a drawing suggests. Anything under the
    // same-building distance is still one building.
    // Two halves of a plan, each plan-sized, separated by just under the
    // same-building distance. Both must come back as one building.
    const left = Array.from({ length: 8 }, (_, i) => at(0, i * 10, 30, i * 10));
    const right = Array.from({ length: 8 }, (_, i) => at(30 + SAME_BUILDING_FEET - 1, i * 10, 70, i * 10));
    expect(wallsInTheBuilding([...left, ...right], FOOT)).toHaveLength(16);
  });

  it("keeps the group with the most FOOTAGE, not the most runs", () => {
    // A dense notes column can out-count a building without out-measuring it.
    // Plan-sized, because a two-run building is now refused as a box — and
    // short rules for the notes, many of them: 30 runs against the building's
    // 12, but 60ft against its 1,440.
    //
    // An earlier draft made the rules 8ft each, which is 240ft, so the notes
    // genuinely WERE the bigger thing and the test asserted the opposite of
    // what it claimed. The suite caught that; it is the fixture that has been
    // wrong twice here, never the code.
    const building = Array.from({ length: 12 }, (_, i) => at(0, i * 10, 120, i * 10));
    const notes = Array.from({ length: 30 }, (_, i) => at(500, i * 2, 502, i * 2));
    const kept = wallsInTheBuilding([...building, ...notes], FOOT);
    expect(kept).toHaveLength(12);
    expect(kept.every((w) => w.x1 < 500)).toBe(true);
  });

  it("returns everything when the sheet holds nothing but the plan", () => {
    const plan = Array.from({ length: 20 }, (_, i) => at(0, i * 10, 40, i * 10));
    expect(wallsInTheBuilding(plan, FOOT)).toHaveLength(20);
  });

  it("returns nothing for nothing, rather than throwing", () => {
    expect(wallsInTheBuilding([], FOOT)).toEqual([]);
  });

  it("KEEPS A FOUR-RUN GROUP, because a one-room building is four runs", () => {
    // ── THIS TEST USED TO ASSERT THE OPPOSITE, AND IT WAS RIGHT TO ──
    //
    // It read: "REFUSES A SHEET WHOSE BIGGEST GROUP IS A BOX". The reason was
    // real — on a roof/equipment sheet the biggest group was the TITLE BLOCK,
    // four runs, 64 ft, a rectangle in the corner offered to an estimator as
    // the walls of a building, and only the picture showed it.
    //
    // The rule it bought was `best.length < NOT_A_BOX ? [] : best`, and that
    // count could not tell a title block from a BUILDING WITH ONE ROOM,
    // because both are four runs. It discarded S01 (a studio office), S10 (a
    // cottage) and S11 (a guest house) — ordinary plans, thin double-line
    // walls, perfectly axis-aligned — and returned zero feet on all three.
    //
    // The title block is now removed before this function is reached:
    // `findWallsOnSheet` runs `wallsNotLettering`, `wallsNotTheSheetBorder`
    // and `wallsNotTheScaleBar` FIRST. That asks what the geometry IS instead
    // of how much of it there is, and it costs no buildings. The ordering is
    // pinned in `findWallsOnSheet`'s own tests; what belongs here is that no
    // size is refused.
    const oneRoom = [at(300, 0, 340, 0), at(340, 0, 340, 20), at(300, 20, 340, 20), at(300, 0, 300, 20)];
    expect(wallsInTheBuilding(oneRoom, FOOT)).toHaveLength(4);
  });

  it("still returns a large plan unchanged", () => {
    const plan = Array.from({ length: NOT_A_BOX + 2 }, (_, i) => at(0, i * 10, 40, i * 10));
    expect(wallsInTheBuilding(plan, FOOT)).toHaveLength(NOT_A_BOX + 2);
  });

  it("KEEPS THE BIGGEST GROUP AND ONLY THAT, which is the job it does have", () => {
    // Two separate clusters far apart: the bigger by footage wins. This is the
    // part of the function that was never in question and must survive the
    // threshold being removed.
    const near = [at(0, 0, 40, 0), at(0, 10, 40, 10)];
    const far = [at(5000, 0, 5010, 0)];
    const kept = wallsInTheBuilding([...near, ...far], FOOT);
    expect(kept).toHaveLength(2);
    expect(kept.every((w) => w.x1 < 1000)).toBe(true);
  });

  it("uses a distance wide enough for a corridor and far short of a title block", () => {
    // Measured by sweeping and looking: at 6ft a real plan broke into 46
    // pieces; 12 kept 132 runs, 20 kept 178, 30 kept 186. It plateaus at 20.
    expect(SAME_BUILDING_FEET).toBeGreaterThanOrEqual(12);
    expect(SAME_BUILDING_FEET).toBeLessThan(60);
  });
});

/** A text item's box, as `wallsNotLettering` reads it. */
const label = (x: number, y: number, w = 6, h = 3) => ({ x, y, width: w, height: h });

describe("telling lettering from walls", () => {
  it("drops a short run sitting inside a text item", () => {
    const glyph = at(100, 100, 102, 100); // 2ft, inside the tag's box
    const kept = wallsNotLettering([glyph], [label(98, 98)], 1);
    expect(kept).toEqual([]);
  });

  it("KEEPS A LONG WALL WHOSE MIDPOINT IS INSIDE A ROOM TAG", () => {
    // A plan puts its labels ON the thing they label, so a partition running
    // under a room number is ordinary. Dropping it would be worse than keeping
    // a tag: a missing wall is a short bid, while a wrong one is visible on the
    // drawing and gets rejected.
    //
    // THE MIDPOINT MUST LAND IN THE BOX or this tests nothing — the first
    // fixture put the label off to one side, so the wall was kept because it
    // was never near the text, and removing the length guard stayed GREEN.
    const wall = at(90, 100, 130, 100); // 40ft; midpoint (110, 100)
    const tag = label(107, 99, 6, 2); // x 107..113, y 99..101 — contains it
    expect(wallsNotLettering([wall], [tag], 1)).toHaveLength(1);

    // And the same geometry with a SHORT run is lettering, which is what makes
    // the length the thing under test rather than the position.
    const glyph = at(109, 100, 111, 100); // 2ft, same midpoint
    expect(wallsNotLettering([glyph], [tag], 1)).toEqual([]);
  });

  it("keeps a short run that is nowhere near any text", () => {
    const stub = at(500, 500, 502, 500);
    expect(wallsNotLettering([stub], [label(98, 98)], 1)).toHaveLength(1);
  });

  it("keeps everything when the sheet reports no text at all", () => {
    // A scanned sheet has no text layer. This needs no guard — nothing is
    // inside an empty list — and a guard written here was deleted when
    // mutation showed removing it changed nothing. The behaviour is still
    // asserted, because it is the behaviour that matters, not the branch.
    const walls = [at(100, 100, 102, 100), at(0, 0, 40, 0)];
    expect(wallsNotLettering(walls, [], 1)).toHaveLength(2);
  });

  it("measures the pad in FEET, so it means the same in both coordinate spaces", () => {
    // The first version used a bare `2`, which is 2 points to the server reader
    // and TWO PAGE WIDTHS to the viewer, where coordinates run 0..1 — every
    // wall on the sheet would have been inside a text box and the drawing
    // filtered away. Same unit mistake the CTM bug made with lengths.
    //
    // Here one unit is one foot, so a half-foot pad reaches just outside the
    // box and no further: a run 3ft clear of the label survives.
    //
    // The box runs x 98..104. At a half-foot pad its reach ends at 104.5; a
    // bare `2` would reach 106. So a midpoint at 105 is the discriminator —
    // kept under the real pad, swallowed under the wrong one.
    const justOutside = at(104, 100, 106, 100); // midpoint x = 105
    expect(wallsNotLettering([justOutside], [label(98, 98, 6, 3)], 1)).toHaveLength(1);

    // And just INSIDE the real pad is still lettering, so the pad is doing
    // something rather than being nominally present.
    const justInside = at(103, 100, 105, 100); // midpoint x = 104
    expect(wallsNotLettering([justInside], [label(98, 98, 6, 3)], 1)).toEqual([]);
  });

  it("uses a length bound that a letter cannot reach and a wall easily can", () => {
    expect(LETTER_FEET).toBeGreaterThan(1);
    expect(LETTER_FEET).toBeLessThan(10);
  });
});

/**
 * THE SHEET'S OWN BORDER IS NOT A WALL.
 *
 * A click-through on a real permit set reported a group reading "10-1/2" · 1
 * run · 114 ft" — a single line down the LEFT SHEET BORDER. One group, 114
 * feet, entirely false, and the most inviting thing in the panel because it was
 * the longest run on the sheet.
 *
 * The border is distinctive in one way nothing inside a building is: it runs
 * the full extent of the PAGE. Measured on the sheet it was reported on, that
 * border was ~95% of the page height, while the longest real wall was 68% of
 * the width — so 90% sits in a gap rather than on a judgement call.
 *
 * Verified against the three real sheets from that click-through: it drops
 * exactly the reported border on Augusta and NOTHING on Naples or West Herr.
 */
describe("telling the sheet border from a wall", () => {
  // One unit = one foot here; the page is 168 x 120, a landscape sheet.
  const PAGE_W = 168;
  const PAGE_H = 120;

  it("drops a run spanning almost the whole page height", () => {
    const border = at(2, 2, 2, 116); // 114ft down a 120ft page — the real case
    expect(wallsNotTheSheetBorder([border], PAGE_W, PAGE_H)).toEqual([]);
  });

  it("drops a run spanning almost the whole page WIDTH", () => {
    const border = at(2, 2, 162, 2);
    expect(wallsNotTheSheetBorder([border], PAGE_W, PAGE_H)).toEqual([]);
  });

  it("KEEPS A LONG EXTERIOR WALL, which is the whole risk", () => {
    // The longest real wall measured on that sheet was 68% of the page width.
    // Dropping it would trade a visible wrong line for an invisible short bid.
    const exterior = at(10, 40, 124, 40); // 114ft across a 168ft page
    expect(wallsNotTheSheetBorder([exterior], PAGE_W, PAGE_H)).toHaveLength(1);
  });

  it("measures against the run's OWN axis, not whichever came first", () => {
    // 114ft is 95% of the height and 68% of the width. A vertical run of that
    // length is the border; a horizontal one is a wall. Comparing against the
    // wrong dimension is exactly how this would miss.
    const vertical = at(2, 2, 2, 116);
    const horizontal = at(10, 40, 124, 40);
    const kept = wallsNotTheSheetBorder([vertical, horizontal], PAGE_W, PAGE_H);
    expect(kept).toHaveLength(1);
    expect(kept[0].y1).toBe(40);
  });

  it("keeps everything when the page size is unknown", () => {
    // Filtering on a dimension that is not there would silently empty the
    // drawing — the same fallback every other filter here carries.
    const walls = [at(2, 2, 2, 116), at(10, 40, 124, 40)];
    expect(wallsNotTheSheetBorder(walls, 0, 0)).toHaveLength(2);
    expect(wallsNotTheSheetBorder(walls, PAGE_W, 0)).toHaveLength(2);
  });

  it("uses a fraction that clears a real wall and catches a border", () => {
    expect(MOST_OF_THE_SHEET).toBeGreaterThan(0.7);
    expect(MOST_OF_THE_SHEET).toBeLessThan(1);
  });

  it("returns nothing for nothing", () => {
    expect(wallsNotTheSheetBorder([], PAGE_W, PAGE_H)).toEqual([]);
  });
});

describe("a SEGMENTED sheet border, which the span rule alone cannot see", () => {
  // Found by a browser run on Augusta A1.11, 2026-10-10 — the first time "Find
  // the walls" had been pressed on a real drawing. The panel offered a
  // "6-inch, 237 ft" group that was the drawing frame and the title-block
  // lines, on a sheet 168 feet wide. An architectural border is four runs
  // INSET from the paper that stop short of the corners, so each piece is well
  // under `MOST_OF_THE_SHEET` and every one of them passed.
  //
  // The reporter named the hazard better than any test had: "The total footage
  // looks plausible, which is the danger."

  // An ARCH D sheet as the viewer hands it over: x a fraction of sheet width,
  // y scaled by the same factor.
  const W = 1;
  const H = 0.667;
  const at = (x1: number, y1: number, x2: number, y2: number): WallCandidate => ({
    x1,
    y1,
    x2,
    y2,
    thicknessFeet: 0.5,
    lengthFeet: 50,
  });

  it("DROPS a border segment that covers a third of the width along the top", () => {
    // 0.33 of the sheet — nowhere near the 0.9 the span rule needs.
    const kept = wallsNotTheSheetBorder([at(0.02, 0.012, 0.35, 0.012)], W, H);
    expect(kept).toHaveLength(0);
  });

  it("DROPS border segments along all four sides", () => {
    const frame = [
      at(0.02, 0.012, 0.5, 0.012),
      at(0.5, 0.655, 0.98, 0.655),
      at(0.012, 0.02, 0.012, 0.4),
      at(0.988, 0.3, 0.988, 0.64),
    ];
    expect(wallsNotTheSheetBorder(frame, W, H)).toHaveLength(0);
  });

  // ── THE THREE SAFETY CASES. Neither half of the rule is safe alone, and
  //    mutation is what says so rather than argument.

  it("KEEPS a long wall that is NOT in the edge strip", () => {
    // Half the sheet — 84 feet of building on Augusta's scale, far longer than
    // the border segments dropped above, and kept because of WHERE it is. The
    // edge rule alone would have to drop this to catch a segmented border.
    expect(wallsNotTheSheetBorder([at(0.25, 0.2, 0.75, 0.2)], W, H)).toHaveLength(1);
  });

  it("KEEPS a short wall that IS in the edge strip", () => {
    // Position alone would drop the outermost partitions of a plan drawn close
    // to the frame.
    expect(wallsNotTheSheetBorder([at(0.3, 0.012, 0.4, 0.012)], W, H)).toHaveLength(1);
  });

  it("PINS THE EDGE STRIP so it cannot be widened to reach a title block", () => {
    // `ALONG_THE_EDGE` is tight because nothing of the BUILDING is in that
    // strip — the border occupies it and the plan is inside the border. A strip
    // wide enough to cover a title block is a corner guess this module has no
    // measurement for, and it would eat real wall on any sheet drawn out to the
    // title-block strip. A wall 15% in is ordinary.
    expect(wallsNotTheSheetBorder([at(0.2, 0.15, 0.8, 0.15)], W, H)).toHaveLength(1);
    expect(wallsNotTheSheetBorder([at(0.15, 0.1, 0.15, 0.55)], W, H)).toHaveLength(1);
  });

  it("AND THE PRE-EXISTING SPAN RULE DROPS A REAL WALL, which this change does not fix", () => {
    // Written after two of the safety cases above failed on fixtures spanning
    // 94% and 96% of the sheet. They were not failing on the new rule — they
    // were failing on `MOST_OF_THE_SHEET`, which has dropped any run over 90%
    // of the sheet, at ANY position, since before this change.
    //
    // So a building scaled to fill its sheet loses its longest wall, silently,
    // and that is a HAZARD rather than a feature: on Augusta's 168-foot sheet
    // it is every wall over 151 feet. It is pinned here rather than changed,
    // because changing it needs a measurement on real sheets that nobody has
    // taken — the span rule is also the only thing catching a border drawn as
    // one unbroken line, and loosening it without the edge rule proven on real
    // drawings would trade a known false positive for an unknown one.
    //
    // Do not read this test as approval. It records what the code does.
    const acrossTheWholeSheet = at(0.03, 0.33, 0.97, 0.33);
    expect(wallsNotTheSheetBorder([acrossTheWholeSheet], W, H), "dropped by MOST_OF_THE_SHEET").toHaveLength(0);
    // Same wall, shorter, away from the edge: kept. The rule is about span.
    expect(wallsNotTheSheetBorder([at(0.1, 0.33, 0.8, 0.33)], W, H)).toHaveLength(1);
  });

  it("FALLS BACK TO THE SPAN RULE when the geometry is not inside the page given", () => {
    // "Along the bottom edge" is meaningless if the walls extend past the
    // stated page, and the failure mode is the worst kind: every run reads as
    // edge-hugging, the filter returns NOTHING, and an empty panel looks like a
    // sheet with no walls rather than a bug.
    //
    // The first attempt at this guard used a NEGATIVE band to mean "off", which
    // inverted the rule instead of disabling it — `pageHeight - (-1)` is larger
    // than the page, so everything hugged the bottom. A negative distance is
    // not a disabled distance.
    const outside = [at(0.02, 0.012, 0.35, 0.012)];
    expect(wallsNotTheSheetBorder(outside, W, 0.001)).toHaveLength(1);
  });

  it("still drops a border drawn as ONE full-width line", () => {
    // The original rule, unchanged. This is additive.
    expect(wallsNotTheSheetBorder([at(0.01, 0.33, 0.99, 0.33)], W, H)).toHaveLength(0);
  });
});

describe("one physical wall is found once, however many faces it is drawn with", () => {
  // ── THE DEFECT A HAND COUNT FOUND ──
  //
  // School-01's own tag `EXT-1` came back on THREE thickness groups at once.
  // One assembly cannot be three thicknesses, so one wall was being found three
  // times: the pairer takes the widest valid pair and CONSUMES those two faces,
  // and the leftover faces in the middle then pair with each other.
  //
  // Over-reporting is the direction that reaches a bid. Every copy sits exactly
  // on a real wall, so the overlay looks perfect while the footage is double.

  /** One inch of BUILDING, in points at 1/8" = 1'-0". */
  const INCH = 0.75;

  /** Face offsets measured on a real exterior wall: outer finish, two layers of
   *  sheathing, stud face, inner face. */
  const EXTERIOR_IN = [0, 1.56, 2.28, 8.28, 8.88];

  const exterior = (y: number, lenPt: number) =>
    EXTERIOR_IN.map((inches) => h(100, y + inches * INCH, lenPt));

  it("REPORTS A 40FT EXTERIOR WALL ONCE, NOT TWICE", () => {
    // Before the dedup this returned two 40ft walls, 8.88in and 6.72in, lying
    // on top of each other — 80 ft of bid for 40 ft of building.
    const walls = wallsFromStrokes(exterior(500, 360), EIGHTH);
    expect(walls, "one wall was found more than once").toHaveLength(1);
    expect(walls[0].lengthFeet).toBeCloseTo(40, 1);
  });

  it("keeps the FINISH-TO-FINISH thickness, not one layer of it", () => {
    // Which copy survives decides what assembly it is priced as. An estimator
    // measures finish to finish, and that is the pairer's own first answer.
    const walls = wallsFromStrokes(exterior(500, 360), EIGHTH);
    expect(walls[0].thicknessFeet * 12).toBeCloseTo(8.88, 1);
  });

  it("KEEPS THE WALL AND NOT THE COLUMN GRID LINE'S PAIRING", () => {
    // The first draft of the dedup got this WRONG and the mutation run caught
    // it. Faces are walked longest-first, so a 115ft grid line is reached
    // before the 40ft wall it runs past, and its pairing is emitted first —
    // one wall of 10.92in where the drawing has an 8.88in one. Correct
    // deduplication, wrong copy, and worse than the duplicate it replaced
    // because the footage now looks right.
    //
    // A grid line is not a balanced partner for a wall, and the pairer already
    // knew that. Balanced findings are now considered first.
    const gridline = h(-100, 500 + 12.48 * INCH, 1035);
    const walls = wallsFromStrokes([...exterior(500, 360), gridline], EIGHTH);
    expect(walls).toHaveLength(1);
    expect(walls[0].thicknessFeet * 12, "the grid line's pairing was kept as the wall").toBeCloseTo(8.88, 1);
  });

  it("STILL FINDS A PLAIN TWO-FACE PARTITION — nothing is given up", () => {
    // The control. A partition has one possible pairing, so the dedup has
    // nothing to do and must do nothing.
    const walls = wallsFromStrokes([h(100, 500, 180), h(100, 500 + PARTITION_PT, 180)], EIGHTH);
    expect(walls).toHaveLength(1);
    expect(walls[0].lengthFeet).toBeCloseTo(20, 1);
  });
});

describe("what the dedup must NOT collapse", () => {
  // Tested on `oneWallPerPlace` directly rather than through the pairer: these
  // are about the dedup's own judgement, and routing them through the pairing
  // would be measuring that instead.

  /** A horizontal run at `y`, `lenPt` long, of the given thickness. */
  const run = (y: number, lenPt: number, thicknessIn: number): WallCandidate => ({
    x1: 100,
    y1: y,
    x2: 100 + lenPt,
    y2: y,
    thicknessFeet: thicknessIn / 12,
    lengthFeet: lenPt / 9,
  });

  const INCH = 0.75;

  it("DROPS a second finding inside the first wall's thickness", () => {
    // The defect itself, stated as the dedup sees it.
    const kept = oneWallPerPlace([run(500, 360, 8.88), run(500 + 0.48 * INCH, 360, 6.72)], 1 / 9);
    expect(kept).toHaveLength(1);
    expect(kept[0].thicknessFeet * 12).toBeCloseTo(8.88, 1);
  });

  it("KEEPS a furring wall standing against a thick one", () => {
    // Centreline 5.25in off an 8in wall, whose half-thickness is 4in. Real, and
    // the closest real thing to a duplicate on any drawing — which is why the
    // test is the centreline being INSIDE the thickness rather than merely near.
    const kept = oneWallPerPlace([run(500, 360, 8), run(500 + 5.25 * INCH, 360, 2.5)], 1 / 9);
    expect(kept, "a furring wall was swallowed by the wall it furs").toHaveLength(2);
  });

  it("KEEPS the two walls either side of a corridor", () => {
    const corridor = 5.583 * 9;
    expect(
      oneWallPerPlace([run(500, 360, 4.875), run(500 + corridor, 360, 4.875)], 1 / 9),
    ).toHaveLength(2);
  });

  it("KEEPS two walls end to end on the same line", () => {
    // Same line, zero overlap. Without the overlap test these collapse into one
    // and a whole wall leaves the bid.
    const second: WallCandidate = { ...run(500, 180, 4.875), x1: 300, x2: 480 };
    expect(oneWallPerPlace([run(500, 180, 4.875), second], 1 / 9)).toHaveLength(2);
  });

  it("KEEPS walls that cross at a right angle", () => {
    const across: WallCandidate = {
      x1: 200,
      y1: 400,
      x2: 200,
      y2: 700,
      thicknessFeet: 4.875 / 12,
      lengthFeet: 300 / 9,
    };
    expect(oneWallPerPlace([run(500, 360, 4.875), across], 1 / 9)).toHaveLength(2);
  });

  it("KEEPS A WALL CROSSING THIS ONE AT A SHALLOW ANGLE", () => {
    // Found by mutation: dropping the parallel test left every other case
    // green, because a wall crossing at a RIGHT angle projects to nothing and
    // the overlap test refuses it anyway. A shallow crossing is the case that
    // needs the parallel test, and School-01 has one — the 17.5-degree wall in
    // Conference 118, T-ing into the wall on grid E.
    //
    // Its midpoint lies ON the other wall's line, and 95% of it lies alongside.
    // Only the ANGLE says these are two walls.
    const diagonal: WallCandidate = {
      x1: 194.2,
      y1: 472.9,
      x2: 365.8,
      y2: 527.1,
      thicknessFeet: 4.875 / 12,
      lengthFeet: 20,
    };
    expect(
      oneWallPerPlace([run(500, 360, 4.875), diagonal], 1 / 9),
      "a wall crossing at 17.5 degrees was read as the same wall",
    ).toHaveLength(2);
  });

  it("KEEPS a short duplicate's VICTIM — overlap is judged against the shorter run", () => {
    // Also found by mutation. The leftover pairing is often a FRAGMENT, because
    // the inner layers are interrupted where the outer finish is not. Judged
    // against the longer run a 15ft fragment on a 40ft wall fails the overlap
    // test and survives as a second wall; against the shorter one it is caught.
    const fragment: WallCandidate = { ...run(500 + 0.48 * INCH, 135, 6), lengthFeet: 15 };
    expect(oneWallPerPlace([run(500, 360, 8.88), fragment], 1 / 9)).toHaveLength(1);
  });

  it("KEEPS a wall whose centreline is JUST OUTSIDE the other's thickness", () => {
    // The boundary, stated so a widened band fails here rather than quietly
    // eating real walls.
    const kept = oneWallPerPlace([run(500, 360, 8), run(500 + 4.2 * INCH, 360, 4.875)], 1 / 9);
    expect(kept).toHaveLength(2);
  });
});

/**
 * ── A CORRIDOR'S TWO SIDES ARE NOT THE SAME LENGTH ──
 *
 * `MAX_FACE_LENGTH_RATIO` was 3 — the gate is gone entirely as of 2026-10-16,
 * and this case is why it kept being loosened rather than removed. Its own
 * comment named the case it then rejected: "a wall whose far end is interrupted by a doorway is drawn as a
 * long face and a short one". A corridor is that shape at its worst — one side
 * runs continuously, the other is cut into pieces by every door off it.
 *
 * The numbers below are the real ones, traced on School-01's A-101: a 12.21 ft
 * face whose partner is a 53.25 ft face 4.87in away, overlapping it along its
 * whole length. Parallel, thickness, overlap and minimum length all pass; the
 * pair died on 53.25 / 12.21 = 4.36 > 3.
 *
 * At 1/8" = 1'-0" a foot is 9pt, so these are built in points like the rest of
 * the file.
 */
describe("two faces of very different lengths", () => {
  const opts: WallFinderOptions = { feetPerPoint: 1 / 9 };
  /** A horizontal face: `feet` long, starting at `atFt`, on line `yFt`. */
  const face = (atFt: number, feet: number, yFt: number): StrokeSegment => ({
    x1: atFt * 9,
    y1: yFt * 9,
    x2: (atFt + feet) * 9,
    y2: yFt * 9,
    width: 0.7,
  });

  it("PAIRS A DOORWAY-BROKEN FACE WITH THE LONG ONE OPPOSITE — the corridor", () => {
    // 4.87in = 0.406 ft between the faces: A1.
    const short = face(0, 12.21, 0);
    const long = face(0, 53.25, 0.406);
    const wall = wallFromPair(long, short, opts);
    expect(wall, "a 4.4x length ratio refused a real wall").not.toBeNull();
    expect(wall!.thicknessFeet * 12).toBeCloseTo(4.87, 1);
    // The run is the OVERLAP, not the long face: claiming the whole 53 ft
    // would be the over-reporting this must not buy.
    expect(wall!.lengthFeet).toBeCloseTo(12.21, 1);
    // AND THE GEOMETRY, not only the reported number. `lengthFeet` comes from
    // the overlap, so it stays right even when the drawn run is stretched to
    // the long face — mutation-tested, and blind until this line. A run that
    // carries past its own wall is the over-reporting the bench counts as
    // "not on a wall", and it is invisible to a length assertion alone.
    const span = Math.hypot(wall!.x2 - wall!.x1, wall!.y2 - wall!.y1) / 9;
    expect(span, "the run was stretched past its own wall").toBeCloseTo(12.21, 1);
  });

  it("STILL REFUSES THE SHEET BORDER AGAINST THE TITLE BLOCK", () => {
    // The case the constant was first measured on: a 36in sheet border against
    // a 180pt title-block rule, a 13-fold gap no wall has. 10pt apart, which at
    // this scale is 1.1 ft and sits squarely inside the partition window — so
    // nothing but the length ratio separates them.
    const border = face(0, 288, 0);
    const titleBlock = face(0, 20, 1.1);
    expect(wallFromPair(border, titleBlock, opts), "the border paired with the title block").toBeNull();
  });

  it("STILL REFUSES THE PAIR RULE 5 WAS WRITTEN FOR, now on rule 6", () => {
    // The sheet border against the title-block box: the 20 ft of phantom on
    // every clean sheet that rule 5 was added for, and the thing that had to
    // keep working when it was removed for not being scale-free.
    //
    // 2592pt of border and 180pt of box, 10pt apart. Their raw ratio is 14.4,
    // which is what rule 5 read. What rule 6 reads is that the border
    // overhangs the box by 134 ft at EACH end against a 20 ft face — and
    // overhanging at BOTH ends is the thing no wall does, because the only
    // legitimate reason a face outruns its partner is a corner and a corner
    // overruns by a wall thickness.
    const border = face(0, 2592 / 9, 0);
    const titleBlock = face(1206 / 9, 180 / 9, 0.406);
    expect(wallFromPair(border, titleBlock, opts), "the border phantom is back").toBeNull();
    expect(wallFromPair(titleBlock, border, opts), "and in the other order").toBeNull();
  });

  it("and accepts a corner, where a face outruns its partner by ONE THICKNESS", () => {
    // The other half, without which the test above is satisfied by refusing
    // everything. This is the case a raw-length gate kept confusing with the
    // border: an outer face is longer than its inner face at every corner in
    // every building, by the thickness of the wall it turns into.
    const inner = face(0, 20, 0);
    const outer = face(-0.406, 20 + 0.406 * 2, 0.406);
    expect(wallFromPair(outer, inner, opts), "a corner was refused").not.toBeNull();
  });

  it("keeps pairing two faces of the same length, which is most walls", () => {
    const wall = wallFromPair(face(0, 20, 0), face(0, 20, 0.406), opts);
    expect(wall).not.toBeNull();
    expect(wall!.lengthFeet).toBeCloseTo(20, 1);
  });
});

/**
 * ── 9-1/2 INCHES IS NOT A WALL ANYBODY BUILDS ──
 *
 * "The widest valid pair is the wall and the narrower ones are its layers" is
 * right for one wall drawn in layers and wrong where two assemblies touch.
 * 1-1/2in furring on an 8in block wall is drawn as three lines, and the pairs
 * are 8in (the block), 1-1/2in (the furring) and 9-1/2in (across both). Widest
 * won, so the finder returned ONE WALL AT 9-1/2IN: a thickness on no schedule,
 * priced as an assembly nobody ordered. That is the 33 ft reported "on the
 * block" on School-01's A-101. The furring is still missed — see the test
 * below that pins why, which is a different rule and a separate piece of
 * work.
 *
 * Thickness cannot separate that from a layered exterior, where the widest span
 * IS the wall. The SCHEDULE can: 8 and 1-1/2 are on it, 9-1/2 is on nothing.
 *
 * Graded per wall on `reports/takeoff-bench`, against the key's centreline:
 * Mesa Ridge 59,538 -> 61,253 ft found with not-on-a-wall DOWN 4,500 -> 3,902,
 * and A-101 1,853 -> 1,936 ft with its 33 ft of block reporting gone.
 */
describe("the partition schedule", () => {
  const PT = 9;
  const face = (feet: number, offsetInches: number): StrokeSegment => ({
    x1: 0,
    y1: (offsetInches / 12) * PT,
    x2: feet * PT,
    y2: (offsetInches / 12) * PT,
    width: 0.7,
  });
  const found = (offsets: number[], knownThicknessesIn?: number[]) =>
    wallsFromStrokes(
      offsets.map((at) => face(30, at)),
      { feetPerPoint: 1 / PT, knownThicknessesIn },
    )
      .map((wall) => Number((wall.thicknessFeet * 12).toFixed(2)))
      .sort((a, b) => b - a);

  // 8in block, then 1-1/2in furring on its inner face.
  const BLOCK_AND_FURRING = [0, 8, 9.5];
  // EXT-2 as a real export draws it: PARTITION_TYPES["EXT-2"].planLines.
  const LAYERED_EXTERIOR = [4.0625, 3.4375, -2.5625, -4.0625];
  const SCHEDULE = [8, 1.5, 8.125, 4.875, 4.75, 14.5];

  // The bench's own partition schedule, and it is what made the collision below
  // reachable: it carries EXT-1 at 8.875in, and 9.125in is a quarter inch away.
  const BENCH_SCHEDULE = [4.875, 7.25, 4.75, 14.5, 1.5, 8.875, 8.125, 7.625, 4.5];

  it("READS 1-1/2IN FURRING ON 7-5/8IN BLOCK AS THE BLOCK, NOT AS A 9-1/8IN WALL", () => {
    // ── THE SLACK COLLISION, AND WHY THE FIXTURE BELOW HID IT FOR WEEKS ──
    //
    // These are the real numbers: furring face, block near face, block far
    // face. The span across both is 9.125in and EXT-1 is 8.875in — exactly
    // `KNOWN_SLACK_IN` apart — so the span LOOKED like a type this company
    // builds. "The widest pair the schedule names" took it, and the finder
    // returned one wall at 9.13in where the drawing has a block wall with
    // furring in front of it.
    //
    // Worse, it poisoned both halves: `enclosedByAScheduledWall` saw the same
    // phantom wall and marked the block AND the furring as layer lines of it,
    // so each was refused before the schedule tier could prefer either. That
    // is why this cost 1,210 ft of furring on Mesa Ridge rather than the 20 ft
    // the probe table reports against one wall.
    //
    // The fixture in the next test uses 8in and 9.5in, where the span matches
    // NOTHING on its schedule — which is exactly why the schedule preference
    // looked like it worked.
    // The block at 7.63 rather than a phantom 9.13, and the furring with it
    // once the phantom stops claiming both faces — see `secondAssemblyPass`.
    expect(found([0, 7.625, 9.125], BENCH_SCHEDULE)).toEqual([7.63, 1.5]);
  });

  it("believes a thickness a HAIR off the schedule, because a plotted line is not exact", () => {
    // ── WHAT PINS `EXACT_SCHEDULE_IN` FROM BELOW ──
    //
    // The rule only overrides a LOOSE match, and "loose" cannot mean "not
    // identical": a real export measures 8.10in where the legend says 8.125,
    // and refusing that would price the wall as the wrong assembly.
    //
    // Added because a mutation said so. Setting the constant to 0 left the
    // whole suite green — the window-broken exterior clears it either way,
    // because its span is EXACTLY on its schedule. So nothing distinguished
    // 1/16in from zero, and the tolerance that exists for plotter noise was
    // unpinned. This case is 0.025in off and decomposes into two scheduled
    // halves, so it is refused the moment the tolerance stops existing.
    expect(found([0, 1.5, 8.1], [1.5, 6.6, 8.125])).toEqual([8.1]);
  });

  // ── TWO MUTATIONS OF THIS RULE STAY GREEN, WRITTEN DOWN RATHER THAN DRESSED
  // UP, in the manner of `foundTwice`'s own unpinned choice above ──
  //
  // 1. Dropping the "is the second half scheduled" check does not change any
  //    outcome I could construct. The case below is the closest: its halves are
  //    3in (scheduled) and 6.125in (not), and with the check gone the span is
  //    refused — and the finder still answers 9.13 from a lower tier, because
  //    refusing a pair as SCHEDULED does not stop `bestWall` choosing it as the
  //    widest balanced pair. So the requirement is real in the code and its
  //    effect is masked by the fallback everywhere I could reach. Left in,
  //    because "one named gap inside a wall" is the layered-exterior case and
  //    dropping it is wrong on purpose rather than by accident.
  //
  // 2. Widening the `> 6` gate changes nothing, and should not: it exists so an
  //    O(n) scan does not run on every candidate inside an O(n^2) loop — this
  //    file's own note about `inAHatchSeries`. A performance gate asserted as
  //    behaviour would be a test lying about what it protects.
  it("NEEDS BOTH HALVES SCHEDULED, so one named gap inside a wall proves nothing", () => {
    // The rule asks for the span to divide into TWO scheduled types. A single
    // named gap inside a wider pair is an ordinary layer line and the wider
    // pair is still the wall — 3in is on this schedule, 9.125 - 3 = 6.125in is
    // not, so nothing is refused and the span stands.
    //
    // THE SUB-GAP IS 6.125IN DELIBERATELY, and the first version of this test
    // used 1.875in and proved nothing: a 1.875in gap is under the 2.4in
    // thickness floor and unscheduled, so `wallFromPair` returns null for it
    // and the half is rejected before its thickness is ever considered. The
    // mutation that drops the "is it scheduled" check stayed green. A case has
    // to fail for the reason it names.
    expect(found([0, 3, 9.125], [3, 8.875])).toEqual([9.13]);
  });

  it("READS THE BLOCK WALL AT 8IN INSTEAD OF 9-1/2IN ACROSS BOTH", () => {
    // The block at its own thickness, which is what #751 fixed. The 1.5in
    // beside it is the furring, recovered by `secondAssemblyPass` — asserted
    // in its own test below rather than here, so a regression in either one
    // names itself.
    expect(found(BLOCK_AND_FURRING, SCHEDULE)).toContain(8);
  });

  it("RECOVERS THE FURRING TOO, on the other side of the face the block took", () => {
    // ── THE TEST THIS REPLACES SAID "DOES NOT YET", AND NAMED THE CONDITION ──
    //
    // It read: "this is the next piece of work, and it needs a way to admit the
    // second side of a face WITHOUT admitting all of them." That is what
    // `secondAssemblyPass` does, and the condition is the whole reason it is
    // safe: a face may serve a second wall only when that wall is on its OTHER
    // SIDE, only at a thickness the schedule names, and only where no layer
    // line or hatch series explains it.
    //
    // THE OLD TEST'S MEASUREMENT WAS HONEST AND IS NOW MISLEADING, so it is
    // worth saying exactly what changed. It recorded the unguarded version
    // buying "about 100 ft" and costing "roughly 2,900 ft on Mesa Ridge and
    // 2,000 ft on the holdout" of footage not on any wall, because every face
    // gained a second chance to pair with something that is not its partner.
    // That was true of THAT version.
    //
    // It was also measured again, guarded, and it bought 27 ft for nothing —
    // because the thing it was trying to find was being eaten by a different
    // defect. The span across block and furring was being read as a 9-1/8in
    // wall (see the slack-collision test below), so there was no free side to
    // find: the phantom wall had claimed both faces. Fixing that first is what
    // made this pass worth having, and the order matters — on its own it is a
    // wash, and after the decomposition fix it is 101 ft of holdout furring at
    // no cost in not-on-a-wall footage.
    //
    // Graded on `reports/takeoff-bench`: holdout furring 162 -> 263 ft of a 307
    // ft key, holdout found 31,998 -> 32,100, Mesa 64,993 -> 65,021, and
    // not-on-a-wall UNCHANGED on both sets at 3,610 and 389.
    expect(found(BLOCK_AND_FURRING, SCHEDULE)).toEqual([8, 1.5]);
  });

  // ── FIVE OF THIS PASS'S SIX GUARDS ARE NOT PINNED BY THE CASES BELOW, AND
  // SAYING SO IS WORTH MORE THAN PRETENDING OTHERWISE ──
  //
  // Mutation-tested six ways. Only "never call the pass at all" reds this
  // suite. Dropping the opposite-side condition, the scheduled-thickness
  // check, the layer-line check, the empty-schedule early return or the
  // claimed-face restriction all leave it green — because these fixtures are
  // three parallel lines, and three lines cannot produce the junk those guards
  // exist to refuse. A richer fixture was not written because the thing it
  // would have to model is a busy sheet, which is what the bench is.
  //
  // So the guards are measured there instead, and ONE of them turns out not to
  // earn its place on the evidence available:
  //
  //   opposite-side condition removed:  Mesa found 65,021 -> 65,078 (+57)
  //                                     holdout not-on-a-wall 389 -> 408 (+19)
  //
  // That is nearly behaviour-neutral, and it is NOT the 2,900 ft the earlier
  // unguarded attempt cost. The guards doing that work are the scheduled
  // thickness and the layer-line test; the side condition is kept because it
  // is the physical statement the pass is built on — a face has two sides and
  // what is built against one says nothing about the other — and because the
  // 19 ft it saves on the holdout is the direction this bench is graded in.
  // Recorded rather than asserted, so the next person weighing a simplification
  // starts from a number instead of an argument.
  it("STILL REFUSES THE SECOND SIDE WITHOUT A SCHEDULE, so nothing changes for a caller that has none", () => {
    // The pass returns early on an empty schedule. Pinned because it is the
    // only thing standing between this and the unguarded version the old test
    // measured at 2,900 ft of false footage.
    expect(found(BLOCK_AND_FURRING, [])).toEqual([9.5]);
  });

  it("reports the 9-1/2in span when it has no schedule to consult", () => {
    // Not an aspiration — the behaviour this shipped with, pinned so the
    // schedule is doing the work rather than some other change.
    expect(found(BLOCK_AND_FURRING)).toEqual([9.5]);
    expect(found(BLOCK_AND_FURRING, [])).toEqual([9.5]);
  });

  it("STILL READS A LAYERED EXTERIOR AS ONE WALL, not as wall plus furring", () => {
    // EXT-2's inner two lines are 1.500in apart — the SAME as F1 furring, which
    // is on the schedule. Thickness cannot tell them apart; only position can.
    // See `enclosedByAScheduledWall`.
    expect(found(LAYERED_EXTERIOR, SCHEDULE)).toEqual([8.13]);
    expect(found(LAYERED_EXTERIOR)).toEqual([8.13]);
  });

  it("FINDS A 1-1/2IN WALL THE SCHEDULE NAMES, which the 2.4in floor refuses", () => {
    // The floor exists because, knowing nothing about the building, a gap this
    // thin is more likely a doubled stroke than a wall. The schedule answers
    // that doubt for the thicknesses on it and for nothing else.
    expect(found([0, 1.5], SCHEDULE)).toEqual([1.5]);
    expect(found([0, 1.5]), "the floor let a sub-minimum pair through unasked").toEqual([]);
  });

  it("STILL REFUSES A LAYER LINE WHEN THE OUTER FACE IS BROKEN INTO PIECES", () => {
    // THE SHAPE THAT ACTUALLY SHIPPED THE BUG, and the reason the clean
    // four-line test above cannot catch it: with one unbroken outer face, the
    // wall's own pair consumes it and there is nothing left to form the thin
    // pair. A real sheet breaks that face at every window and corner.
    //
    // Here EXT-2's outer face is two 15 ft pieces, its inner layer line and far
    // face run the full 30 ft. One piece pairs with the far face to make the
    // 8-1/8in wall; the other is left over, 1.500in from the layer line, which
    // is F1's thickness and ON THE SCHEDULE. Without the enclosure test that is
    // a wall. Measured on one holdout sheet before the test existed: 438 ft of
    // runs in a 1.68in cluster where the drawing has 40 ft of furring.
    const piece = (fromFt: number, toFt: number, offsetInches: number): StrokeSegment => ({
      x1: fromFt * PT,
      y1: (offsetInches / 12) * PT,
      x2: toFt * PT,
      y2: (offsetInches / 12) * PT,
      width: 0.7,
    });
    const brokenExterior = [
      piece(0, 15, -4.0625),
      piece(15, 30, -4.0625),
      piece(0, 30, -2.5625),
      piece(0, 30, 4.0625),
    ];
    const thicknesses = wallsFromStrokes(brokenExterior, {
      feetPerPoint: 1 / PT,
      knownThicknessesIn: SCHEDULE,
    }).map((wall) => Number((wall.thicknessFeet * 12).toFixed(2)));
    expect(thicknesses, "a layer line was reported as furring").not.toContain(1.5);
  });

  it("refuses it with the pieces the other way round, so the test is not one-sided", () => {
    // `enclosedByAScheduledWall` is asked in BOTH directions — from each face of
    // the pair — because which of the two is `i` depends on the order the finder
    // happens to walk, which is length order, which the drawing decides. Mirrored
    // here so one direction alone cannot pass.
    const piece = (fromFt: number, toFt: number, offsetInches: number): StrokeSegment => ({
      x1: fromFt * PT,
      y1: (offsetInches / 12) * PT,
      x2: toFt * PT,
      y2: (offsetInches / 12) * PT,
      width: 0.7,
    });
    const mirrored = [
      piece(0, 30, -4.0625),
      piece(0, 30, 2.5625),
      piece(0, 15, 4.0625),
      piece(15, 30, 4.0625),
    ];
    const thicknesses = wallsFromStrokes(mirrored, {
      feetPerPoint: 1 / PT,
      knownThicknessesIn: SCHEDULE,
    }).map((wall) => Number((wall.thicknessFeet * 12).toFixed(2)));
    expect(thicknesses, "a layer line was reported as furring").not.toContain(1.5);
  });

  it("REFUSES A THIN PAIR THE SCHEDULE DOES NOT NAME", () => {
    // 0.75in is the gap a doubled stroke leaves. The floor still refuses it,
    // and the schedule does not rescue it.
    expect(found([0, 8, 8.75], SCHEDULE)).toEqual([8]);
  });

  it("refuses a thickness that is merely CLOSE to one on the schedule", () => {
    // The slack is 1/4in, so 1-1/2in admits 1.25 to 1.75 and nothing else.
    expect(found([0, 8, 10.1], SCHEDULE)).toEqual([8]);
  });
});

/**
 * ── A FACE INTERRUPTED BY A HOLE IS ONE FACE ──
 *
 * A CAD export splits the line a wall's face is drawn with: at every vertex, at
 * every window, at every door. Its near face and its interior layer lines come
 * through whole. The pairing loop walks faces LONGEST FIRST, so the whole lines
 * are reached first, pair with each other, and consume themselves — and the
 * broken face's pieces arrive to find the partner they needed already spoken
 * for. The wall is then reported at whatever the leftovers make.
 *
 * Measured on the bench against the key's own thicknesses, before this existed:
 * 30.2% of Mesa Ridge's reported footage and 28.1% of the holdout's came back
 * at a thickness on NO schedule, the biggest single offender being about
 * 6-1/2in — 9,579 ft of it on Mesa — which is both exterior types' internal
 * stud-cavity gap of 6.625in being sold as the wall.
 *
 * `wallVectors.ts` has described this failure since it was written ("the
 * envelope was being found and then reported at 6.6in") and attributed it to
 * taking the first partner instead of the widest. That fix was right and it
 * could not reach this case, because here the true partner is not a candidate
 * at all.
 *
 * With the pieces joined first: Mesa Ridge 30.2% -> 20.2% at an unscheduled
 * thickness and the holdout 28.1% -> 25.6%, with found footage up 3,326 ft on
 * Mesa, 517 ft on the holdout and 124 ft on A-101 (87.2% -> 92.9%).
 */
describe("joining the pieces of a face", () => {
  const PT = 9;
  const piece = (fromFt: number, toFt: number, offIn: number): StrokeSegment => ({
    x1: fromFt * PT,
    y1: (offIn / 12) * PT,
    x2: toFt * PT,
    y2: (offIn / 12) * PT,
    width: 0.7,
  });
  const spans = (segments: StrokeSegment[]) =>
    oneFacePerLine(segments, 1 / PT)
      .map((one) => [
        Number((Math.min(one.x1, one.x2) / PT).toFixed(1)),
        Number((Math.max(one.x1, one.x2) / PT).toFixed(1)),
      ])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  it("JOINS THE PIECES AN EXPORTER SPLITS ONE LINE INTO", () => {
    // A CAD export breaks a polyline at every vertex, so one face arrives as a
    // run of touching or near-touching pieces. That is what this is for.
    expect(spans([piece(0, 20, 0), piece(20.5, 50, 0)])).toEqual([[0, 50]]);
  });

  it("DOES NOT BRIDGE A 3FT DOORWAY, and that bound is measured not chosen", () => {
    // Worth stating plainly because the obvious reading of this function is
    // "join a face across its openings", and at this bound it does not. A 3 ft
    // door stays a gap. Swept on the bench:
    //
    //   gap    Mesa found       Mesa not-wall   holdout found    not-wall
    //   8 ft   57,909 (74.2%)   11,735          31,362 (95.0%)   1,442
    //   4 ft   63,624 (81.5%)    5,120          32,004 (96.9%)     644
    //   2 ft   63,779 (81.7%)    5,023          31,894 (96.6%)     610
    //   0.75   63,478 (81.3%)    4,961          31,831 (96.4%)     607
    //
    // 4 ft does bridge a door and is WORSE on Mesa Ridge, which is the set this
    // is tuned on, and worse on thickness too (21.2% against 20.2% of footage
    // at an unscheduled thickness). A building aligns its walls, so the wider
    // the bound the more often it joins two different walls on one grid line
    // instead of two pieces of one face — and 8 ft is a catastrophe.
    expect(spans([piece(0, 20, 0), piece(23, 50, 0)])).toEqual([
      [0, 20],
      [23, 50],
    ]);
  });

  it("LEAVES TWO WALLS ON ONE GRID LINE AS TWO FACES", () => {
    // The bound that makes this safe rather than destructive. Joining across
    // any gap was measured: Mesa Ridge drops to 57,909 ft found with 11,735 ft
    // not on a wall, against 60,453 and 4,432 before — because a building
    // aligns its walls, so collinear-and-far is the normal case, and a joined
    // face pairs with everything along its new length.
    const far = SAME_FACE_GAP_FEET + 2;
    expect(spans([piece(0, 20, 0), piece(20 + far, 50, 0)])).toEqual([
      [0, 20],
      [20 + far, 50],
    ]);
  });

  it("keeps parallel lines at different offsets apart", () => {
    // 0.625in is the gap between an exterior wall's finish and its sheathing —
    // the tightest real pair on the bench's schedule. Merging those would erase
    // the layer the thickness is measured to.
    expect(oneFacePerLine([piece(0, 30, 0), piece(0, 30, 0.625)], 1 / PT)).toHaveLength(2);
  });

  it("KEEPS TWO WALLS 1/8IN APART IN THICKNESS AS TWO WALLS", () => {
    // The bench names this trap in as many words — "A1 and C1 thicknesses 1/8in
    // apart" — and it is what sets `SAME_FACE_OFFSET_FEET`. A 4-7/8in wall and
    // a 4-3/4in wall drawn end to end on one centreline put their faces 1/16in
    // apart. Merge those lines and both walls are gone, replaced by one run at
    // about 4.81in: a thickness neither of them is, over the length of both,
    // which is the wrong assembly billed across the lot.
    //
    // Mutation-tested: at a tolerance of 0.12in this passes with the walls
    // merged, so the bound is doing work no other test here can see.
    const pair = [
      piece(0, 20, 2.4375),
      piece(0, 20, -2.4375),
      piece(20, 40, 2.375),
      piece(20, 40, -2.375),
    ];
    const thicknesses = wallsFromStrokes(pair, { feetPerPoint: 1 / PT })
      .map((wall) => Number((wall.thicknessFeet * 12).toFixed(2)))
      .sort((a, b) => b - a);
    expect(thicknesses, "two wall types were merged into one that is neither").toEqual([4.88, 4.75]);
  });

  it("keeps lines of different directions apart", () => {
    const vertical: StrokeSegment = { x1: 0, y1: 0, x2: 0, y2: 30 * PT, width: 0.7 };
    expect(oneFacePerLine([piece(0, 30, 0), vertical], 1 / PT)).toHaveLength(2);
  });

  it("JOINS PIECES DRAWN IN OPPOSITE DIRECTIONS, which real sheets do", () => {
    // Measured on a holdout sheet: the two faces of one wall came back as
    // x 24.6->152.6 and x 152.6->24.6. A face drawn right-to-left is the same
    // face, so the direction is normalised before anything is compared.
    //
    // THE OFFSET HERE IS NOT ZERO ON PURPOSE. A line's offset is computed as
    // `x1 * uy - y1 * ux`, which for a horizontal line through the origin is 0
    // whichever way it points — so a fixture at y=0 passes with the
    // normalisation deleted, and mutation caught exactly that. Off the origin
    // the two directions give offsets of opposite sign and the pieces land in
    // different groups.
    const backwards = piece(50, 20.5, 6);
    expect(spans([piece(0, 20, 6), backwards])).toEqual([[0, 50]]);
  });

  it("SURVIVES PIECES SHORTER THAN THE 2FT LENGTH FLOOR", () => {
    // Why the join runs BEFORE the length filter. A face chopped into 1 ft
    // pieces has every piece under the floor while the face itself is 30 ft of
    // building, so filtering first throws the wall away before anything can
    // pair it.
    const chopped: StrokeSegment[] = [];
    for (let at = 0; at < 30; at += 1.5) chopped.push(piece(at, at + 1, 0));
    const joined = oneFacePerLine(chopped, 1 / PT);
    expect(joined, "a face chopped into 1 ft pieces did not come back as one").toHaveLength(1);
    // 20 pieces at 1.5 ft centres, each 1 ft long: 0 to 28.5 + 1.
    expect(Math.abs(joined[0].x2 - joined[0].x1) / PT).toBeCloseTo(29.5, 1);
  });

  it("FINDS A WALL WHOSE EVERY PIECE IS UNDER THE LENGTH FLOOR", () => {
    // The ORDER of the join and the 2 ft input filter, end to end through
    // `wallsFromStrokes` rather than through `oneFacePerLine` alone — which is
    // the only way to see it, and mutation proved it: swapping the two left the
    // direct test above green.
    //
    // Both faces of this 30 ft wall arrive as 1 ft pieces, as an export that
    // breaks a polyline at every vertex delivers them. Filter first and every
    // piece is under the floor, so the wall is gone before anything can pair
    // it. Join first and it is a wall.
    const chopped: StrokeSegment[] = [];
    for (let at = 0; at < 30; at += 1.2) {
      chopped.push(piece(at, at + 1, 0));
      chopped.push(piece(at, at + 1, 4.875));
    }
    const walls = wallsFromStrokes(chopped, { feetPerPoint: 1 / PT });
    expect(walls, "a wall drawn in 1 ft pieces was filtered away").toHaveLength(1);
    expect(walls[0].thicknessFeet * 12).toBeCloseTo(4.875, 2);
    expect(walls[0].lengthFeet).toBeGreaterThan(28);
  });

  it("READS A WINDOW-BROKEN EXTERIOR WALL AT ITS OWN THICKNESS", () => {
    // The whole point, end to end. EXT-2 as the bench draws it — planLines
    // 4.0625, 3.4375, -2.5625, -4.0625 — with its outer face arriving in three
    // pieces while everything else runs through whole. The true pair is
    // 8.125in; the stud cavity is 6.625in and the interior lines are whole, so
    // without the join the cavity wins and the wall is priced as the wrong
    // assembly.
    const windowed = [
      piece(0, 12, -4.0625),
      piece(13, 28, -4.0625),
      piece(29, 40, -4.0625),
      piece(0, 40, -2.5625),
      piece(0, 40, 3.4375),
      piece(0, 40, 4.0625),
    ];
    const SCHEDULE = [1.5, 4.75, 4.875, 6.625, 7.625, 8.125, 8.875, 14.5];
    const thicknesses = wallsFromStrokes(windowed, {
      feetPerPoint: 1 / PT,
      knownThicknessesIn: SCHEDULE,
    }).map((wall) => Number((wall.thicknessFeet * 12).toFixed(2)));
    expect(thicknesses, "the stud cavity was sold as the wall").toContain(8.13);
    // 6.625in is ON this schedule deliberately: the schedule cannot rescue this
    // case, so the test cannot be passing because of #751's preference.
    expect(thicknesses).not.toContain(6.63);
  });
});

/**
 * ── THE SERIES RULE HAD NO TEST, AND THAT IS HOW IT COST 22 FEET ──
 *
 * `inAHatchSeries` is the discriminator between "two faces of a wall" and
 * "three strokes of a fill", and the whole suite exercised it only through a
 * thickness case ("two lines a HATCH apart"), which asks a different question.
 * So a change to the series rule could be made with every test green.
 *
 * At 1/8" = 1'-0" with `feetPerPoint` 1/9: a 4.5in partition is 3.375pt
 * between faces, and a foot of building is 9pt.
 */
describe("a series is strokes that look alike, not merely strokes nearby", () => {
  const STEP = 3.375; // 4.5in between the faces of a partition
  const LONG = 17.5 * 9; // a 17.5 ft wall

  it("STILL REFUSES GENUINE HATCHING — the thing this rule is for", () => {
    // Machine-generated fill: a constant pitch, and every stroke the same
    // length as its neighbours. Nothing here is a wall and nothing may be
    // reported as one.
    const fill = Array.from({ length: 6 }, (_, i) => h(100, 500 + i * STEP, LONG));
    expect(wallsFromStrokes(fill, EIGHTH), "hatching was sold as wall").toEqual([]);
  });

  it("KEEPS A WALL WITH A SHORT FIXTURE LINE BESIDE IT — S09's 22 ft", () => {
    // The hall's south partition, and a 2.5 ft fixture in the room above it.
    // The fixture sits 0.70 ft away against a 0.375 ft step — 1.84 of them,
    // which rounds to 2 inside `SERIES_PITCH_TOLERANCE`, so the pitch test
    // alone reads three strokes at a constant pitch and throws the wall away.
    const faces = [h(100, 500, LONG), h(100, 500 + STEP, LONG)];
    const fixture = h(140, 500 - 1.84 * STEP, 2.5 * 9);
    const walls = wallsFromStrokes([...faces, fixture], EIGHTH);
    expect(walls, "a 2.5 ft fixture suppressed a 17.5 ft wall").toHaveLength(1);
    expect(walls[0].thicknessFeet * 12).toBeCloseTo(4.5, 1);
  });

  it("and finds that wall identically when the fixture is not there", () => {
    // The control. Without it the case above proves only that SOMETHING was
    // found, not that the fixture stopped mattering.
    const walls = wallsFromStrokes([h(100, 500, LONG), h(100, 500 + STEP, LONG)], EIGHTH);
    expect(walls).toHaveLength(1);
    expect(walls[0].lengthFeet).toBeCloseTo(17.5, 1);
  });

  it("KEEPS A WALL WITH A DIMENSION STRING BELOW IT — S17's whole south side", () => {
    // The long end of the same defect. A dimension string runs the full side
    // of a building, parallel to the wall it measures, at a round offset — and
    // a round offset lands on a whole number of steps often enough to matter.
    //
    // S17's south wall is 300mm, so its faces are 0.98 ft apart, and its
    // dimension line sits 1.88 ft below the outer face: 1.918 steps, which is
    // 0.08 from a whole number and well inside the pitch tolerance. The wall
    // was discarded, and the GLAZING LINES of its two windows then paired with
    // each other — the sheet reported the windows as the wall, 16.4 ft of 49.2
    // at the wrong thickness.
    const WALL = 0.98 * 9; // a 300mm wall's two faces, in points at 1/8"
    const faces = [h(100, 500, 17.6 * 9), h(100, 500 + WALL, 17.6 * 9)];
    const dimension = h(60, 500 - 1.918 * WALL, 50 * 9);
    const walls = wallsFromStrokes([...faces, dimension], EIGHTH);
    expect(walls, "a dimension string suppressed the wall it measures").toHaveLength(1);
    expect(walls[0].thicknessFeet * 12).toBeCloseTo(11.8, 0);
  });

  it("a dimension string is not a series member, however close its pitch", () => {
    // The control for the case above: without the dimension line the wall is
    // found identically, so the assertion is about the line and not about the
    // faces happening to pair.
    const WALL = 0.98 * 9;
    const walls = wallsFromStrokes([h(100, 500, 17.6 * 9), h(100, 500 + WALL, 17.6 * 9)], EIGHTH);
    expect(walls).toHaveLength(1);
    expect(walls[0].lengthFeet).toBeCloseTo(17.6, 1);
  });

  it("A FIVE-STROKE FILL STILL LEAKS ONE WALL, and that is OLDER than these rules", () => {
    // Six strokes are refused outright; five leave one pair standing. The
    // cause is the pairer taking every OTHER stroke: such a pair has one
    // neighbour at a whole number of its own steps and, in a five-stroke
    // fill, only TWO at a half step — one short of what this file requires
    // before calling a half-pitch pattern a fill.
    //
    // MEASURED, not assumed: requiring two instead of three closes this and
    // costs six walls on the bench, 111 missed to 117, for no gain on the
    // twenty. So the leak is left where it was found and recorded here.
    //
    // This case is UNCHANGED by the member-count and length rules around it —
    // proved by setting each of their constants to its disabling value, where
    // this stayed at one wall throughout.
    const five = Array.from({ length: 5 }, (_, i) => h(100, 500 + i * STEP, LONG));
    expect(wallsFromStrokes(five, EIGHTH), "a five-stroke fill now behaves differently").toHaveLength(1);
    const six = Array.from({ length: 6 }, (_, i) => h(100, 500 + i * STEP, LONG));
    expect(wallsFromStrokes(six, EIGHTH), "a six-stroke fill leaked a wall").toEqual([]);
  });
});
