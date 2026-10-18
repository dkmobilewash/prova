import { describe, expect, it } from "vitest";
import { levelFromTitle, levelSummary, levelsByPage, type LevelledSheet } from "./sheetLevel";

/**
 * The titles here are the SHAPES measured on five real sets — `LEVEL 01 -
 * OVERALL FLOOR PLAN`, `FLOOR PLAN - LEVEL 1`, `FIRST FLOOR PLAN` — written
 * out rather than copied, because plan sets are confidential and no customer
 * drawing is ever a fixture.
 */

const plan = (title: string) => levelFromTitle(title, "PLAN");

describe("levelFromTitle", () => {
  it("reads the ways a drawing actually writes a floor", () => {
    expect(plan("LEVEL 01 - OVERALL FLOOR PLAN")?.label).toBe("Level 1");
    expect(plan("FLOOR PLAN - LEVEL 1")?.label).toBe("Level 1");
    expect(plan("LEVEL 2 REFLECTED CEILING PLAN")?.label).toBe("Level 2");
    expect(plan("FIRST FLOOR PLAN")?.label).toBe("Level 1");
    expect(plan("SECOND FLOOR SIGNAGE PLAN")?.label).toBe("Level 2");
    expect(plan("2ND FLOOR PLAN")?.label).toBe("Level 2");
    expect(plan("LVL 03 FINISH PLAN")?.label).toBe("Level 3");
  });

  it("reads the floors that have a name instead of a number", () => {
    expect(plan("ROOF PLAN")?.label).toBe("Roof");
    expect(plan("BASEMENT FLOOR PLAN")?.label).toBe("Basement");
    expect(plan("GROUND FLOOR PLAN")?.label).toBe("Ground floor");
    expect(plan("MEZZANINE PLAN")?.label).toBe("Mezzanine");
  });

  it("STACKS THEM THE WAY THE BUILDING DOES", () => {
    const order = ["ROOF PLAN", "LEVEL 2 PLAN", "FIRST FLOOR PLAN", "BASEMENT PLAN", "MEZZANINE PLAN"]
      .map((title) => plan(title)!)
      .sort((a, b) => a.order - b.order)
      .map((level) => level.label);
    expect(order).toEqual(["Basement", "Level 1", "Mezzanine", "Level 2", "Roof"]);
  });

  it("CALLS A ROOF A ROOF even when the title also carries a number", () => {
    // `ROOF PLAN - LEVEL 2` is a roof. Taking the number first would file it
    // among the occupied floors, where its quantities are a different trade.
    expect(plan("ROOF PLAN - LEVEL 2")?.label).toBe("Roof");
    expect(plan("LEVEL 2 ROOF PLAN")?.label).toBe("Roof");
  });

  it("GIVES NO LEVEL TO A SHEET THAT IS NOT A PLAN", () => {
    // `FIRST FLOOR` in an elevation's title names what is DRAWN in it, not
    // where the sheet's quantities live. A detail mentioning a level is
    // referring somewhere, not describing itself.
    expect(levelFromTitle("BUILDING ELEVATIONS - FIRST FLOOR", "ELEVATION")).toBeNull();
    expect(levelFromTitle("WALL SECTIONS AT LEVEL 2", "SECTION")).toBeNull();
    expect(levelFromTitle("LEVEL 1 DETAILS", "DETAIL")).toBeNull();
    expect(levelFromTitle("FIRST FLOOR FINISH SCHEDULE", "SCHEDULE")).toBeNull();
    expect(levelFromTitle("COVER - LEVEL 1", "COVER")).toBeNull();
  });

  it("gives no level to a sheet nobody has classified yet", () => {
    // Null page type is "not known to be a plan", never "probably a plan".
    expect(levelFromTitle("LEVEL 1 FLOOR PLAN", null)).toBeNull();
  });

  it("says nothing rather than guessing when the title names no floor", () => {
    expect(plan("OVERALL SITE PLAN")).toBeNull();
    expect(plan("LIFE SAFETY PLAN")).toBeNull();
    expect(plan("ENLARGED PLAN - TOILET ROOMS")).toBeNull();
    expect(plan("")).toBeNull();
    expect(levelFromTitle(null, "PLAN")).toBeNull();
  });

  it("DOES NOT READ A LEVEL OUT OF A ROOM NUMBER OR A DIMENSION", () => {
    // The reason this takes the extracted TITLE rather than the title-block
    // region: a probe over the whole region matched a general note ("SCOPE OF
    // WORK FOR THE FIRST FLOOR AREA WILL BE NIGHT WORK") and a schedule row
    // ("MAINTENANCE BAY FLOOR LEVEL 1  3,244 TOTAL"). Both returned the right
    // level by luck, which is worse than being wrong.
    expect(plan("ENLARGED PLAN - ROOM 201")).toBeNull();
    expect(plan("PLAN AT ELEVATION 100'-0\"")).toBeNull();
    expect(plan("PARTITION TYPE A1 PLAN")).toBeNull();
  });

  it("is not fooled by a number that is not a floor", () => {
    expect(plan("PLAN - AREA 2")).toBeNull();
    expect(plan("PHASE 2 PLAN")).toBeNull();
  });
});

