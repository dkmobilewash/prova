import { describe, expect, it } from "vitest";
import {
  wallTypeTags,
  tagByRun,
  namesForClusters,
  tagSentence,
  TAG_REACH_FEET,
  TAG_CLEAR_MARGIN,
  type WallTypeTag,
} from "./wallTags";
import type { WallCandidate, WallCluster } from "./wallVectors";

/**
 * MEASURED ON THE ANSWER KEY'S OWN SHEETS, and the fixtures are its numbers.
 *
 * Page 1: 41 tags, 202 runs, every tag 0.5-2.2 ft from its wall with the
 * runner-up past 4 ft, ZERO orphans. The distinct names are
 * `EXT-1 EXT-2 A1 A2 B1 C1 D1`, which is exactly the key's assembly list.
 *
 * `A1` measured 4.75, 4.75, 4.75 and 5.00 inches across four pages — the tags
 * are independent of the geometry, so that is the drawing confirming the
 * thickness measurement for the dominant partition.
 *
 * The scale throughout is 1/8in = 1'-0" on a 36in sheet, so one page-width unit
 * is 288 feet. A foot is 1/288 of a unit.
 */

/** Page-width units per foot at the key's own scale. */
const FOOT = 1 / 288;
const feetPerUnit = 288;

const wall = (over: Partial<WallCandidate> = {}): WallCandidate =>
  ({
    x1: 0.2,
    y1: 0.5,
    x2: 0.3,
    y2: 0.5,
    lengthFeet: 28.8,
    thicknessFeet: 4.75 / 12,
    ...over,
  }) as WallCandidate;

const tag = (name: string, x: number, y: number): WallTypeTag => ({ name, x, y });

const item = (str: string, x = 100, y = 100) => ({ str, x, y, width: 20, height: 7 });

describe("finding the tags on a sheet", () => {
  it("reads the names the key's own sheets carry", () => {
    const found = wallTypeTags(
      [item("EXT-1"), item("EXT-2"), item("A1"), item("A2"), item("B1"), item("C1"), item("D1")],
      2592,
    );
    expect(found.map((t) => t.name)).toEqual(["EXT-1", "EXT-2", "A1", "A2", "B1", "C1", "D1"]);
  });

  it("accepts the spellings architects actually use", () => {
    const found = wallTypeTags([item("EXT 2"), item("ext-1"), item("C1A"), item("P-12")], 2592);
    expect(found.map((t) => t.name)).toEqual(["EXT 2", "EXT-1", "C1A", "P-12"]);
  });

  it("REFUSES A ROOM OR DOOR NUMBER, which is most of the text on a plan", () => {
    // These are everywhere on a floor plan and would each invent an assembly.
    expect(wallTypeTags([item("101"), item("150A"), item("116"), item("3'-0\"")], 2592)).toEqual([]);
  });

  it("refuses a column grid bubble, which is a bare letter or digit", () => {
    expect(wallTypeTags([item("A"), item("B"), item("1"), item("12")], 2592)).toEqual([]);
  });

  it("refuses a fragment of a sentence that merely contains a tag", () => {
    // Anchored at both ends on purpose: a note mentioning a type must not
    // become a tag sitting at the note's own coordinates.
    expect(wallTypeTags([item("SEE A1 FOR DETAIL"), item("TYPE A1:")], 2592)).toEqual([]);
  });

  it("puts the tag at the CENTRE of its text, not its corner", () => {
    const found = wallTypeTags([{ str: "A1", x: 100, y: 200, width: 20, height: 8 }], 2592);
    expect(found[0].x).toBeCloseTo(110 / 2592, 6);
    expect(found[0].y).toBeCloseTo(204 / 2592, 6);
  });

  it("returns nothing rather than throwing with no page width", () => {
    expect(wallTypeTags([item("A1")], 0)).toEqual([]);
  });
});

