import { describe, expect, it } from "vitest";
import { areaOfTitle, roomsNoteFor, wallsNoteFor, wallsPlan, wallsSkipReason, wallsSummaryRows, type WallsSheet } from "./walls";

const sheet = (over: Partial<WallsSheet> = {}): WallsSheet => ({
  pageNumber: 1,
  sheetNumber: "A101",
  title: "FIRST FLOOR PLAN",
  hasScale: true,
  hasWalls: false,
  ...over,
});

describe("which sheets a whole-set run takes on", () => {
  it("takes a scaled floor plan with no walls yet", () => {
    expect(wallsSkipReason(sheet())).toBeNull();
  });
  it("passes over a sheet with no scale — nothing to measure with", () => {
    expect(wallsSkipReason(sheet({ hasScale: false }))).toBe("no scale");
  });
  it("passes over a sheet whose walls are already found rather than finding them twice", () => {
    expect(wallsSkipReason(sheet({ hasWalls: true }))).toBe("already found");
  });
  it("passes over a sheet the title says is not a floor plan", () => {
    expect(wallsSkipReason(sheet({ sheetNumber: "A601", title: "DOOR SCHEDULE" }))).toBe("not a floor plan");
  });
  it("takes a sheet the inventory never named — unknown is not 'not a plan'", () => {
    expect(wallsSkipReason(sheet({ sheetNumber: null, title: null }))).toBeNull();
  });
});

describe("what the stage says about a sheet", () => {
  it("finishes with a note for every outcome detection settles, and retries the ones it does not", () => {
    expect(wallsNoteFor("written")).toEqual({ ok: true, note: "walls found" });
    expect(wallsNoteFor("nothing-found")).toEqual({ ok: true, note: "nothing found" });
    expect(wallsNoteFor("too-dense").ok).toBe(true);
    for (const retry of ["out-of-time", "unreadable", "failed"] as const) {
      const said = wallsNoteFor(retry);
      expect(said.ok).toBe(false);
      if (!said.ok) expect(said.error).toMatch(/Retry/);
    }
  });
});

describe("the set-level summary", () => {
  const sheets = [
    sheet({ pageNumber: 1, sheetNumber: "A101", title: "FIRST FLOOR PLAN" }),
    sheet({ pageNumber: 2, sheetNumber: "A102", title: "SECOND FLOOR PLAN" }),
    sheet({ pageNumber: 3, sheetNumber: "A103", title: "ROOF PLAN", hasScale: false }),
    sheet({ pageNumber: 4, sheetNumber: "A601", title: "DOOR SCHEDULE" }),
    sheet({ pageNumber: 5, sheetNumber: null, title: null }),
  ];
  const rows = wallsSummaryRows({
    sheets,
    walls: new Map([[1, { groups: 7, feet: 911 }]]),
    tasks: new Map([
      [1, { finishedAt: new Date(), note: "walls found", error: null, attempts: 1 }],
      [2, { finishedAt: new Date(), note: "nothing found", error: null, attempts: 1 }],
      [5, { finishedAt: null, note: null, error: "The plan file couldn't be read from storage. Retry it.", attempts: 3 }],
    ]),
    maxAttempts: 3,
  });
  const by = (page: number) => rows.find((row) => row.pageNumber === page)!;

  it("reports walls per sheet from the rows, not from the note", () => {
    expect(by(1).status).toEqual({ kind: "walls", groups: 7, feet: 911 });
    expect(by(1).label).toBe("A101 — FIRST FLOOR PLAN");
  });
  it("says what a looked-at sheet came to", () => {
    expect(by(2).status).toEqual({ kind: "looked", note: "nothing found" });
  });
  it("says why a sheet was never a task", () => {
    expect(by(3).status).toEqual({ kind: "skipped", why: "no scale" });
    expect(by(4).status).toEqual({ kind: "skipped", why: "not a floor plan" });
  });
  it("names a sheet that failed for the last time, with its sentence", () => {
    expect(by(5).status).toEqual({ kind: "failed", error: "The plan file couldn't be read from storage. Retry it." });
    expect(by(5).label).toBe("Sheet 5");
  });
  it("calls an eligible sheet no run has touched pending", () => {
    const [only] = wallsSummaryRows({ sheets: [sheet()], walls: new Map(), tasks: new Map(), maxAttempts: 3 });
    expect(only.status).toEqual({ kind: "pending" });
  });
});

