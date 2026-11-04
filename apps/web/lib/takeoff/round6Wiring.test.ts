import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wallsPlan, wallsSummaryRows, wallsTaskPages, refreshNoteFor, type WallsSheet } from "@/lib/plan-ingest/walls";
import { KEPT_LABEL, PERSON_LABELS } from "./estimateHold";

// Chrome round 6. The refresh half has its behaviour test on a database
// (`refreshSheetWalls.dbtest.ts`); these pin the plan and the viewer's lines.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
// As a real job has them: both sheets' scale saves stored walls.
const baker: WallsSheet[] = [
  { pageNumber: 1, sheetNumber: "A100", title: "OVERALL FLOOR PLAN", hasScale: true, hasWalls: true },
  { pageNumber: 2, sheetNumber: "A101", title: "FLOOR PLAN", hasScale: true, hasWalls: true },
];

describe("a sheet the set does not count, with walls of its own", () => {
  it("IS 'same level as A101', not 'already found' (Baker A100 had its walls stored)", () => {
    expect(wallsPlan(baker).get(1)).toBe("same level as A101");
    expect(wallsPlan(baker).get(2)).toBe("already found");
  });
  it("and the summary says it found walls that are not counted", () => {
    const rows = wallsSummaryRows({ sheets: baker, walls: new Map([[1, { groups: 3, feet: 640 }], [2, { groups: 7, feet: 698 }]]), tasks: new Map(), maxAttempts: 3 });
    expect(rows[0]!.status).toMatchObject({ kind: "walls", notCounted: "same level as A101" });
    expect(rows[1]!.status).not.toHaveProperty("notCounted");
  });
  it("the viewer says so on 'It is a wall' and on a review keep, from the loader's map", () => {
    const viewer = read("../../components/TakeoffPlanViewer.tsx");
    expect(viewer).toContain("`This sheet isn't counted: ${notCountedByPage[pageNumber]} shows the same level`");
    expect(viewer).toContain("measurementForRun(sheetReviewRun) === null && notCounted !== null");
    expect(viewer).toMatch(/data-takeoff="not-counted"[\s\S]{0,120}putting one back changes nothing on the estimate/);
    expect(read("./workspaceLoad.ts")).toContain("notCountedByPage[pageNumber] = skip.slice(\"same level as \".length)");
    expect(read("../../components/TakeoffWorkspace.tsx")).toContain("notCountedByPage={data.notCountedByPage}");
  });
});

describe("a whole-set re-run reads a found sheet again", () => {
  it("makes a task of the counted sheet already found, and none of the one another counts", () => {
    expect(wallsTaskPages(baker)).toEqual([2]);
  });
  it("says what it did there", () => {
    expect(refreshNoteFor("replaced")).toMatch(/read again from the wall model, kept and dropped left as decided/);
    expect(refreshNoteFor("posted-left-alone")).toMatch(/sent to the estimate are left alone/);
  });
});

describe("only a person's labels survive a re-find", () => {
  it("are kept and dropped, and both review keeps write kept", () => {
    expect(PERSON_LABELS).toEqual(["wall, kept", "wall, dropped"]);
    const actions = read("../actions/takeoff.ts");
    expect(actions.match(/label: KEPT_LABEL/g)).toHaveLength(2);
    expect(actions).not.toContain('"wall, untyped"');
    expect(KEPT_LABEL).toBe("wall, kept");
  });
});
