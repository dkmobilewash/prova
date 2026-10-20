import { describe, expect, it } from "vitest";
import { legendPages, type PageForLegend } from "./legendPages";

/**
 * The fixtures are shaped like the real sets measured on 2026-10-20: Camp Bow
 * Wow's cover sheet lists "PARTITION TYPES" in its drawing index, its A130
 * both says so and describes assemblies, and its wall-section sheets describe
 * assemblies while their titles say nothing.
 */
const assembly = (n: number) =>
  Array.from({ length: n }, (_, i) => `${i % 2 === 0 ? '3 5/8" MTL. STUD AT 16" O.C.' : '5/8" GYP. BD. EACH SIDE'}`);

const page = (over: Partial<PageForLegend> & { page: number }): PageForLegend => ({
  title: null,
  lines: [],
  ...over,
});

describe("finding the sheet that defines the wall types", () => {
  it("takes a sheet that says it is a legend AND describes assemblies", () => {
    const got = legendPages([
      page({ page: 16, title: "PARTITION TYPES", lines: assembly(20) }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].page).toBe(16);
    expect(got[0].rank).toBe(0);
    expect(got[0].why).toContain("PARTITION TYPE");
  });

  it("demotes a cover sheet whose INDEX merely names the legend", () => {
    // THE CASE THAT COST A MODEL CALL TO LEARN. Camp Bow Wow's page 1 is the
    // cover; its drawing index lists "PARTITION TYPES" as the name of sheet
    // A130, so the title test fired on a sheet with no assembly on it. The
    // model read it and reported zero types, correctly and for 5.3 cents.
    const got = legendPages([
      page({ page: 1, title: "PARTITION TYPES", lines: ["A130 | PARTITION TYPES", "A101 | FLOOR PLAN"] }),
      page({ page: 16, title: "PARTITION TYPES", lines: assembly(20) }),
    ]);
    expect(got[0].page, "the real legend comes first").toBe(16);
    const cover = got.find((c) => c.page === 1);
    expect(cover?.rank).toBe(3);
    expect(cover?.why).toContain("index entry");
  });

  it("never drops the named-but-empty sheet, because a failed text layer looks the same", () => {
    const got = legendPages([page({ page: 7, title: "WALL TYPES", lines: [] })]);
    expect(got).toHaveLength(1);
    expect(got[0].rank).toBe(3);
  });

  it("finds a legend whose title says nothing, from its content", () => {
    const got = legendPages([page({ page: 30, title: null, lines: assembly(20) })]);
    expect(got).toHaveLength(1);
    expect(got[0].rank).toBe(2);
    expect(got[0].why).toContain("the title does not say");
  });

  it("ignores a sheet with a couple of assembly words", () => {
    // A floor plan carries the odd note naming a stud. That is not a legend,
    // and a bar low enough to admit it admits every sheet in the set.
    expect(legendPages([page({ page: 9, lines: assembly(4) })])).toHaveLength(0);
  });

  it("puts a titled legend ahead of a wall-section sheet with more assembly text", () => {
    // Camp Bow Wow p28 has 74 assembly lines and is a building section; A130
    // has 21 and is the legend. Counting alone gets this backwards.
    const got = legendPages([
      page({ page: 28, title: null, lines: assembly(74) }),
      page({ page: 16, title: "PARTITION TYPES", lines: assembly(21) }),
    ]);
    expect(got[0].page).toBe(16);
    expect(got[1].page).toBe(28);
  });

  it("returns every candidate, because a set may legend two things", () => {
    const got = legendPages([
      page({ page: 16, title: "PARTITION TYPES", lines: assembly(20) }),
      page({ page: 17, title: "WALL ASSEMBLIES", lines: assembly(20) }),
    ]);
    expect(got.map((c) => c.page)).toEqual([16, 17]);
  });

  it("says nothing about a set with no legend in it", () => {
    expect(legendPages([page({ page: 1, title: "FLOOR PLAN", lines: ["ROOM 101"] })])).toEqual([]);
  });
});

describe("a legend drawn as a block on a sheet titled something else", () => {
  // Measured 2026-10-20 on the twelve new sets: Bunkie's G003 reads SECTION
  // VIEW in its title block and carries a block headed WALL TYPES; MHK's is on
  // A1.01 FIRST FLOOR PLAN; Crosslines' is on its general-notes sheet, headed
  // "Partiton Types" exactly as the drawing spells it. Each ranked below an
  // exterior-detail or mechanical sheet that said STUD more often.
  it("puts a sheet with a WALL TYPES block ahead of a detail sheet with more assembly text", () => {
    const got = legendPages([
      page({ page: 45, title: "A314 BID DOCUMENTS", lines: assembly(46) }),
      page({ page: 4, title: "G003 SECTION VIEW BID DOCUMENTS", lines: ["4 | WALL TYPES", ...assembly(24)] }),
    ]);
    expect(got.map((c) => c.page)).toEqual([4, 45]);
    expect(got[0].rank).toBe(1);
    expect(got[0].why).toContain('headed "WALL TYPES"');
  });

  it("reads the heading as the drawing spells it, dropped letter and all", () => {
    const got = legendPages([
      page({ page: 30, title: "M601 MECHANICAL SCHEDULES", lines: assembly(25) }),
      page({ page: 2, title: "A001 Existing Recessed Can Light Fixture", lines: ["Partiton Types", ...assembly(22)] }),
    ]);
    expect(got[0].page).toBe(2);
  });

  it("does not take a pointer to the legend for the legend", () => {
    // A section sheet saying REFER TO WALL TYPES is telling you where to look.
    const got = legendPages([
      page({ page: 41, title: "A310 BID DOCUMENTS", lines: ["NEW SMOKE BARRIER WALL. REFER TO WALL TYPES", ...assembly(16)] }),
    ]);
    expect(got[0].rank).toBe(2);
  });

  it("does not promote a cover sheet's index line on the strength of a heading", () => {
    const got = legendPages([
      page({ page: 2, title: "G001 BID DOCUMENTS", lines: ["G003 | WALL TYPES", "G004 | DETAILS", ...assembly(2)] }),
    ]);
    expect(got).toHaveLength(0);
  });

  it("tries an engineer's sheet last, whatever it says about studs", () => {
    // Crosslines: M601 and P601 describe pipe insulation TYPE 1-6 and out-rank
    // every architectural sheet on assembly words; MHK's S0.01 does the same.
    const got = legendPages([
      page({ page: 30, title: "M601 MECHANICAL SCHEDULES", lines: assembly(25) }),
      page({ page: 38, title: "P601 PLUMBING SCHEDULES", lines: assembly(22) }),
      page({ page: 25, title: "S0.01 GENERAL NOTES & SCHEDULES", lines: assembly(16) }),
      page({ page: 42, title: "A5.05 DETAILS", lines: assembly(14) }),
    ]);
    expect(got.map((c) => c.page)).toEqual([42, 30, 38, 25]);
    expect(got[1].why).toContain("M-series sheet");
    expect(got[1].rank).toBeGreaterThan(got[0].rank);
  });
});

describe("two untitled candidates", () => {
  it("puts the page that says more about assemblies first, whatever its page number", () => {
    // SLN Terminal: A-001 general notes (12 assembly lines) on page 5, A-002
    // PARTITION TYPES (21 lines) on page 6, and a title block that carries
    // the project name rather than the sheet name — so both are rank 1, and
    // page order sent the one model call to the notes.
    const assembly = (n: number) => Array.from({ length: n }, (_, i) => `3 5/8" MTL. STUD AT 16" O.C. — line ${i}`);
    const got = legendPages([
      { page: 5, title: "SALINA AIRPORT AUTHORITY", lines: assembly(12) },
      { page: 6, title: "SALINA AIRPORT AUTHORITY", lines: assembly(21) },
    ]);
    expect(got.map((c) => c.page)).toEqual([6, 5]);
    expect(got[0].assemblyLines).toBe(21);
  });
});
