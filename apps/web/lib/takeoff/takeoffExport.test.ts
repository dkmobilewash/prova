import { describe, expect, it } from "vitest";
import { exportCsv, exportTabs, takeoffExport, type ExportMeasurement } from "./takeoffExport";

const FPU = 100;
const line = (page: number, source: ExportMeasurement["source"], openings: unknown = []): ExportMeasurement => ({ id: `${page}${source}`, pageNumber: page, kind: "LINEAR", xs: [0, 0.5], ys: [0, 0], feetPerPageWidth: FPU, source, label: null, openingsJson: openings });
const room = (label: string): ExportMeasurement => ({ id: label, pageNumber: 1, kind: "AREA", xs: [0, 0.1, 0.1, 0], ys: [0, 0, 0.2, 0.2], feetPerPageWidth: FPU, source: "ROOM_FINDER", label, openingsJson: [] });
const count = (n: number): ExportMeasurement => ({ id: `c${n}`, pageNumber: 2, kind: "COUNT", xs: Array(n).fill(0.1), ys: Array(n).fill(0.1), feetPerPageWidth: null, source: "MANUAL", label: "R1", openingsJson: [] });
const input = (defaultPartition: string | null) => ({
  items: [
    { name: "A walls", properties: { type: "LINEAR" as const }, measurements: [line(1, "DETECTED", [{ kind: "door", mark: "101", widthFt: 3 }, { kind: "window", mark: null, widthFt: 4 }, { kind: "door", mark: null, widthFt: 2.98 }]), line(1, "MANUAL", [{ kind: "door", mark: null, widthFt: 3.01 }])] },
    { name: "Walls — untyped", properties: { type: "LINEAR" as const }, measurements: [line(1, "DETECTED")] },
    { name: "Walls — to confirm", properties: { type: "LINEAR" as const }, measurements: [line(1, "DETECTED")] },
    { name: "Rooms", properties: { type: "AREA_WITH_PERIMETER" as const }, measurements: [room("OFFICE 101")] },
    { name: "R1 troffer", properties: { type: "COUNT" as const }, measurements: [count(21)] },
  ],
  sheetOf: new Map([[1, "A101 — FLOOR PLAN"], [2, "EL1.01"]]),
  finish: [{ pageNumber: 1, lines: [{ description: "A101 — Floor CPT-1", quantity: 200, unit: "sq ft" }] }],
  defaultPartition,
  summary: [
    { pageNumber: 1, label: "A101 — FLOOR PLAN", status: { kind: "walls" as const, groups: 2, feet: 150, rooms: 1 }, renovation: ["(E)"] },
    { pageNumber: 3, label: "A501 — DETAILS", status: { kind: "skipped" as const, why: "not a floor plan" as const } },
  ],
});

describe("takeoffExport", () => {
  it("gives a row per item, sheet and source, with what the source says", () => {
    const { rows } = takeoffExport(input(null));
    const by = (item: string) => rows.filter((r) => r.item === item).map((r) => [r.sheet, r.quantity, r.unit, r.source]);
    expect(by("A walls")).toEqual([["A101 — FLOOR PLAN", 50, "lin ft", "found"], ["A101 — FLOOR PLAN", 50, "lin ft", "traced"]]);
    expect(by("Walls — untyped")).toEqual([["A101 — FLOOR PLAN", 50, "lin ft", "found"]]);
    expect(by("Walls — to confirm")).toEqual([["A101 — FLOOR PLAN", 50, "lin ft", "to confirm"]]);
    expect(by("Room: OFFICE 101")).toEqual([["A101 — FLOOR PLAN", 200, "sq ft", "found"]]);
    expect(by("R1 troffer")).toEqual([["EL1.01", 21, "ea", "count"]]);
    expect(by("Door 101")).toEqual([["A101 — FLOOR PLAN", 1, "ea", "found"]]);
    expect(by(`Window 4'-0", no mark`)).toEqual([["A101 — FLOOR PLAN", 1, "ea", "found"]]);
    expect(by(`Door 3'-0", no mark`)).toEqual([["A101 — FLOOR PLAN", 2, "ea", "found"]]);
    expect(by("A101 — Floor CPT-1")).toEqual([["A101 — FLOOR PLAN", 200, "sq ft", "found"]]);
  });
  it("marks untyped walls assumed when a default partition prices them", () => {
    const untyped = takeoffExport(input("P1")).rows.find((r) => r.item === "Walls — untyped")!;
    expect([untyped.source, untyped.note]).toEqual(["assumed", "priced as P1, check the type"]);
  });
  it("summarises every sheet: counted, skipped and why, and existing work", () => {
    expect(takeoffExport(input(null)).sheets).toEqual([
      { sheet: "A101 — FLOOR PLAN", status: "counted", why: "", wallFeet: 150, rooms: 1, existingWork: "(E)" },
      { sheet: "A501 — DETAILS", status: "skipped", why: "not a floor plan", wallFeet: null, rooms: null, existingWork: "" },
    ]);
  });
  it("writes CSV that a spreadsheet reads back, and two tabs", () => {
    const result = takeoffExport(input(null));
    const csv = exportCsv([{ item: 'Wall "A", 2 hr', sheet: "A101", quantity: 5, unit: "lin ft", source: "found", note: "" }]);
    expect(csv).toBe('Item,Sheet,Quantity,Unit,Source,Note\n"Wall ""A"", 2 hr",A101,5,lin ft,found,\n');
    expect(exportTabs(result).map((t) => [t.name, t.rows.length])).toEqual([["Quantities", result.rows.length + 1], ["Sheets", 3]]);
  });
});