describe("pairing a tag with the wall it labels", () => {
  it("CLAIMS THE NEAR WALL at the distances the real sheets show", () => {
    // Measured: a real tag sits 0.5-2.2 ft from its run, runner-up past 4.
    const near = wall({ y1: 0.5, y2: 0.5 });
    const far = wall({ y1: 0.5 + 20 * FOOT, y2: 0.5 + 20 * FOOT });
    const paired = tagByRun([near, far], [tag("A1", 0.25, 0.5 + 1.2 * FOOT)], feetPerUnit);
    expect(paired.get(near)).toBe("A1");
    expect(paired.get(far)).toBeUndefined();
  });

  it("MEASURES TO THE SEGMENT, not its midpoint — or every long wall orphans", () => {
    // A tag beside the END of a 100ft wall is 1ft from the wall and 50ft from
    // its centre. Using the centre would drop it.
    const long = wall({ x1: 0.1, x2: 0.1 + 100 * FOOT, lengthFeet: 100 });
    const paired = tagByRun([long], [tag("EXT-1", 0.1 + 2 * FOOT, 0.5 + 1 * FOOT)], feetPerUnit);
    expect(paired.get(long)).toBe("EXT-1");
  });

  it("DROPS AN AMBIGUOUS TAG rather than guessing between two walls", () => {
    // 24% of tags on the real pages are this: two faces of one wall, or two
    // walls at a corner. A group labelled with the wrong assembly name is worse
    // than one with no name, because the name is what gets mapped to a
    // catalogue.
    const a = wall({ y1: 0.5, y2: 0.5 });
    const b = wall({ y1: 0.5 + 2 * FOOT, y2: 0.5 + 2 * FOOT });
    const paired = tagByRun([a, b], [tag("A1", 0.25, 0.5 + 1 * FOOT)], feetPerUnit);
    expect(paired.size).toBe(0);
  });

  it("drops a tag with nothing within reach", () => {
    const away = wall({ y1: 0.5, y2: 0.5 });
    const paired = tagByRun([away], [tag("A1", 0.25, 0.5 + 10 * FOOT)], feetPerUnit);
    expect(paired.size).toBe(0);
    expect(TAG_REACH_FEET).toBe(4);
  });

  it("GIVES A CONTESTED WALL TO THE NEARER TAG, not the earlier one", () => {
    const only = wall({ y1: 0.5, y2: 0.5 });
    const paired = tagByRun(
      [only, wall({ y1: 0.5 + 30 * FOOT, y2: 0.5 + 30 * FOOT })],
      // EXT-1 listed first but further away.
      [tag("EXT-1", 0.25, 0.5 + 2 * FOOT), tag("A1", 0.25, 0.5 + 0.5 * FOOT)],
      feetPerUnit,
    );
    expect(paired.get(only)).toBe("A1");
  });

  it("never claims one wall twice", () => {
    const only = wall();
    const paired = tagByRun(
      [only, wall({ y1: 0.9, y2: 0.9 })],
      [tag("A1", 0.25, 0.5 + 0.5 * FOOT), tag("A2", 0.25, 0.5 + 0.6 * FOOT)],
      feetPerUnit,
    );
    expect([...paired.values()]).toHaveLength(1);
  });

  it("returns nothing rather than throwing on empty input", () => {
    expect(tagByRun([], [tag("A1", 0.2, 0.5)], feetPerUnit).size).toBe(0);
    expect(tagByRun([wall()], [], feetPerUnit).size).toBe(0);
    expect(tagByRun([wall()], [tag("A1", 0.2, 0.5)], 0).size).toBe(0);
    expect(TAG_CLEAR_MARGIN).toBe(2);
  });
});

