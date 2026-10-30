import { describe, expect, it } from "vitest";
import { alignCeilingPage, ceilingSummary, ceilingsForRooms } from "./roomCeilings";
import type { PositionedText } from "./roomTags";
import type { RoomFromWalls } from "./roomsFromWalls";

const W = 2592;
const t = (str: string, x: number, y: number, height = 9.6): PositionedText => ({ str, x: x * W, y: y * W, width: str.length * 5, height });
const room = (id: number, name: string, number: string | null, x: number, y: number, sf = 100): RoomFromWalls => ({
  id,
  squareFeet: sf,
  perimeterFeet: 40,
  xs: [x - 0.03, x + 0.03, x + 0.03, x - 0.03],
  ys: [y - 0.03, y - 0.03, y + 0.03, y + 0.03],
  tag: { name, number, areaSf: null, x: x * W, y: y * W },
});

describe("ceilingsForRooms", () => {
  it("takes the ceiling plan page's stack for a room by its number, Baker-style by its name, and a schedule row for a third", () => {
    const rooms = [room(0, "STORAGE", "106", 0.2, 0.2), room(1, "LOBBY", "100", 0.4, 0.2, 300), room(2, "OFFICE", "102", 0.6, 0.2)];
    const rcp = {
      pageNumber: 14,
      widthPt: W,
      items: [
        t("STORAGE", 0.52, 0.32), t("GB", 0.52, 0.326), t("10'-0\" A.F.F.", 0.513, 0.332),
        t("LOBBY", 0.3, 0.5), t("100", 0.302, 0.505), t("12'-0\" ACT", 0.298, 0.51),
      ],
    };
    const schedule = { pageNumber: 51, widthPt: W, items: [], tableRows: [{ y: 1, cells: ["Rm #", "Name", "Ceiling Finish", "Ceiling Ht."] }, { y: 2, cells: ["102", "OFFICE", "GYP.BD.", "9' - 0\""] }] };
    const out = ceilingsForRooms({ rooms, current: { pageNumber: 13, widthPt: W, items: rooms.map((r) => t(r.tag!.name, r.tag!.x / W, r.tag!.y / W)) }, feetPerUnit: 288, others: [rcp, schedule] });
    expect(out.get(0)).toMatchObject({ family: "GYP", code: "GB", heightFeet: 10, from: "tag", guess: false, page: 14 });
    expect(out.get(1)).toMatchObject({ family: "ACT", heightFeet: 12, from: "tag", page: 14 });
    expect(out.get(2)).toMatchObject({ family: "GYP", heightFeet: 9, from: "schedule", code: "GYP.BD." });
  });
  it("does not take a floor plan's own figures for ceiling heights, and joins CALL CENTER to 911 CALL CENTER", () => {
    const rooms = [room(0, "CALL CENTER", "111", 0.3, 0.3)];
    const current = { pageNumber: 13, widthPt: W, items: [t("CALL CENTER", 0.3, 0.3), t("111", 0.302, 0.305), t("18'-6\"", 0.3, 0.31)] };
    expect(ceilingsForRooms({ rooms, current, feetPerUnit: 288 }).get(0)).toMatchObject({ heightFeet: null, from: null });
    const rcp = { pageNumber: 14, widthPt: W, items: [t("REFLECTED CEILING PLAN - LEVEL 01", 0.3, 0.9, 14), t("911 CALL CENTER", 0.6, 0.4), t("ACT", 0.603, 0.405), t("10'-0\" A.F.F.", 0.598, 0.41)] };
    expect(ceilingsForRooms({ rooms, current, feetPerUnit: 288, others: [rcp] }).get(0)).toMatchObject({ family: "ACT", heightFeet: 10, from: "tag", page: 14 });
  });
  it("marks a prefix guess as a guess, and falls to the sheet's note when nothing names the room", () => {
    const rooms = [room(0, "ELEC", "011B", 0.2, 0.2), room(1, "HALL", "138", 0.5, 0.5)];
    const current = {
      pageNumber: 1,
      widthPt: W,
      items: [t("RCP - GROUND LEVEL", 0.1, 0.95, 14), t("ELEC", 0.2, 0.2), t("011B", 0.202, 0.205), t("11' - 0\"", 0.2, 0.21), t("AC01", 0.202, 0.214), t("HALL", 0.5, 0.5), t("138", 0.502, 0.505), t("8.", 0.8, 0.9), t("ALL CEILINGS SHALL BE 9'-0\" AFF UNLESS OTHERWISE NOTED.", 0.81, 0.9)],
    };
    const out = ceilingsForRooms({ rooms, current, feetPerUnit: 288 });
    expect(out.get(0)).toMatchObject({ family: "ACT", heightFeet: 11, from: "prefix", guess: true });
    expect(out.get(1)).toMatchObject({ family: null, heightFeet: 9, from: "note", guess: false });
  });
  it("sums square feet by family for the summary line", () => {
    expect(ceilingSummary([{ family: "ACT", squareFeet: 100, code: "2x2 grid" }, { family: "ACT", squareFeet: 50, code: "2x2 grid" }, { family: "GYP", squareFeet: 30 }, { family: null, squareFeet: 10 }])).toEqual([
      { label: "ACT 2x2 grid", family: "ACT 2x2 grid", squareFeet: 150 },
      { label: "gypsum board", family: "GYP", squareFeet: 30 },
      { label: "no ceiling read", family: "unknown", squareFeet: 10 },
    ]);
  });
});

