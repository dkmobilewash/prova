import { describe, expect, it } from "vitest";
import { ceilingsFromScheduleRows } from "./ceilingSchedule";

/** Bunkie p51 and O'Reillys A1.2, as the table reader hands them back. */
describe("ceilingsFromScheduleRows", () => {
  it("reads Bunkie's room finish schedule: number, ceiling finish, ceiling height, skipping a wrapped name's second line", () => {
    const rows = [
      { y: 100, cells: ["Rm #", "Name", "Wall Finish", "Ceiling Finish", "Floor Finish", "Base Finish", "Ceiling Ht.", "Comments"] },
      { y: 112, cells: ["E100", "INVESTIGATIVE", "PT-1", "GYP.BD.", "CPT", "RB", "10' - 0\""] },
      { y: 124, cells: ["SERVICES ROOM #1", "2.", "ALL UNFINISHED PLYWOOD TO BE TAPED"] },
      { y: 136, cells: ["K108", "WAREHOUSE", "PT-2", "EXPOSED", "SEALED CONCRETE", "N/A", "10' - 0\""] },
    ];
    expect(ceilingsFromScheduleRows(rows)).toEqual([
      { number: "E100", name: "INVESTIGATIVE", finish: "GYP.BD.", family: "GYP", heightFeet: 10, y: 112 },
      { number: "K108", name: "WAREHOUSE", finish: "EXPOSED", family: "OPEN", heightFeet: 10, y: 136 },
    ]);
  });
  // NOT handled: a two-level header (O'Reillys: CEILING over TYPE | HEIGHT). The
  // table rows carry no x positions, so a group heading cannot be mapped to the
  // sub-columns under it; that needs the cell geometry the table reader keeps.
  it("is empty without a ceiling column", () => {
    expect(ceilingsFromScheduleRows([{ y: 1, cells: ["MARK", "WIDTH", "HEIGHT", "TYPE"] }, { y: 2, cells: ["101", "3'-0\"", "7'-0\"", "HM"] }])).toEqual([]);
  });
});