describe("one plan per floor — the set-level plan", () => {
  const sheet = (over: Partial<WallsSheet> = {}): WallsSheet => ({ pageNumber: 1, sheetNumber: "A101", title: "FIRST FLOOR PLAN", hasScale: true, hasWalls: false, ...over });
  it("keeps the OVERALL plan of a level and lists the other as the same level", () => {
    // Baker EOC, 2026-10-29: A100 overall + A101 floor plan, both measured, both added.
    const plan = wallsPlan([
      sheet({ pageNumber: 12, sheetNumber: "A100", title: "OVERALL FLOOR PLAN" }),
      sheet({ pageNumber: 13, sheetNumber: "A101", title: "FLOOR PLAN" }),
    ]);
    expect(plan.get(12)).toBeNull();
    expect(plan.get(13)).toBe("same level as A100");
  });
  it("groups by the level the title names, and leaves different levels alone", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN" }),
      sheet({ pageNumber: 2, sheetNumber: "A102", title: "LEVEL 2 FLOOR PLAN" }),
      sheet({ pageNumber: 3, sheetNumber: "A111", title: "LEVEL 1 ENLARGED PLAN" }),
    ]);
    expect(plan.get(1)).toBeNull();
    expect(plan.get(2)).toBeNull();
    expect(plan.get(3)).toBe("same level as A101");
  });
  it("prefers the sheet whose walls are already found, so a re-run adds nothing", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 12, sheetNumber: "A100", title: "OVERALL FLOOR PLAN" }),
      sheet({ pageNumber: 13, sheetNumber: "A101", title: "FLOOR PLAN", hasWalls: true }),
    ]);
    expect(plan.get(13)).toBe("already found");
    expect(plan.get(12)).toBe("same level as A101");
  });
  it("leaves an unlevelled plan alone when the set names SEVERAL levels — nothing says which it repeats", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN" }),
      sheet({ pageNumber: 2, sheetNumber: "A102", title: "LEVEL 2 FLOOR PLAN" }),
      sheet({ pageNumber: 9, sheetNumber: "A150", title: "ENLARGED PLAN - STAIR" }),
    ]);
    expect(plan.get(9)).toBeNull();
  });
  it("never turns a sheet that is not a task into one, and keeps every other reason", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A100", title: "OVERALL FLOOR PLAN" }),
      sheet({ pageNumber: 2, sheetNumber: "M101", title: "LEVEL 1 PLAN" }),
      sheet({ pageNumber: 3, sheetNumber: "A101", title: "FLOOR PLAN", hasScale: false }),
    ]);
    expect(plan.get(2)).toBe("not a floor plan");
    expect(plan.get(3)).toBe("no scale");
  });
});

describe("one plan per floor — what is NOT grouped", () => {
  const sheet = (over: Partial<WallsSheet> = {}): WallsSheet => ({ pageNumber: 1, sheetNumber: null, title: null, hasScale: true, hasWalls: false, ...over });
  it("never groups sheets with no title: nothing says which floor they are", () => {
    const plan = wallsPlan([sheet({ pageNumber: 1 }), sheet({ pageNumber: 2, hasWalls: true }), sheet({ pageNumber: 5 })]);
    expect(plan.get(1)).toBeNull();
    expect(plan.get(2)).toBe("already found");
    expect(plan.get(5)).toBeNull();
  });
  it("on a set naming no level, the whole-floor plans AND the enlarged plans are that one floor", () => {
    // Joplin, 2026-10-29: A-111's enlarged toilet plan added 103 ft that A-101 already had.
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A100", title: "OVERALL FLOOR PLAN" }),
      sheet({ pageNumber: 2, sheetNumber: "A101", title: "FLOOR PLAN" }),
      sheet({ pageNumber: 3, sheetNumber: "A111", title: "ENLARGED FLOOR PLANS" }),
      sheet({ pageNumber: 4, sheetNumber: "A150", title: "STAIR PLAN AND SECTIONS" }),
      sheet({ pageNumber: 5, sheetNumber: "A112", title: "ENLARGED PLAN - TOILETS" }),
    ]);
    expect(plan.get(1)).toBeNull();
    expect(plan.get(2)).toBe("same level as A100");
    expect(plan.get(3)).toBe("same level as A100");
    expect(plan.get(4)).toBe("not a floor plan");
    expect(plan.get(5)).toBe("same level as A100");
  });
  it("on a set that names ONE level, an unlevelled enlarged plan is that level", () => {
    // Joplin: "OVERALL FIRST FLOOR PLAN" names Level 1 once; "ENLARGED FLOOR PLANS" names nothing and is the same floor.
    const plan = wallsPlan([
      sheet({ pageNumber: 46, sheetNumber: "A-101", title: "OVERALL FIRST FLOOR PLAN" }),
      sheet({ pageNumber: 49, sheetNumber: "A-111", title: "ENLARGED FLOOR PLANS" }),
    ]);
    expect(plan.get(46)).toBeNull();
    expect(plan.get(49)).toBe("same level as A-101");
  });
  it("with no whole-floor plan to keep, an enlarged plan stands on its own", () => {
    const plan = wallsPlan([sheet({ pageNumber: 3, sheetNumber: "A111", title: "ENLARGED PLAN - TOILETS" }), sheet({ pageNumber: 4, sheetNumber: "A112", title: "ENLARGED PLAN - KITCHEN" })]);
    expect(plan.get(3)).toBeNull();
    expect(plan.get(4)).toBeNull();
  });
});