describe("levelsByPage", () => {
  const sheet = (over: Partial<LevelledSheet> & { pageNumber: number }): LevelledSheet => ({
    proposedTitle: null,
    acceptedTitle: null,
    proposedPageType: "PLAN",
    ...over,
  });

  it("maps each page to the floor its title names", () => {
    const levels = levelsByPage([
      sheet({ pageNumber: 3, proposedTitle: "LEVEL 01 - OVERALL FLOOR PLAN" }),
      sheet({ pageNumber: 4, proposedTitle: "LEVEL 02 - OVERALL FLOOR PLAN" }),
      sheet({ pageNumber: 9, proposedTitle: "ROOF PLAN" }),
      sheet({ pageNumber: 11, proposedTitle: "OVERALL SITE PLAN" }),
    ]);
    expect(levels.get(3)?.label).toBe("Level 1");
    expect(levels.get(4)?.label).toBe("Level 2");
    expect(levels.get(9)?.label).toBe("Roof");
    expect(levels.has(11)).toBe(false);
  });

  it("HONOURS A CORRECTED TITLE over the machine's guess", () => {
    // Somebody who fixed a misread title has said what the sheet is. Tagging
    // quantities from the superseded guess ignores them twice.
    const levels = levelsByPage([
      sheet({ pageNumber: 2, proposedTitle: "LEVEL 01 FLOOR PLAN", acceptedTitle: "LEVEL 02 FLOOR PLAN" }),
    ]);
    expect(levels.get(2)?.label).toBe("Level 2");
  });

  it("CANNOT honour a corrected page type, because there is no such field", () => {
    // `PlanSheetProposal` lets somebody correct the sheet NUMBER and the TITLE
    // and nothing else. A plan the model filed as a DETAIL therefore gets no
    // level, whatever its title says, and no amount of correcting on the
    // review screen changes that.
    //
    // Recorded as a test rather than a comment because it reads like a bug the
    // first three times somebody meets it.
    const levels = levelsByPage([
      sheet({ pageNumber: 2, proposedTitle: "LEVEL 01 FLOOR PLAN", proposedPageType: "DETAIL" }),
    ]);
    expect(levels.has(2)).toBe(false);
  });
});

describe("levelSummary", () => {
  it("counts the sheets on each floor, in building order", () => {
    const sheets: LevelledSheet[] = [
      { pageNumber: 1, proposedTitle: "ROOF PLAN", acceptedTitle: null, proposedPageType: "PLAN" },
      { pageNumber: 2, proposedTitle: "LEVEL 1 PLAN", acceptedTitle: null, proposedPageType: "PLAN" },
      { pageNumber: 3, proposedTitle: "LEVEL 1 RCP", acceptedTitle: null, proposedPageType: "PLAN" },
      { pageNumber: 4, proposedTitle: "BASEMENT PLAN", acceptedTitle: null, proposedPageType: "PLAN" },
    ];
    expect(levelSummary(levelsByPage(sheets))).toEqual([
      { level: { label: "Basement", order: -100 }, sheets: 1 },
      { level: { label: "Level 1", order: 1 }, sheets: 2 },
      { level: { label: "Roof", order: 1000 }, sheets: 1 },
    ]);
  });

  it("is empty when no sheet names a floor, rather than inventing one", () => {
    expect(levelSummary(new Map())).toEqual([]);
  });
});

