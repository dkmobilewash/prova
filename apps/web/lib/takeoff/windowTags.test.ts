import { describe, expect, it } from "vitest";
import type { WindowSymbol } from "./doorWindowSymbols";
import type { TagSymbol } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";
import { windowsByTag } from "./windowTags";

// Windows counted by the tags drawn beside them; the frame finder only places
// a tag's window. Page 1000 pt wide, 100 ft per page width: 1 ft = 10 pt.
const W = 1000;
const tag = (text: string, xFt: number, yFt: number, rejected: TagSymbol["rejected"] = null): TagSymbol =>
  ({ x: xFt * 10, y: yFt * 10, radius: 4, corners: 6, shape: "hexagon", text, parts: [text], split: false, leader: null, rejected }) as TagSymbol;
// An exterior wall along y = 20 ft, from x = 0 to 80 ft.
const walls = [{ x1: 0, y1: 0.2, x2: 0.8, y2: 0.2, thicknessFeet: 0.5, lengthFeet: 80 }] as WallCandidate[];
const frame = (xFt: number): WindowSymbol => ({ kind: "window", x1: (xFt - 2) / 100, y1: 0.2, x2: (xFt + 2) / 100, y2: 0.2, widthFeet: 4, wall: 0, lines: 3 });
const rows = [{ mark: "W1", size: `4'-0" W x 4'-0" H` }, { mark: "W2", size: null }];
const run = (symbols: TagSymbol[], extra: Partial<Parameters<typeof windowsByTag>[0]> = {}) =>
  windowsByTag({ symbols, widthPt: W, windowRows: rows, frames: [], walls, feetPerUnit: 100, ...extra });

describe("windows counted by tag", () => {
  it("counts each schedule tag near a wall as one window of that type, in schedule order", () => {
    const got = run([tag("W2", 10, 23), tag("W1", 30, 23), tag("W-1", 50, 17)]);
    expect(got.counted).toBe(true);
    expect(got.vocabulary).toBe("schedule");
    expect(got.byTag.map((t) => [t.tag, t.count])).toEqual([["W1", 2], ["W2", 1]]);
    expect(got.windows.find((w) => w.tag === "W2")?.row?.mark).toBe("W2");
  });

  it("does not count a tag far from every wall and frame: a legend, an elevation or a note", () => {
    expect(run([tag("W1", 30, 60)]).windows).toHaveLength(0);
  });

  it("reads one symbol once, and places the window on the frame drawn by the tag", () => {
    const got = run([tag("W1", 30, 23), tag("W1", 30.2, 23)], { frames: [frame(31)] });
    expect(got.windows).toHaveLength(1);
    expect(got.windows[0]).toMatchObject({ tag: "W1", frame: 0, x: 0.31, y: 0.2 });
  });

  it("reads one symbol once when one reading has a leader and the other does not (Bunkie W2)", () => {
    const withLeader = { ...tag("W2", 30, 23), leader: { x: 330, y: 205 } } as TagSymbol;
    const got = run([withLeader, tag("W2", 30.3, 23)], { frames: [frame(33)] });
    expect(got.windows).toHaveLength(1);
    // Two tags of one type side by side are still two windows.
    expect(run([tag("W2", 10, 23), tag("W2", 20, 23)]).windows).toHaveLength(2);
  });

  it("leaves windows to check where the set has a schedule but this sheet has no tag", () => {
    expect(run([]).counted).toBe(false);
  });

  it("puts an unframed tag's window on the nearest wall, and never counts a frame with no tag", () => {
    const got = run([tag("W1", 30, 23)], { frames: [frame(70)] });
    expect(got.windows).toHaveLength(1);
    expect(got.windows[0]).toMatchObject({ tag: "W1", frame: null, row: expect.objectContaining({ mark: "W1" }) });
    expect(got.windows[0]!.x).toBeCloseTo(0.3, 9);
    expect(got.windows[0]!.y).toBeCloseTo(0.2, 9);
  });

  it("counts a W tag the schedule read lacks, with no row, but not a wall type spelled like one", () => {
    const got = run([tag("W5", 30, 23), tag("W4", 50, 23)], { wallCodes: ["W4"] });
    expect(got.windows.map((w) => [w.tag, w.row])).toEqual([["W5", null]]);
  });

  it("without a schedule, counts W tags only where the sheet carries enough to mean it", () => {
    const three = [tag("W1", 10, 23), tag("W2", 30, 23), tag("W1", 50, 23)];
    expect(run(three, { windowRows: [] }).vocabulary).toBe("w-tags");
    expect(run(three.slice(0, 2), { windowRows: [] })).toEqual({ counted: false, vocabulary: null, windows: [], byTag: [] });
  });

  it("is not a door mark or a rejected symbol", () => {
    expect(run([tag("101", 30, 23), tag("W1", 50, 23, "no-text")]).windows).toHaveLength(0);
  });
});