describe("a floor split across sheets by area — every part counts", () => {
  const sheet = (over: Partial<WallsSheet> = {}): WallsSheet => ({ pageNumber: 1, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN", hasScale: true, hasWalls: false, ...over });
  it("reads the area off a title and nothing off a whole-floor one", () => {
    expect(areaOfTitle("BLDG D - LEVEL 3 EAST")).toBe("EAST");
    expect(areaOfTitle("LEVEL 3 FLOOR PLAN - WEST")).toBe("WEST");
    expect(areaOfTitle("FIRST FLOOR PLAN - AREA B")).toBe("AREA B");
    expect(areaOfTitle("FLOOR PLAN PART 2")).toBe("PART 2");
    expect(areaOfTitle("LEVEL 2 PLAN - NORTH")).toBe("NORTH");
    expect(areaOfTitle("OVERALL FIRST FLOOR PLAN")).toBeNull();
    expect(areaOfTitle("EAST ELEVATION")).toBeNull();
  });
  it("counts an EAST and a WEST half of the same level both", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 24, sheetNumber: "A242B", title: "BLDG D - LEVEL 3 EAST" }),
      sheet({ pageNumber: 23, sheetNumber: "A242A", title: "BLDG D - LEVEL 3 WEST" }),
    ]);
    expect(plan.get(24)).toBeNull();
    expect(plan.get(23)).toBeNull();
  });
  it("counts AREA A and AREA B, and PART 1 and PART 2, and NORTH and SOUTH", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A101", title: "FIRST FLOOR PLAN - AREA A" }),
      sheet({ pageNumber: 2, sheetNumber: "A102", title: "FIRST FLOOR PLAN - AREA B" }),
      sheet({ pageNumber: 3, sheetNumber: "A201", title: "SECOND FLOOR PLAN PART 1" }),
      sheet({ pageNumber: 4, sheetNumber: "A202", title: "SECOND FLOOR PLAN PART 2" }),
      sheet({ pageNumber: 5, sheetNumber: "A301", title: "LEVEL 3 FLOOR PLAN - NORTH" }),
      sheet({ pageNumber: 6, sheetNumber: "A302", title: "LEVEL 3 FLOOR PLAN - SOUTH" }),
    ]);
    for (const page of [1, 2, 3, 4, 5, 6]) expect(plan.get(page), `p${page}`).toBeNull();
  });
  it("keeps the OVERALL plan of a level and drops the halves, which are the same walls again", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 10, sheetNumber: "A100", title: "OVERALL LEVEL 1 FLOOR PLAN" }),
      sheet({ pageNumber: 11, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN - EAST" }),
      sheet({ pageNumber: 12, sheetNumber: "A102", title: "LEVEL 1 FLOOR PLAN - WEST" }),
    ]);
    expect(plan.get(10)).toBeNull();
    expect(plan.get(11)).toBe("same level as A100");
    expect(plan.get(12)).toBe("same level as A100");
  });
  it("keeps one of two same-area sheets (two scales of one drawing) and folds the enlarged plans into the parts", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN - EAST" }),
      sheet({ pageNumber: 2, sheetNumber: "A101A", title: "LEVEL 1 FLOOR PLAN - EAST" }),
      sheet({ pageNumber: 3, sheetNumber: "A102", title: "LEVEL 1 FLOOR PLAN - WEST" }),
      sheet({ pageNumber: 4, sheetNumber: "A111", title: "LEVEL 1 ENLARGED PLAN - TOILETS" }),
    ]);
    expect(plan.get(1)).toBeNull();
    expect(plan.get(2)).toBe("same level as A101");
    expect(plan.get(3)).toBeNull();
    expect(plan.get(4)).toBe("same level as A101");
  });
  it("an overall plan and an enlarged plan of one level count once", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN" }),
      sheet({ pageNumber: 2, sheetNumber: "A111", title: "LEVEL 1 ENLARGED PLAN" }),
    ]);
    expect(plan.get(1)).toBeNull();
    expect(plan.get(2)).toBe("same level as A101");
  });
});

describe("rooms after walls — what the note and the summary say", () => {
  it("writes the rooms outcome into the task's note", () => {
    expect(roomsNoteFor({ kind: "written", rooms: 12, ceilingSqFt: 3200 })).toBe("12 rooms, 3,200 sf of ceiling read");
    expect(roomsNoteFor({ kind: "skipped", why: "room finding is off" })).toBe("rooms: room finding is off");
    expect(roomsNoteFor({ kind: "failed", error: "no file" })).toBe("rooms failed: no file");
  });
  it("carries rooms and ceiling area on a sheet with walls, and nothing on one without rows", () => {
    const sheets: WallsSheet[] = [
      { pageNumber: 1, sheetNumber: "A101", title: "FIRST FLOOR PLAN", hasScale: true, hasWalls: true },
      { pageNumber: 2, sheetNumber: "A102", title: "SECOND FLOOR PLAN", hasScale: true, hasWalls: true },
    ];
    const rows = wallsSummaryRows({ sheets, walls: new Map([[1, { groups: 3, feet: 400 }], [2, { groups: 2, feet: 300 }]]), rooms: new Map([[1, { rooms: 5, ceilingSqFt: 1200 }]]), tasks: new Map(), maxAttempts: 3 });
    expect(rows[0]!.status).toEqual({ kind: "walls", groups: 3, feet: 400, rooms: 5, ceilingSqFt: 1200 });
    expect(rows[1]!.status).toEqual({ kind: "walls", groups: 2, feet: 300 });
  });
});
