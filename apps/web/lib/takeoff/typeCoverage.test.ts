import { describe, expect, it } from "vitest";
import { coverageSentence, sheetTypeCoverage } from "./typeCoverage";
import type { WallCandidate } from "./wallVectors";

/** A run of a given length; only the length and identity matter here. */
function run(lengthFeet: number): WallCandidate {
  return {
    x1: 0,
    y1: 0,
    x2: lengthFeet / 100,
    y2: 0,
    lengthFeet,
    thicknessFeet: 0.4,
  } as WallCandidate;
}

describe("how much of a sheet has a wall type", () => {
  it("splits the footage three ways and the three sum to the total", () => {
    const a = run(100);
    const b = run(50);
    const c = run(25);
    const got = sheetTypeCoverage({
      walls: [a, b, c],
      tagged: new Map([[a, "A1"]]),
      note: null,
    });
    expect(got.totalFeet).toBe(175);
    expect(got.taggedFeet).toBe(100);
    expect(got.notedFeet).toBe(0);
    expect(got.unknownFeet).toBe(75);
    expect(got.taggedFeet + got.notedFeet + got.unknownFeet).toBe(got.totalFeet);
  });

  it("a U.N.O. note claims the untagged walls and NOT the tagged ones", () => {
    // "Unless noted otherwise" means the note is the default and the tag is
    // the exception. Letting the note win would silently retype the walls the
    // architect bothered to label.
    const tagged = run(100);
    const untagged = run(60);
    const got = sheetTypeCoverage({
      walls: [tagged, untagged],
      tagged: new Map([[tagged, "A2"]]),
      note: { code: "A1", note: "ALL PARTITIONS TYPE A1 U.N.O." },
    });
    expect(got.taggedFeet).toBe(100);
    expect(got.notedFeet).toBe(60);
    expect(got.unknownFeet).toBe(0);
    expect(got.byType.find((t) => t.source === "tag")?.code).toBe("A2");
    expect(got.byType.find((t) => t.source === "note")?.code).toBe("A1");
  });

  it("with no tags and no note, the whole sheet is unknown", () => {
    // The honest answer on most sheets, and the one a screen must not round
    // away: an architect tags representative walls, not every wall.
    const got = sheetTypeCoverage({
      walls: [run(80), run(40)],
      tagged: new Map(),
      note: null,
    });
    expect(got.unknownFeet).toBe(120);
    expect(got.unknownShare).toBe(1);
    expect(got.byType).toHaveLength(1);
    expect(got.byType[0].code).toBeNull();
    expect(got.byType[0].evidence).toBeNull();
  });

  it("keeps the evidence for every typed bucket", () => {
    const tagged = run(10);
    const untagged = run(10);
    const got = sheetTypeCoverage({
      walls: [tagged, untagged],
      tagged: new Map([[tagged, "C1"]]),
      note: { code: "A1", note: "ALL PARTITIONS TYPE A1 U.N.O." },
    });
    expect(got.byType.find((t) => t.source === "tag")?.evidence).toBe("tagged C1");
    expect(got.byType.find((t) => t.source === "note")?.evidence).toBe(
      "ALL PARTITIONS TYPE A1 U.N.O.",
    );
  });

  it("never types a wall by its thickness", () => {
    // The rule this file exists to hold. Every run here is the same thickness
    // and only one carries a tag; the rest must stay unknown however much
    // they look like it.
    const walls = [run(10), run(10), run(10)];
    const got = sheetTypeCoverage({
      walls,
      tagged: new Map([[walls[0], "A1"]]),
      note: null,
    });
    expect(got.taggedFeet).toBe(10);
    expect(got.unknownFeet).toBe(20);
  });

  it("ignores a run with no length rather than counting it as unknown", () => {
    const got = sheetTypeCoverage({ walls: [run(0), run(5)], tagged: new Map(), note: null });
    expect(got.totalFeet).toBe(5);
    expect(got.byType.reduce((n, t) => n + t.runs, 0)).toBe(1);
  });

  it("says nothing confident about an empty sheet", () => {
    const got = sheetTypeCoverage({ walls: [], tagged: new Map(), note: null });
    expect(got.totalFeet).toBe(0);
    expect(got.unknownShare).toBe(0);
    expect(coverageSentence(got)).toBe("No wall measured on this sheet.");
  });
});

describe("the sentence a person reads", () => {
  it("always names the untyped footage, even when it is zero", () => {
    // A reader shown two figures and no third cannot tell whether the rest is
    // typed or simply missing from the sentence.
    const got = sheetTypeCoverage({
      walls: [run(100)],
      tagged: new Map(),
      note: { code: "A1", note: "ALL PARTITIONS TYPE A1 U.N.O." },
    });
    expect(coverageSentence(got)).toContain("0 ft with no type");
  });

  it("reads as an estimator would say it", () => {
    const a = run(120);
    const got = sheetTypeCoverage({ walls: [a, run(80)], tagged: new Map([[a, "A1"]]), note: null });
    expect(coverageSentence(got)).toBe(
      "200 ft of wall — 120 ft from tags on the drawing, 80 ft with no type.",
    );
  });
});
