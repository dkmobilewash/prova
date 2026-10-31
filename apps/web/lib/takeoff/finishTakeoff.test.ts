import { describe, expect, it } from "vitest";
import { readFinishSchedule, type TextItem } from "./finishSchedule";
import { finishTakeoff, roomEdges, typesFromNeighbours, typeTagsInRooms } from "./finishTakeoff";
import type { RoomFromWalls } from "./roomsFromWalls";

const t = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5, height: 8 });
const header = [t("ROOM", 100, 90), t("NUMBER", 100, 100), t("ROOM NAME", 160, 100), t("FLOOR", 260, 90), t("FINISH", 260, 100), t("BASE", 320, 90), t("FINISH", 320, 100), t("NORTH", 380, 100), t("EAST", 430, 100), t("SOUTH", 480, 100), t("WEST", 530, 100), t("CEILIING FINISH", 590, 100)];
const row = (y: number, n: string, name: string, cells: string[]) => [t(n, 100, y), t(name, 160, y), ...cells.map((c, i) => t(c, [260, 320, 380, 430, 480, 530, 590][i], y))];

describe("readFinishSchedule", () => {
  it("reads a row per room with a finish per side, past other text sharing the row", () => {
    const s = readFinishSchedule([...header, ...row(120, "105", "CONFERENCE", ["CPTT-1", "WB-1", "P-1", "P-1", "P-1", "P-2", "ACT-1"]), t("CARPET TILE 1 NOTES", 20, 120), t("PREPARE SUBSTRATE", 900, 120), ...row(135, "107", "COMM", ["RF-2", "WB-1", "P-1", "-", "P-1", "P-1", "GYP-1"])])!;
    expect(s.byType).toBe(false);
    expect(s.rows.map((r) => r.key)).toEqual(["105", "107"]);
    expect(s.rows[0]).toMatchObject({ name: "CONFERENCE", floor: "CPTT-1", base: "WB-1", ceiling: "ACT-1", sides: { N: "P-1", E: "P-1", S: "P-1", W: "P-2" } });
    expect(s.rows[1].sides?.E).toBeNull();
  });
  it("reads a schedule of finish types, once where the page repeats it", () => {
    const h = [t("FINISH TYPE", 100, 100), t("FLOOR", 200, 100), t("WALL", 280, 100), t("BASE", 360, 100), t("CEILING", 440, 100)];
    const r = (y: number, k: string) => [t(k, 110, y), t("LVT-1", 200, y), t("PT-3", 280, y), t("RB-3", 360, y), t("PT-2", 440, y)];
    const s = readFinishSchedule([...h, ...r(120, "T1"), ...r(135, "T2"), ...h.map((i) => ({ ...i, y: i.y + 400 })), ...r(520, "T1")])!;
    expect(s.byType).toBe(true);
    expect(s.rows.map((x) => [x.key, x.floor, x.wall, x.base, x.ceiling])).toEqual([["T1", "LVT-1", "PT-3", "RB-3", "PT-2"], ["T2", "LVT-1", "PT-3", "RB-3", "PT-2"]]);
  });
  it("finds nothing on a page with no schedule", () => {
    expect(readFinishSchedule([t("FLOOR PLAN", 100, 100), t("BASE BID", 200, 100)])).toBeNull();
  });
});

const FPU = 100; // 1 ft = 0.01 units
const room = (id: number, number: string | null, x: number, y: number, w: number, h: number): RoomFromWalls => ({ id, squareFeet: w * h * FPU * FPU, perimeterFeet: 2 * (w + h) * FPU, xs: [x, x + w, x + w, x], ys: [y, y, y + h, y + h], tag: number === null ? null : ({ name: "R", number, areaSf: null, x, y } as never) });
const finishes = { name: "R", floor: "CPT-1", base: "RB-1", wall: null, ceiling: "ACT-1" };
const schedule = { byType: false, rows: [{ key: "101", ...finishes, sides: { N: "P-1", E: "P-1", S: "P-1", W: "P-2" } }, { key: "999", ...finishes, sides: null, wall: "P-1" }] };
const door = (x: number, y: number) => ({ kind: "door", hinge: { x: x - 0.015, y }, strike: { x: x + 0.015, y }, widthFeet: 3, wall: null, leaves: 1, sweepDegrees: 90 }) as never;

