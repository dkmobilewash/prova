import { describe, expect, it } from "vitest";
import { readRoomTags, type PositionedText } from "./roomTags";

/** A line of text 10pt tall, centred on `cx`. */
const line = (str: string, cx: number, y: number, width = 40): PositionedText => ({ str, x: cx - width / 2, y, width, height: 10 });

describe("readRoomTags", () => {
  it("reads NAME / NUMBER / AREA, taking the NEAREST number and stepping over a dimension", () => {
    const tags = readRoomTags([
      // Bunkie's shape: a partition code above the name, a dimension between name and number.
      line("P08", 100, 0),
      line("STAFF TLT.", 100, 14),
      line("8' - 3\"", 100, 28),
      line("E101", 100, 42),
      line("59 SF", 100, 56),
      // Baker's shape: name over area, no number.
      line("(E) OFFICE", 300, 100),
      line("261 SF", 300, 114),
      // a bare door mark with nothing above it is not a room
      line("104", 500, 300),
      // the synthetic shape: name over number, no area
      line("LIVING", 700, 200),
      line("101", 700, 214),
      // Bunkie's interview rooms are named "#1"
      line("#1", 1100, 200),
      line("E100", 1100, 214),
      line("139 SF", 1100, 228),
      // a tally table beside the drawing: a column of areas under a header
      line("AREA", 1300, 400),
      line("468 SF", 1300, 414),
      line("160 SF", 1300, 428),
      line("3,123 SF", 1300, 442),
      // metric
      line("BATH", 900, 200),
      line("05", 900, 214),
      line("5.6 m2", 900, 228),
    ]);
    expect(tags.map((t) => [t.name, t.number, t.areaSf])).toEqual([
      ["STAFF TLT.", "E101", 59],
      ["(E) OFFICE", null, 261],
      ["#1", "E100", 139],
      ["BATH", "05", 60.3],
      ["LIVING", "101", null],
    ]);
    const staff = tags[0];
    expect(staff.x).toBe(100);
    expect(staff.y).toBeCloseTo((14 + 66) / 2);
  });

  it("does not join two tags printed side by side", () => {
    const tags = readRoomTags([line("OFFICE", 100, 0), line("101", 100, 14), line("STORAGE", 160, 0), line("102", 160, 14)]);
    expect(tags.map((t) => t.name).sort()).toEqual(["OFFICE", "STORAGE"]);
  });
});
