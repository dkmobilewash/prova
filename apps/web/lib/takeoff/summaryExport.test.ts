import { describe, expect, it } from "vitest";
import { NO_CEILING_TYPE, takeoffSummary, takeoffSummaryCsv, UNNAMED_ROOM, UNTYPED, type SummaryInput, type SummaryMeasurement } from "./summaryExport";

const m = (over: Partial<SummaryMeasurement> = {}): SummaryMeasurement => ({
  kind: "LINEAR",
  xs: [0.1, 0.4],
  ys: [0.5, 0.5],
  cutouts: [],
  label: null,
  itemId: null,
  source: "MANUAL",
  roomName: null,
  roomNumber: null,
  wallRun: null,
  ceiling: null,
  feetPerUnit: 100,
  ...over,
});
const square = (over: Partial<SummaryMeasurement> = {}) =>
  m({ kind: "AREA", xs: [0.5, 0.6, 0.6, 0.5], ys: [0.5, 0.5, 0.6, 0.6], ...over });
const typed = (over: Partial<SummaryMeasurement> = {}) => m({ wallRun: { wallTypeId: "t1", heightFt: null }, label: "P1 wall — 6″", ...over });

const input: SummaryInput = {
  sheets: [
    {
      pageNumber: 12,
      label: "A100 — FIRST FLOOR PLAN",
      notFloorPlan: null,
      measurements: [
        typed(), // 30 ft
        typed({ xs: [0, 0.1, 0.1], ys: [0, 0, 0.1] }), // 20 ft polyline, one run
        m({ label: "6″ wall" }), // untyped, 30 ft
        square({ source: "ROOM_FINDER", roomName: "OFFICE", roomNumber: "101", label: "OFFICE", ceiling: { family: "GYP", code: "GB", heightFeet: 10, guess: false } }),
        square({ source: "ROOM_FINDER", roomName: null, roomNumber: null, label: null }),
        square({ source: "ROOM_FINDER", roomName: "CORRIDOR", roomNumber: "100", ceiling: { family: "ACT", code: null, heightFeet: 9, guess: true } }),
        square({ itemId: "i1", xs: [0, 0.2, 0.2, 0], ys: [0, 0, 0.1, 0.1] }),
      ],
    },
    {
      pageNumber: 13,
      label: null,
      notFloorPlan: null,
      measurements: [typed({ xs: [0, 0.05], ys: [0, 0] }), m({ itemId: "i2", xs: [0, 0.1], ys: [0, 0] }), square({ itemId: "i1" })],
    },
    {
      pageNumber: 25,
      label: "A601 — DOOR SCHEDULE",
      notFloorPlan: "table rules, which pair up as though they were wall faces",
      measurements: [typed()],
    },
  ],
  wallTypes: [{ id: "t1", code: "P1", defaultHeightFt: 10, sides: 2, studSpacingIn: 16 }],
  items: [
    { id: "i1", name: "ACT ceiling" },
    { id: "i2", name: "Base trim" },
  ],
  doors: [{ pageNumber: 40, rows: [{ mark: "101", description: "HM", size: `3'-0" x 7'-0"`, quantity: null, notes: "20 min" }] }],
};

