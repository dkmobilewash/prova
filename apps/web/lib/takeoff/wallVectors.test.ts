import { describe, expect, it } from "vitest";
import { wallFromPair, wallsFromStrokes, type StrokeSegment, type WallFinderOptions,
  clusterByThickness,
  CLUSTER_INCHES,
  wallsInTheBuilding,
  SAME_BUILDING_FEET,
  NOT_A_BOX,
  wallsNotLettering,
  LETTER_FEET,
  heavierThanHatching,
  type WallCandidate,
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

  it("finds an 18in shaft wall, the thickest thing still a wall", () => {
    const wall = wallFromPair(h(100, 500, 180), h(100, 500 + 1.5 * 9, 180), EIGHTH);
    expect(wall).not.toBeNull();
    expect(wall?.thicknessFeet).toBeCloseTo(1.5, 1);
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

  it("REFUSES A SHEET WHOSE BIGGEST GROUP IS A BOX, rather than offering it", () => {
    // Found by looking at a real roof/equipment sheet: the plan yielded almost
    // no wall, so the biggest group was the TITLE BLOCK — four runs, 64ft, a
    // rectangle in the corner offered to an estimator as the walls of a
    // building. The numbers looked unremarkable; only the picture showed it.
    const titleBlock = [at(300, 0, 340, 0), at(340, 0, 340, 20), at(300, 20, 340, 20), at(300, 0, 300, 20)];
    expect(wallsInTheBuilding(titleBlock, FOOT)).toEqual([]);
  });

  it("still returns a real plan, which is an order of magnitude bigger", () => {
    // Real floor plans measured here returned 38, 58, 68, 230, 295 and 453
    // runs. The gap between a box and a plan is not a margin, so this does not
    // have to be a finely judged number to sit inside it.
    const plan = Array.from({ length: NOT_A_BOX + 2 }, (_, i) => at(0, i * 10, 40, i * 10));
    expect(wallsInTheBuilding(plan, FOOT)).toHaveLength(NOT_A_BOX + 2);
  });

  it("uses a distance wide enough for a corridor and far short of a title block", () => {
    // Measured by sweeping and looking: at 6ft a real plan broke into 46
    // pieces; 12 kept 132 runs, 20 kept 178, 30 kept 186. It plateaus at 20.
    expect(SAME_BUILDING_FEET).toBeGreaterThanOrEqual(12);
    expect(SAME_BUILDING_FEET).toBeLessThan(60);
  });
});

/**
 * THE PEN, WHICH SAYS WHAT THE GEOMETRY CANNOT.
 *
 * A slab joint and a partition are both two parallel lines a wall-thickness
 * apart; no test of their shape separates them, and they are both inside the
 * building so position cannot either. Five slab joints ran the length of an
 * apparatus bay on a real sheet and survived every other filter.
 *
 * CAD draws walls heavy and patterns thin. One real sheet carried 112,547
 * strokes at a handful of discrete pens with 0.24pt accounting for 86% of them,
 * and colouring the sheet by pen put the walls in the heavy band and the bay
 * joints in the thin one.
 */
const pen = (width: number | undefined, x1 = 0, y1 = 0, x2 = 10, y2 = 0): StrokeSegment => ({
  x1,
  y1,
  x2,
  y2,
  ...(width === undefined ? {} : { width }),
});

describe("dropping the hatching pen", () => {
  it("keeps the heavy line work and drops the commonest thin pen", () => {
    const sheet = [
      ...Array.from({ length: 50 }, () => pen(0.24)), // hatching, text, patterns
      ...Array.from({ length: 10 }, () => pen(1.44)), // the wall work
    ];
    const kept = heavierThanHatching(sheet);
    expect(kept).toHaveLength(10);
    expect(kept.every((s) => s.width === 1.44)).toBe(true);
  });

  it("takes the threshold from THIS sheet, not from a constant", () => {
    // A practice that draws everything at half weight still works: here the
    // thin pen is 0.1 and the wall pen 0.3, both far below the numbers on the
    // sheet above.
    const sheet = [...Array.from({ length: 40 }, () => pen(0.1)), ...Array.from({ length: 12 }, () => pen(0.3))];
    const kept = heavierThanHatching(sheet);
    expect(kept).toHaveLength(12);
    expect(kept.every((s) => s.width === 0.3)).toBe(true);
  });

  it("keeps everything when MOST strokes carry no width", () => {
    // An export that omits the pen on most of its content. Filtering on a
    // signal that is mostly absent would throw away the drawing.
    //
    // THE FIRST VERSION OF THIS FIXTURE PROVED NOTHING: 20 widthless strokes
    // and no others meant the heavy band was empty either way, so the other
    // fallback caught it and removing this guard stayed GREEN. It needs a heavy
    // band big enough to survive that fallback, so the guard under test is the
    // only thing standing between the sheet and a wrong answer.
    const sheet = [
      ...Array.from({ length: 70 }, () => pen(undefined)),
      ...Array.from({ length: 20 }, () => pen(0.24)),
      ...Array.from({ length: 10 }, () => pen(1)),
    ];
    expect(heavierThanHatching(sheet)).toHaveLength(100);
  });

  it("keeps everything when the sheet is drawn at ONE weight", () => {
    // Nothing is above a single pen's own mode, so this is the empty-band
    // fallback doing the work — there is deliberately no separate guard for it.
    const sheet = Array.from({ length: 30 }, () => pen(0.5));
    expect(heavierThanHatching(sheet)).toHaveLength(30);
  });

  it("falls back rather than returning a drawing with no walls on it", () => {
    // If the heavy band is nearly empty the assumption did not hold on this
    // sheet, and handing back three strokes is worse than handing back all of
    // them — the estimator can see a wrong line, not an absent feature.
    const sheet = [...Array.from({ length: 60 }, () => pen(0.24)), pen(2), pen(2)];
    expect(heavierThanHatching(sheet)).toHaveLength(62);
  });

  it("does not drop a wall drawn at the SAME weight as another heavy thing", () => {
    // The filter is one-sided on purpose: it removes the thinnest band, not
    // everything that is not the heaviest. A 0.84 wall survives beside 1.44
    // line work.
    const sheet = [
      ...Array.from({ length: 40 }, () => pen(0.24)),
      ...Array.from({ length: 6 }, () => pen(0.84)),
      ...Array.from({ length: 6 }, () => pen(1.44)),
    ];
    expect(heavierThanHatching(sheet)).toHaveLength(12);
  });

  it("returns nothing for nothing", () => {
    expect(heavierThanHatching([])).toEqual([]);
  });
});

/**
 * LETTERING IS NOT A WALL, though its shape says otherwise.
 *
 * Reported from a real sheet by somebody looking at the drawing: two entire
 * groups were text. 64 runs at 14-1/2" on dimension strings — `4'-0"`, `10'-0"`
 * — and 15 at 13-1/2" entirely on room-number tags, with not one wall among
 * them. 79 of 205 runs.
 *
 * When lettering is saved as line work the two sides of a `0` are parallel, a
 * few inches apart at drawing scale, and the right length. Nothing about their
 * SHAPE says they are letters, and the pen does not help either — a title is
 * drawn heavy. The text layer says it, and this app already extracts it.
 */
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