describe("naming the thickness groups", () => {
  const near = (name: string, w: WallCandidate) => tag(name, w.x1 - 1 * FOOT, w.y1 + 0.5 * FOOT);

  it("NAMES A GROUP with the assembly the drawing tags inside it", () => {
    const a = wall({ x1: 0.2, y1: 0.3, x2: 0.4, y2: 0.3 });
    const b = wall({ x1: 0.2, y1: 0.7, x2: 0.4, y2: 0.7 });
    const clusters: WallCluster[] = [{ inches: 4.75, runs: [a, b], feet: 57.6 }];
    const names = namesForClusters(clusters, [a, b], [near("A1", a), near("A1", b)], feetPerUnit);
    expect(names).toEqual([["A1"]]);
  });

  it("LISTS SEVERAL, biggest footage first — A1 and A2 share 4.75in on the key", () => {
    // The measured case that killed grouping BY tag and is fine for naming: two
    // different assemblies at one thickness.
    const big = wall({ x1: 0.2, y1: 0.3, x2: 0.4, y2: 0.3, lengthFeet: 250 });
    const small = wall({ x1: 0.2, y1: 0.7, x2: 0.3, y2: 0.7, lengthFeet: 140 });
    const clusters: WallCluster[] = [{ inches: 4.75, runs: [big, small], feet: 390 }];
    const names = namesForClusters(clusters, [big, small], [near("A2", small), near("A1", big)], feetPerUnit);
    expect(names).toEqual([["A1", "A2"]]);
  });

  it("GIVES AN EMPTY LIST for a group the drawing never tagged, which is usual", () => {
    // Only 25-43% of footage is tagged. An empty list means "the drawing did
    // not say", and the caller must not read it as an error.
    const untagged = wall({ x1: 0.2, y1: 0.3, x2: 0.4, y2: 0.3 });
    const clusters: WallCluster[] = [{ inches: 6.6, runs: [untagged], feet: 28.8 }];
    expect(namesForClusters(clusters, [untagged], [], feetPerUnit)).toEqual([[]]);
  });

  it("keeps one entry per group, in the groups' own order", () => {
    const a = wall({ x1: 0.2, y1: 0.3, x2: 0.4, y2: 0.3 });
    const b = wall({ x1: 0.2, y1: 0.7, x2: 0.4, y2: 0.7, thicknessFeet: 8.875 / 12 });
    const clusters: WallCluster[] = [
      { inches: 4.75, runs: [a], feet: 28.8 },
      { inches: 8.875, runs: [b], feet: 28.8 },
    ];
    const names = namesForClusters(clusters, [a, b], [near("A1", a), near("EXT-1", b)], feetPerUnit);
    expect(names).toEqual([["A1"], ["EXT-1"]]);
  });

  it("does not leak a tag into a group whose runs it does not label", () => {
    const tagged = wall({ x1: 0.2, y1: 0.3, x2: 0.4, y2: 0.3 });
    const other = wall({ x1: 0.2, y1: 0.7, x2: 0.4, y2: 0.7, thicknessFeet: 6.6 / 12 });
    const clusters: WallCluster[] = [
      { inches: 4.75, runs: [tagged], feet: 28.8 },
      { inches: 6.6, runs: [other], feet: 28.8 },
    ];
    expect(namesForClusters(clusters, [tagged, other], [near("A1", tagged)], feetPerUnit)).toEqual([
      ["A1"],
      [],
    ]);
  });
});

describe("what the panel says", () => {
  it("names one assembly", () => {
    expect(tagSentence(["A1"])).toBe("The drawing tags this A1.");
  });

  it("names two", () => {
    expect(tagSentence(["A1", "A2"])).toBe("The drawing tags these A1 and A2.");
  });

  it("names more than two", () => {
    expect(tagSentence(["A1", "A2", "C1"])).toBe("The drawing tags these A1, A2 and C1.");
  });

  it("SAYS NOTHING when the drawing named nothing", () => {
    // Null rather than a hedge: a group with no tagged run is the ordinary
    // case, and a reassuring phrase on every one would bury the real names.
    expect(tagSentence([])).toBeNull();
  });
});

/**
 * ── THE TAG'S OWN NAME IS EVIDENCE ABOUT WHICH RUN IT MEANS ──
 *
 * Proximity alone picks the wrong wall where two run side by side. Measured on
 * School-01's A-101 by replaying the real chain against the real file, with the
 * distances the code itself computes:
 *
 *   EXT-1 at (0.805,0.282) — 4-7/8" at 0.47 ft WON; 8-7/8" at 2.32 ft lost
 *   B1    at (0.641,0.203) — 6-3/4"  at 1.21 ft WON; 7-1/4" at 5.84 ft lost
 *   B1    at (0.656,0.196) — 7-1/4"  at 1.71 ft was NEAREST and was DROPPED,
 *                            because 6-3/4" at 3.34 ft failed the clear margin
 *
 * In each, the company has a wall type of that exact name with a thickness, and
 * exactly one candidate matches it. The drawing was not ambiguous; the reader
 * was throwing away the half of the evidence that settles it.
 *
 * THE SECOND CASE BELOW IS THE ONE THAT MATTERS MOST, and it is a regression
 * the first draft of this fix shipped: asking "does a fitting run exist"
 * ANYWHERE on the sheet instead of WITHIN REACH dropped four tags that were
 * already right. The perimeter EXT tags sit beside 6-5/8" of drawn framing
 * while the schedule totals 8-7/8" with sheathing and cladding, so the only
 * fitting run is most of a building away — and falling back to nothing deleted
 * the drawing-vs-schedule disagreement from the screen. Caught by the probe,
 * not by reading it.
 */
