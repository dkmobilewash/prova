import { describe, expect, it } from "vitest";
import type { WallGroup } from "./wallGroups";
import { takeoffSummary, takeoffSummaryCsv, wallLineName, type SummaryInput, type SummaryMeasurement } from "./summaryExport";

const P1 = { id: "t1", code: "P1", name: "Partition", hasParts: true, thicknessIn: 6 };
const P2 = { id: "t2", code: "P2", name: "Partition", hasParts: true, thicknessIn: 6 };

const run = (x1: number, x2: number, feet: number) => ({ x1, y1: 0.5, x2, y2: 0.5, thicknessFeet: 0.5, lengthFeet: feet });
const group = (over: Partial<WallGroup>): WallGroup => ({
  inches: 6,
  runs: [run(0.1, 0.2, 10), run(0.3, 0.5, 20)],
  feet: 30,
  source: { kind: "REMAINDER" },
  candidates: [P1],
  ...over,
});
const square = (over: Partial<SummaryMeasurement> = {}): SummaryMeasurement => ({
  kind: "AREA",
  xs: [0.5, 0.6, 0.6, 0.5],
  ys: [0.5, 0.5, 0.6, 0.6],
  cutouts: [],
  label: null,
  itemId: null,
  source: "MANUAL",
  roomName: null,
  roomNumber: null,
  feetPerUnit: 100,
  ...over,
});

const input: SummaryInput = {
  sheets: [
    {
      pageNumber: 12,
      label: "A100 — FIRST FLOOR PLAN",
      walls: [group({})],
      measurements: [
        square({ source: "ROOM_FINDER", roomName: "OFFICE", roomNumber: "101", label: "OFFICE" }),
        square({ itemId: "i1", xs: [0, 0.2, 0.2, 0], ys: [0, 0, 0.1, 0.1] }),
      ],
    },
    {
      pageNumber: 13,
      label: null,
      walls: [group({ runs: [run(0, 0.05, 5)], feet: 5 }), group({ candidates: [], runs: [run(0, 0.1, 10)], feet: 10 })],
      measurements: [square({ itemId: "i1" }), square({ kind: "LINEAR" })],
    },
  ],
  wallTypes: [{ id: "t1", code: "P1", defaultHeightFt: 10, sides: 2, studSpacingIn: 16 }],
  items: [{ id: "i1", name: "ACT ceiling" }],
  doors: [{ pageNumber: 40, rows: [{ mark: "101", description: "HM", size: `3'-0" x 7'-0"`, quantity: null, notes: "20 min" }] }],
};

describe("takeoff summary", () => {
  const summary = takeoffSummary(input);

  it("adds a wall type up across sheets: feet, height, board both sides, studs per run, track both sides", () => {
    const p1 = summary.walls.find((w) => w.name === "P1")!;
    expect(p1).toMatchObject({ typeCode: "P1", linearFt: 35, heightFt: 10, boardSqFt: 700, trackFt: 70 });
    // 16" o.c.: 10 ft → 9, 20 ft → 16, 5 ft → 5 (ceil(bays)+1 each)
    expect(p1.studs).toBe(9 + 16 + 5);
    expect(p1.sheets).toEqual(["A100 — FIRST FLOOR PLAN", "Sheet 13"]);
  });

  it("a wall with no type has feet, studs and track but no height or board, rather than a guessed one", () => {
    const untyped = summary.walls.find((w) => w.name === "6 in. wall")!;
    expect(untyped).toMatchObject({ typeCode: null, linearFt: 10, heightFt: null, boardSqFt: null, trackFt: 20, studs: 9 });
  });

  it("names a group the way the viewer's verdict does", () => {
    expect(wallLineName(group({ source: { kind: "TAG", tag: "P1" } })).name).toBe("P1");
    expect(wallLineName(group({ candidates: [P1, P2] })).name).toBe("6 in. wall (P1 or P2?)");
    expect(wallLineName(group({ source: { kind: "TAG", tag: "X9" }, candidates: [] })).name).toBe("X9 (not in your library, 6 in.)");
    expect(wallLineName(group({ source: { kind: "TAG", tag: "P1" }, inches: 8 })).name).toBe("P1 (drawn 8 in.)");
  });

  it("a room is an area with a name or number: square feet and perimeter at its own scale, one line each", () => {
    expect(summary.rooms).toEqual([{ name: "OFFICE", number: "101", squareFeet: 100, perimeterFt: 40, sheet: "A100 — FIRST FLOOR PLAN" }]);
  });

  it("other areas add up by item, counting how many shapes made the figure", () => {
    expect(summary.areas).toEqual([
      { item: "ACT ceiling", measurements: 2, squareFeet: 200 + 100, perimeterFt: 60 + 40, sheets: ["A100 — FIRST FLOOR PLAN", "Sheet 13"] },
    ]);
  });

  it("a door with no printed quantity counts as one, on the sheet the schedule was read from", () => {
    expect(summary.doors).toEqual([{ mark: "101", description: "HM", size: `3'-0" x 7'-0"`, quantity: 1, notes: "20 min", sheet: "Sheet 40" }]);
  });

  it("the markup per sheet carries every run and polygon with the name its line has", () => {
    expect(summary.sheets.map((s) => [s.pageNumber, s.runs.length, s.polygons.length])).toEqual([
      [12, 2, 2],
      [13, 2, 1],
    ]);
    expect(summary.sheets[0].polygons.map((p) => [p.kind, p.name])).toEqual([
      ["room", "101 OFFICE"],
      ["area", "ACT ceiling"],
    ]);
  });

  it("the CSV is one table with a section column, blank where a figure does not apply", () => {
    const csv = takeoffSummaryCsv(summary);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("section,name,description,size,quantity,unit,linear_ft,height_ft,board_sqft,studs,track_ft,area_sqft,perimeter_ft,sheets,notes");
    expect(lines).toContain('Walls,P1,,,35,ft,35,10,700,30,70,,,A100 — FIRST FLOOR PLAN; Sheet 13,');
    expect(lines).toContain("Walls,6 in. wall,,,10,ft,10,,,9,20,,,Sheet 13,");
    expect(lines).toContain("Rooms,OFFICE,101,,100,sq ft,,,,,,100,40,A100 — FIRST FLOOR PLAN,");
    expect(lines).toContain(`Doors,101,HM,"3'-0"" x 7'-0""",1,ea,,,,,,,,Sheet 40,20 min`);
    expect(csv).not.toMatch(/\$|price/i);
  });
});