describe("finishTakeoff", () => {
  it("gives floor, ceiling, base and paint per finish, and takes the door off its own wall", () => {
    const r = room(1, "101", 0.1, 0.1, 0.2, 0.1); // 20 x 10 ft
    const out = finishTakeoff({ rooms: [r], schedule, doors: [door(0.2, 0.2)], windows: [], feetPerUnit: FPU, heightOf: () => 9 });
    const by = Object.fromEntries(out.lines.map((l) => [`${l.kind} ${l.finish}`, l.quantity]));
    expect(by["floor CPT-1"]).toBeCloseTo(200);
    expect(by["ceiling ACT-1"]).toBeCloseTo(200);
    expect(by["base RB-1"]).toBeCloseTo(57);
    expect(by["wall P-1"]).toBeCloseTo((20 + 10 + 20) * 9 - 21);
    expect(by["wall P-2"]).toBeCloseTo(10 * 9);
    expect(out.doorsDeducted).toBe(1);
    expect(out.unjoinedRows.map((x) => x.key)).toEqual(["999"]);
  });
  it("a door between two rooms comes off both, because both faces are finished", () => {
    const a = room(1, "101", 0.1, 0.1, 0.2, 0.1), b = { ...room(2, "101", 0.1, 0.2, 0.2, 0.1) };
    expect(finishTakeoff({ rooms: [a, b], schedule, doors: [door(0.2, 0.2)], windows: [], feetPerUnit: FPU, heightOf: () => 9 }).doorsDeducted).toBe(2);
  });
  it("leaves wall area out and names the room when the height is unknown", () => {
    const r = room(1, "101", 0.1, 0.1, 0.2, 0.1);
    const out = finishTakeoff({ rooms: [r], schedule, doors: [], windows: [], feetPerUnit: FPU, heightOf: () => null });
    expect(out.lines.some((l) => l.kind === "wall")).toBe(false);
    expect(out.noHeight).toEqual([r]);
  });
  it("a room the schedule does not name is reported, and existing finishes are not priced", () => {
    const out = finishTakeoff({ rooms: [room(1, "500", 0.1, 0.1, 0.1, 0.1), room(2, null, 0.3, 0.1, 0.1, 0.1)], schedule, doors: [], windows: [], feetPerUnit: FPU, heightOf: () => 9 });
    expect(out.unjoinedRooms).toHaveLength(2);
    const ex = { byType: false, rows: [{ key: "1", name: null, floor: "EX CT", base: "RB-1", wall: "EX", sides: null, ceiling: "EXPOSED" }] };
    expect(finishTakeoff({ rooms: [room(1, "1", 0.1, 0.1, 0.1, 0.1)], schedule: ex, doors: [], windows: [], feetPerUnit: FPU, heightOf: () => 9 }).lines.map((l) => l.kind)).toEqual(["base"]);
  });
  it("joins a type schedule through the tag inside the room", () => {
    const rooms = [room(1, null, 0.1, 0.1, 0.1, 0.1), room(2, null, 0.3, 0.1, 0.1, 0.1)];
    const tags = typeTagsInRooms(rooms, [{ str: "T-2", x: 1400, y: 1500, width: 10, height: 8 }], 10000, new Set(["T1", "T2"]));
    expect([...tags]).toEqual([[1, "T2"]]);
    const two = typeTagsInRooms(rooms, [{ str: "T1", x: 1200, y: 1500, width: 10, height: 8 }, { str: "T2", x: 1400, y: 1500, width: 10, height: 8 }], 10000, new Set(["T1", "T2"]));
    expect(two.size).toBe(0);
  });
  it("names each edge by its side of the room", () => {
    expect(roomEdges(room(1, null, 0.1, 0.1, 0.2, 0.1), FPU).map((e) => e.side)).toEqual(["N", "E", "S", "W"]);
  });
  it("counts a leaked region only for the finishes its rooms share, and names what it left out", () => {
    const rows = [{ key: "1", name: "HALL", floor: "TCF-1", base: "RB-1", wall: "PT-1", sides: null, ceiling: "ACT-1" }, { key: "2", name: "OFFICE", floor: "TCF-1", base: "RB-2", wall: "PT-1", sides: null, ceiling: "ACT-1" }];
    const leaked = { ...room(1, null, 0.1, 0.1, 0.2, 0.1), sharedTags: [{ number: "1" }, { number: "2" }, { number: "A3" }] as never };
    const out = finishTakeoff({ rooms: [leaked], schedule: { byType: false, rows }, doors: [], windows: [], feetPerUnit: FPU, heightOf: () => 9 });
    expect(out.lines.map((l) => `${l.kind} ${l.finish}`)).toEqual(["floor TCF-1", "wall PT-1", "ceiling ACT-1"]);
    expect(out.shared.map((s) => [s.rows.length, s.differ])).toEqual([[2, ["base"]]]);
    expect(out.unjoinedRows).toEqual([]);
  });
  it("a stray tag cannot unseat the one room the schedule knows", () => {
    const leaked = { ...room(1, null, 0.1, 0.1, 0.2, 0.1), sharedTags: [{ number: "101" }, { number: "A3" }] as never };
    const out = finishTakeoff({ rooms: [leaked], schedule, doors: [], windows: [], feetPerUnit: FPU, heightOf: () => 9 });
    expect(out.joined.map((j) => j.row.key)).toEqual(["101"]);
    expect(out.shared).toEqual([]);
  });
  it("an untagged region takes a type only when all its typed neighbours agree", () => {
    const a = room(1, null, 0.1, 0.1, 0.1, 0.1), b = room(2, null, 0.2, 0.1, 0.1, 0.1), c = room(3, null, 0.3, 0.1, 0.1, 0.1), far = room(4, null, 0.6, 0.1, 0.1, 0.1);
    expect([...typesFromNeighbours([a, b, c, far], new Map([[1, "T1"]]), FPU)]).toEqual([[2, "T1"], [3, "T1"]]);
    expect(typesFromNeighbours([a, b, c], new Map([[1, "T1"], [3, "T2"]]), FPU).size).toBe(0);
    const shaft = room(5, null, 0.1, 0.1, 0.05, 0.05);
    expect(typesFromNeighbours([shaft, b], new Map([[5, "T7"]]), FPU).size).toBe(0);
  });
});