describe("the same footprint on the ceiling plan — alignment, position join, hatch", () => {
  // Three floor rooms; the RCP prints its room tags at the same places, so it is aligned at zero shift.
  const rooms = [room(0, "CLASSROOM", "123", 0.2, 0.2), room(1, "HALL", "138", 0.4, 0.2), room(2, "STORAGE", null, 0.6, 0.2)];
  rooms[2]!.tag = null; // the floor plan never tagged the third room
  const rcpTags = [t("CLASSROOM", 0.2, 0.2), t("123", 0.202, 0.205), t("HALL", 0.4, 0.2), t("138", 0.402, 0.205), t("STORAGE", 0.6, 0.2), t("139", 0.602, 0.205)];
  const title = t("OVERALL REFLECTED CEILING PLAN", 0.5, 0.95, 14);
  /** A 2x2 grid hatch over one room: lines every 2 ft (288 ft per page width) inside its 0.06 box. */
  const grid = (x: number, y: number) => {
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = -0.028; i <= 0.028; i += 2 / 288) {
      out.push({ x1: x - 0.03, y1: y + i, x2: x + 0.03, y2: y + i });
      out.push({ x1: x + i, y1: y - 0.03, x2: x + i, y2: y + 0.03 });
    }
    return out;
  };
  it("aligns a ceiling plan whose room tags land inside the floor plan's rooms, and not one drawn elsewhere", () => {
    const here = alignCeilingPage({ pageNumber: 48, widthPt: W, items: [title, ...rcpTags] }, rooms);
    expect(here).toMatchObject({ dx: 0, dy: 0, hits: 3 });
    const shifted = alignCeilingPage({ pageNumber: 48, widthPt: W, items: [title, ...rcpTags.map((i) => ({ ...i, x: i.x + 0.1 * W, y: i.y + 0.05 * W }))] }, rooms);
    expect(shifted).toMatchObject({ hits: 3 });
    // Any shift within half a room box lands all three; the search returns the first such.
    expect(shifted!.dx).toBeCloseTo(0.1, 1);
    expect(shifted!.dy).toBeCloseTo(0.05, 1);
    const elsewhere = alignCeilingPage({ pageNumber: 48, widthPt: W, items: [title, t("OFFICE", 0.8, 0.8), t("201", 0.802, 0.805), t("OFFICE", 0.9, 0.8), t("202", 0.902, 0.805), t("OFFICE", 0.8, 0.9), t("203", 0.802, 0.905)] }, rooms);
    expect(elsewhere).toBeNull();
  });
  it("gives an untagged floor room the ceiling tag the RCP printed inside it, and reads the family off the hatch when the tag is only a height", () => {
    const rcp = {
      pageNumber: 48,
      widthPt: W,
      items: [title, ...rcpTags, t("9'-0\"", 0.6, 0.21), t("ACT", 0.603, 0.215), t("10'-0\"", 0.2, 0.21)],
      strokes: grid(0.2, 0.2),
    };
    const out = ceilingsForRooms({ rooms, current: { pageNumber: 46, widthPt: W, items: [t("CLASSROOM", 0.2, 0.2), t("123", 0.202, 0.205), t("HALL", 0.4, 0.2), t("138", 0.402, 0.205)] }, feetPerUnit: 288, others: [rcp] });
    // STORAGE: no floor tag; the RCP's "139 / 9'-0" ACT" sits inside it.
    expect(out.get(2)).toMatchObject({ family: "ACT", heightFeet: 9, from: "tag", page: 48 });
    // CLASSROOM: its tag says 10'-0" and nothing else; the 2x2 grid drawn over it on the RCP says ACT.
    expect(out.get(0)).toMatchObject({ family: "ACT", heightFeet: 10, from: "pattern", page: 48 });
    // HALL: no tag, no hatch — nothing is invented.
    expect(out.get(1)).toMatchObject({ family: null });
  });
});
