import { describe, expect, it } from "vitest";
import { wallsNoteFor, wallsPlan, wallsSkipReason, wallsSummaryRows, type WallsSheet } from "./walls";

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
  it("leaves an unlevelled plan alone when the set names its levels", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A101", title: "LEVEL 1 FLOOR PLAN" }),
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
  it("on a set naming no level, groups only the whole-floor plans", () => {
    const plan = wallsPlan([
      sheet({ pageNumber: 1, sheetNumber: "A100", title: "OVERALL FLOOR PLAN" }),
      sheet({ pageNumber: 2, sheetNumber: "A101", title: "FLOOR PLAN" }),
      sheet({ pageNumber: 3, sheetNumber: "A111", title: "ENLARGED PLAN - TOILETS" }),
    ]);
    expect(plan.get(1)).toBeNull();
    expect(plan.get(2)).toBe("same level as A100");
    expect(plan.get(3)).toBeNull();
  });
});