describe("a mezzanine sits between floors", () => {
  it("puts a numbered mezzanine above its own floor and below the next", () => {
    // Found by the stacking test: a flat order for every mezzanine sorted a
    // ground-floor one above the top storey.
    const third = levelFromTitle("LEVEL 3 MEZZANINE PLAN", "PLAN");
    expect(third?.label).toBe("Level 3 mezzanine");
    expect(third!.order).toBeGreaterThan(3);
    expect(third!.order).toBeLessThan(4);
  });

  it("keeps the plain name when there is only one", () => {
    expect(levelFromTitle("MEZZANINE PLAN", "PLAN")?.label).toBe("Mezzanine");
  });
});

describe("a sheet covering two floors", () => {
  it("GETS NO LEVEL, rather than being tagged with one of them", () => {
    // Naples prints `ARCHITECTURAL PLAN - FIRST & SECOND FLOOR`. Taking the
    // last floor named would tag every quantity on that sheet to the second —
    // confidently, and wrong for half of them. Found by running the rule over
    // real title strings rather than only over fixtures.
    expect(levelFromTitle("ARCHITECTURAL PLAN - FIRST & SECOND FLOOR", "PLAN")).toBeNull();
    expect(levelFromTitle("FLOOR PLANS - LEVEL 1 AND LEVEL 2", "PLAN")).toBeNull();
    expect(levelFromTitle("1ST & 2ND FLOOR DEMOLITION PLAN", "PLAN")).toBeNull();
  });

  it("still levels a title that names one floor twice", () => {
    // `LIFE SAFETY PLAN - LEVEL 1  LEVEL 1` is one floor said twice, which a
    // naive count of matches would read as two.
    expect(levelFromTitle("LIFE SAFETY PLAN - LEVEL 1 LEVEL 1", "PLAN")?.label).toBe("Level 1");
    expect(levelFromTitle("FIRST FLOOR PLAN - FIRST FLOOR NOTES", "PLAN")?.label).toBe("Level 1");
  });

  it("does not read an issue or a revision as a floor", () => {
    // `FIRST ISSUE` carries no floor word, so nothing should latch onto it.
    expect(levelFromTitle("SITE PLAN - FIRST ISSUE", "PLAN")).toBeNull();
  });
});

describe("several proposals for one page", () => {
  it("KEEPS THE NEWEST, which callers hand over first", () => {
    // A page accumulates a proposal per ingest run. `printedScalesFromProposals`
    // has the same contract: newest-first in, first seen wins. Overwriting as
    // it goes would quietly read the OLDEST reading of every sheet — and the
    // rows LOOK right either way, which is why this is asserted rather than
    // assumed.
    const levels = levelsByPage([
      {
        pageNumber: 5,
        proposedTitle: "LEVEL 03 FLOOR PLAN",
        acceptedTitle: null,
        proposedPageType: "PLAN",
      },
      {
        pageNumber: 5,
        proposedTitle: "LEVEL 01 FLOOR PLAN",
        acceptedTitle: null,
        proposedPageType: "PLAN",
      },
    ]);
    expect(levels.get(5)?.label).toBe("Level 3");
  });

  it("falls through to an older row when the newest names no floor", () => {
    // A re-run that read the title badly should not erase a level somebody
    // already had.
    const levels = levelsByPage([
      {
        pageNumber: 5,
        proposedTitle: "FLOOR PLAN",
        acceptedTitle: null,
        proposedPageType: "PLAN",
      },
      {
        pageNumber: 5,
        proposedTitle: "LEVEL 02 FLOOR PLAN",
        acceptedTitle: null,
        proposedPageType: "PLAN",
      },
    ]);
    expect(levels.get(5)?.label).toBe("Level 2");
  });
});
