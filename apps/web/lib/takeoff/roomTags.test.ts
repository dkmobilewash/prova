import { describe, expect, it } from "vitest";
import { looksLikeNoteText, readRoomTags, type PositionedText } from "./roomTags";

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
      // mixed case, as the BIM renderer prints
      line("WC Damen", 1500, 200),
      line("113", 1500, 214),
      line("137 SF", 1500, 228),
      // the clinic's numbering: digit, letter, digits, a suffix
      line("GAS STORAGE", 1700, 200),
      line("1E15-A", 1700, 214),
      // Estonian and German, dotted numbers
      line("ELUTUBA+KÖÖK", 1900, 200),
      line("24-1", 1900, 214),
      line("272 SF", 1900, 228),
      line("Flur-01-2", 2100, 200),
      line("01.1.1", 2100, 214),
      // metric
      line("BATH", 900, 200),
      line("05", 900, 214),
      line("5.6 m2", 900, 228),
    ]);
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect(tags.map((t) => [t.name, t.number, t.areaSf]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual(
      [
        ["STAFF TLT.", "E101", 59],
        ["(E) OFFICE", null, 261],
        ["#1", "E100", 139],
        ["WC Damen", "113", 137],
        ["ELUTUBA+KÖÖK", "24-1", 272],
        ["Flur-01-2", "01.1.1", null],
        ["BATH", "05", 60.3],
        ["GAS STORAGE", "1E15-A", null],
        ["LIVING", "101", null],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    void byName;
    const staff = tags.find((t) => t.name === "STAFF TLT.")!;
    expect(staff.x).toBe(100);
    expect(staff.y).toBeCloseTo((14 + 66) / 2);
  });

  it("reads NUMBER over NAME, the way SW prints its construction plan", () => {
    const tags = readRoomTags([line("104", 100, 0), line("RESTROOM", 100, 14), line("101", 300, 0), line("RETAIL SALES", 300, 14), line("A3", 500, 0)]);
    expect(tags.map((t) => [t.name, t.number]).sort()).toEqual([
      ["RESTROOM", "104"],
      ["RETAIL SALES", "101"],
    ]);
  });

  it("does not join two tags printed side by side", () => {
    const tags = readRoomTags([line("OFFICE", 100, 0), line("101", 100, 14), line("STORAGE", 160, 0), line("102", 160, 14)]);
    expect(tags.map((t) => t.name).sort()).toEqual(["OFFICE", "STORAGE"]);
  });
});

describe("looksLikeNoteText — what stacks like a tag and is not one", () => {
  it("drops title-block labels, sentences and anything longer than a room is called, keeps real tags", () => {
    expect(looksLikeNoteText("SHEET NUMBER A101")).toBe(true);
    expect(looksLikeNoteText("TEMPORARY MARKED EXIT ROUTES. REFERENCE WALL ASSEMBLIES AND TAG LEGEND ARE TO BE PROVIDED ON SHEET A601.")).toBe(true);
    expect(looksLikeNoteText("PROVIDE SOLID BLOCKING IN WALLS FOR ALL WALL HUNG EQUIPMENT")).toBe(true);
    expect(looksLikeNoteText("DRAWN BY")).toBe(true);
    for (const tag of ["HAM RADIO/COMM", "DISPATCH SUPERVISOR", "SECURE VESTIBULE", "RR 2", "(E) OFFICE", "STAFF TLT.", "WC Damen", "MAIN OPERATIONS", "NEW 3"]) {
      expect(looksLikeNoteText(tag), tag).toBe(false);
    }
  });
  it("keeps callouts and drafting words out of a name, and never reads them as a tag", () => {
    const tags = readRoomTags([
      line("A1/ A-621", 100, 0),
      line("VESTIBULE", 100, 14),
      line("100", 100, 28),
      line("ALIGN", 300, 0),
      line("RESIDENT", 300, 14),
      line("ROOM 4", 300, 28),
      line("145", 300, 42),
      line("A3", 500, 0),
      line("SIM", 500, 14),
      line("OVERHEAD CANOPY", 700, 0, 80),
      line("A-411", 700, 14),
    ]);
    expect(tags.map((t) => [t.number, t.name]).sort()).toEqual([["100", "VESTIBULE"], ["145", "RESIDENT ROOM 4"]]);
  });
  it("closes a name over a stray leader label, and says where the number sits", () => {
    const [tag] = readRoomTags([line("RESIDENT", 100, 0), line("ROOM 16", 100, 14), line("_ACCESS", 100, 28), line("162", 100, 42)]);
    expect(tag).toMatchObject({ name: "RESIDENT ROOM 16", number: "162", numberAt: { x: 100, y: 47 } });
  });
});