describe("takeoff summary", () => {
  const summary = takeoffSummary(input);

  it("adds a wall type up across sheets from the runs posted against it: feet, height, board both sides, studs per run, track", () => {
    expect(summary.walls).toEqual([
      // 30 + 20 + 5 ft at 10 ft high, two sides → 1,100 board; 16" o.c.: 30→24, 20→16, 5→5 studs.
      { typeCode: "P1", runs: 3, linearFt: 55, heightFt: 10, boardSqFt: 1100, studs: 45, trackFt: 110, sheets: ["A100 — FIRST FLOOR PLAN", "Sheet 13"] },
    ]);
  });

  it("a run posted at its own height keeps it, and the type's line says the heights vary", () => {
    const [line] = takeoffSummary({
      ...input,
      sheets: [{ pageNumber: 1, label: null, notFloorPlan: null, measurements: [typed(), typed({ wallRun: { wallTypeId: "t1", heightFt: 12 } })] }],
    }).walls;
    expect(line).toMatchObject({ linearFt: 60, heightFt: null, boardSqFt: 30 * 10 * 2 + 30 * 12 * 2 });
  });

  it("untyped walls are one block by label with feet only — no studs, track or board guessed", () => {
    expect(summary.untypedWalls).toEqual([
      { name: "6″ wall", runs: 1, linearFt: 30, sheets: ["A100 — FIRST FLOOR PLAN"] },
      { name: "Base trim", runs: 1, linearFt: 10, sheets: ["Sheet 13"] },
    ]);
    expect(Object.keys(summary.untypedWalls[0])).not.toContain("studs");
  });

  it("a typed run whose type has no height has feet, studs and track but no board", () => {
    const [line] = takeoffSummary({
      ...input,
      wallTypes: [{ id: "t1", code: "P1", defaultHeightFt: null, sides: 2, studSpacingIn: 16 }],
    }).walls;
    expect(line).toMatchObject({ linearFt: 55, heightFt: null, boardSqFt: null, studs: 45 });
  });

  it("rooms use their names and numbers, named first by number, unnamed marked and last", () => {
    expect(summary.rooms.map((r) => [r.number, r.name, r.named, r.squareFeet, r.perimeterFt])).toEqual([
      ["100", "CORRIDOR", true, 100, 40],
      ["101", "OFFICE", true, 100, 40],
      [null, UNNAMED_ROOM, false, 100, 40],
    ]);
  });

  it("ceilings add up by the type each room carries — the drawing's code, else the family — with the unread rooms on their own line, last", () => {
    expect(summary.ceilings).toEqual([
      { type: "GB", rooms: 1, squareFeet: 100, heightFeet: 10, guessed: 0, sheets: ["A100 — FIRST FLOOR PLAN"] },
      { type: "ACT", rooms: 1, squareFeet: 100, heightFeet: 9, guessed: 1, sheets: ["A100 — FIRST FLOOR PLAN"] },
      { type: NO_CEILING_TYPE, rooms: 1, squareFeet: 100, heightFeet: null, guessed: 0, sheets: ["A100 — FIRST FLOOR PLAN"] },
    ]);
  });

  it("other areas add up by item, counting how many shapes made the figure", () => {
    expect(summary.areas).toEqual([
      { item: "ACT ceiling", measurements: 2, squareFeet: 200 + 100, perimeterFt: 60 + 40, sheets: ["A100 — FIRST FLOOR PLAN", "Sheet 13"] },
    ]);
  });

  it("a door with no printed quantity counts as one, on the sheet the schedule was read from", () => {
    expect(summary.doors).toEqual([{ mark: "101", description: "HM", size: `3'-0" x 7'-0"`, quantity: 1, notes: "20 min", sheet: "Sheet 40" }]);
  });

  it("a sheet the index says is not a floor plan is left out, and the summary says so rather than dropping its work in silence", () => {
    expect(summary.leftOut).toEqual([{ sheet: "A601 — DOOR SCHEDULE", why: "table rules, which pair up as though they were wall faces", measurements: 1 }]);
    expect(summary.sheets.map((s) => s.pageNumber)).toEqual([12, 13]);
    expect(summary.walls[0].sheets).not.toContain("A601 — DOOR SCHEDULE");
  });

  it("the markup per sheet names typed runs by type, untyped ones as such, and polygons by room or item", () => {
    const [a100] = summary.sheets;
    expect(a100.runs.map((r) => r.name)).toEqual(["P1", "P1", UNTYPED]);
    expect(a100.polygons.map((p) => [p.kind, p.name])).toEqual([
      ["room", "101 OFFICE"],
      ["room", UNNAMED_ROOM],
      ["room", "100 CORRIDOR"],
      ["area", "ACT ceiling"],
    ]);
  });

  it("the CSV is one table with a section column, blank where a figure does not apply", () => {
    const csv = takeoffSummaryCsv(summary);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("section,name,description,size,quantity,unit,linear_ft,height_ft,board_sqft,studs,track_ft,area_sqft,perimeter_ft,sheets,notes");
    expect(lines).toContain("Walls,P1,3 runs,,55,ft,55,10,1100,45,110,,,A100 — FIRST FLOOR PLAN; Sheet 13,");
    expect(lines).toContain("Untyped walls,6″ wall,1 run,,30,ft,30,,,,,,,A100 — FIRST FLOOR PLAN,no type: feet only");
    expect(lines).toContain("Rooms,CORRIDOR,100,,100,sq ft,,,,,,100,40,A100 — FIRST FLOOR PLAN,");
    expect(lines).toContain(`Rooms,${UNNAMED_ROOM},,,100,sq ft,,,,,,100,40,A100 — FIRST FLOOR PLAN,unnamed on the drawing`);
    expect(lines).toContain("Ceilings,GB,1 room,,100,sq ft,,10,,,,100,,A100 — FIRST FLOOR PLAN,");
    expect(lines).toContain("Ceilings,ACT,1 room,,100,sq ft,,9,,,,100,,A100 — FIRST FLOOR PLAN,\"1 guessed, not confirmed\"");
    expect(lines).toContain(`Doors,101,HM,"3'-0"" x 7'-0""",1,ea,,,,,,,,Sheet 40,20 min`);
    expect(lines).toContain(
      'Left out,A601 — DOOR SCHEDULE,1 measurement not exported,,,,,,,,,,,A601 — DOOR SCHEDULE,"not a floor plan: table rules, which pair up as though they were wall faces"',
    );
    expect(csv).not.toMatch(/\$|price/i);
  });
});