describe("a tag's name narrowing which run it claims", () => {
  const typed = (code: string, thicknessIn: number) => ({
    id: code,
    code,
    name: code,
    hasParts: true,
    thicknessIn,
  });

  it("PREFERS THE RUN ITS NAME FITS over a nearer one that does not", () => {
    // The EXT-1 case: a 4-7/8" run almost under the tag, the real 8-7/8" wall
    // a little further off.
    const near = wall({ thicknessFeet: 4.875 / 12, y1: 0.5, y2: 0.5 });
    const fits = wall({ thicknessFeet: 8.875 / 12, y1: 0.5 + 2 * FOOT, y2: 0.5 + 2 * FOOT });
    const got = tagByRun([near, fits], [tag("EXT-1", 0.25, 0.5)], feetPerUnit, [
      typed("EXT-1", 8.875),
    ]);
    expect(got.get(fits), "the tag went to the nearer run its name rules out").toBe("EXT-1");
    expect(got.has(near)).toBe(false);
  });

  it("FALLS BACK TO THE NEAREST RUN when nothing within reach fits the name", () => {
    // The perimeter case. The plan draws EXT-1 as 6-5/8" of framing; the only
    // 8-7/8" run on the sheet is far away. The tag must still claim the wall
    // beside it, so the disagreement reaches the screen.
    const beside = wall({ thicknessFeet: 6.625 / 12, y1: 0.5, y2: 0.5 });
    const farAway = wall({
      thicknessFeet: 8.875 / 12,
      x1: 0.9, x2: 0.95, y1: 0.9, y2: 0.9,
    });
    const got = tagByRun([beside, farAway], [tag("EXT-1", 0.25, 0.5)], feetPerUnit, [
      typed("EXT-1", 8.875),
    ]);
    expect(got.get(beside), "the wall beside the tag lost its name").toBe("EXT-1");
  });

  it("still requires a fitting run to be WITHIN REACH", () => {
    const fits = wall({
      thicknessFeet: 8.875 / 12,
      y1: 0.5 + (TAG_REACH_FEET + 2) * FOOT,
      y2: 0.5 + (TAG_REACH_FEET + 2) * FOOT,
    });
    const got = tagByRun([fits], [tag("EXT-1", 0.25, 0.5)], feetPerUnit, [typed("EXT-1", 8.875)]);
    expect(got.size, "a fitting run out of reach was claimed anyway").toBe(0);
  });

  it("still requires a fitting run to beat its FITTING rivals by the margin", () => {
    // Two runs of the right thickness, equally close: the drawing has not said
    // which, and a name cannot break that tie.
    const a = wall({ thicknessFeet: 8.875 / 12, y1: 0.5 + FOOT, y2: 0.5 + FOOT });
    const b = wall({ thicknessFeet: 8.875 / 12, y1: 0.5 - FOOT, y2: 0.5 - FOOT });
    const got = tagByRun([a, b], [tag("EXT-1", 0.25, 0.5)], feetPerUnit, [typed("EXT-1", 8.875)]);
    expect(got.size).toBe(0);
    expect(TAG_CLEAR_MARGIN).toBeGreaterThan(1);
  });

  it("IGNORES A TYPE WITH NO THICKNESS, which is most of an old library", () => {
    // `thicknessIn` is nullable and stays nullable — a type typed in before that
    // column existed cannot narrow anything, and must not narrow to nothing.
    const near = wall({ thicknessFeet: 4.875 / 12, y1: 0.5, y2: 0.5 });
    const got = tagByRun([near], [tag("EXT-1", 0.25, 0.5)], feetPerUnit, [
      { id: "x", code: "EXT-1", name: "EXT-1", hasParts: true, thicknessIn: null },
    ]);
    expect(got.get(near)).toBe("EXT-1");
  });

  it("BEHAVES EXACTLY AS BEFORE when no wall types are passed at all", () => {
    // The parameter is optional and every existing caller predates it.
    const near = wall({ thicknessFeet: 4.875 / 12, y1: 0.5, y2: 0.5 });
    const fits = wall({ thicknessFeet: 8.875 / 12, y1: 0.5 + 2 * FOOT, y2: 0.5 + 2 * FOOT });
    const got = tagByRun([near, fits], [tag("EXT-1", 0.25, 0.5)], feetPerUnit);
    expect(got.get(near), "the old nearest-wins rule changed without types").toBe("EXT-1");
  });

  it("matches the name the way the catalogue does, not by string equality", () => {
    // `EXT 2` on the drawing and `EXT-2` in the library are the same assembly —
    // `sameDesignation` already knows that and this must go through it.
    const fits = wall({ thicknessFeet: 8.125 / 12, y1: 0.5 + 2 * FOOT, y2: 0.5 + 2 * FOOT });
    const near = wall({ thicknessFeet: 4.875 / 12, y1: 0.5, y2: 0.5 });
    const got = tagByRun([near, fits], [tag("EXT 2", 0.25, 0.5)], feetPerUnit, [
      typed("EXT-2", 8.125),
    ]);
    expect(got.get(fits)).toBe("EXT 2");
  });
});
