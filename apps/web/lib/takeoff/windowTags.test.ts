import { describe, expect, it } from "vitest";
import type { WindowSymbol } from "./doorWindowSymbols";
import type { TagSymbol } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";
import { storedWindowsOf, windowsByTag, windowsToStore } from "./windowTags";

// Windows counted by their frames, each typed by the nearest tag within 3 ft.
// Page 1000 pt wide, 100 ft per page width: 1 ft = 10 pt.
const W = 1000;
const tag = (text: string, xFt: number, yFt: number, rejected: TagSymbol["rejected"] = null): TagSymbol =>
  ({ x: xFt * 10, y: yFt * 10, radius: 4, corners: 6, shape: "hexagon", text, parts: [text], split: false, leader: null, rejected }) as TagSymbol;
// An exterior wall along y = 20 ft, from x = 0 to 80 ft.
const walls = [{ x1: 0, y1: 0.2, x2: 0.8, y2: 0.2, thicknessFeet: 0.5, lengthFeet: 80 }] as WallCandidate[];
const frame = (xFt: number): WindowSymbol => ({ kind: "window", x1: (xFt - 2) / 100, y1: 0.2, x2: (xFt + 2) / 100, y2: 0.2, widthFeet: 4, wall: 0, lines: 3 });
const rows = [{ mark: "W1", size: `4'-0" W x 4'-0" H` }, { mark: "W2", size: null }];
const run = (symbols: TagSymbol[], extra: Partial<Parameters<typeof windowsByTag>[0]> = {}) =>
  windowsByTag({ symbols, widthPt: W, windowRows: rows, frames: [], walls, feetPerUnit: 100, ...extra });

describe("windows counted by their openings, typed by the nearest tag", () => {
  it("counts each tagged frame as one window of the tag's type, in schedule order", () => {
    const got = run([tag("W2", 10, 21.5), tag("W1", 30, 21.5), tag("W-1", 50, 18.5)], { frames: [frame(10), frame(30), frame(50)] });
    expect(got.counted).toBe(true);
    expect(got.vocabulary).toBe("schedule");
    expect(got.byTag.map((t) => [t.tag, t.count])).toEqual([["W1", 2], ["W2", 1]]);
    expect(got.windows.find((w) => w.tag === "W2")?.row?.mark).toBe("W2");
  });

  it("ONE TAG NAMES SEVERAL WINDOWS: Topeka's A hexagon between two windows types both", () => {
    const got = run([tag("W1", 30, 21.5)], { frames: [frame(27.5), frame(32.5)] });
    expect(got.windows.map((w) => [w.tag, w.frame])).toEqual([["W1", 0], ["W1", 1]]);
  });

  it("never counts a frame with no tag within 3 ft, nor a tag with no frame", () => {
    // A porch's sliding door, drawn with the same lines, 4 ft from the nearest tag.
    expect(run([tag("W1", 30, 24)], { frames: [frame(30)] }).windows).toHaveLength(0);
    // A tag in a legend or beside a wall with no opening drawn.
    expect(run([tag("W1", 30, 21.5)], { frames: [frame(70)] }).counted).toBe(false);
  });

  it("types a frame by the nearest tag when two are within reach", () => {
    const got = run([tag("W1", 30, 22.5), tag("W2", 31, 21)], { frames: [frame(31)] });
    expect(got.windows.map((w) => w.tag)).toEqual(["W2"]);
  });

  it("measures from where a tag's leader points as well as from the tag", () => {
    const pointing = { ...tag("W2", 30, 28), leader: { x: 300, y: 205 } } as TagSymbol;
    expect(run([pointing], { frames: [frame(30)] }).windows.map((w) => w.tag)).toEqual(["W2"]);
  });

  it("leaves windows to check where the set has a schedule but this sheet has no tag", () => {
    expect(run([], { frames: [frame(30)] }).counted).toBe(false);
  });

  it("types with a W tag the schedule read lacks, with no row, but not a wall type spelled like one", () => {
    const got = run([tag("W5", 30, 21.5), tag("W4", 50, 21.5)], { wallCodes: ["W4"], frames: [frame(30), frame(50)] });
    expect(got.windows.map((w) => [w.tag, w.row])).toEqual([["W5", null]]);
  });

  it("without a schedule, types with W tags only where the sheet carries enough to mean it", () => {
    const three = [tag("W1", 10, 21.5), tag("W2", 30, 21.5), tag("W1", 50, 21.5)];
    expect(run(three, { windowRows: [], frames: [frame(10)] }).vocabulary).toBe("w-tags");
    expect(run(three.slice(0, 2), { windowRows: [], frames: [frame(10)] })).toEqual({ counted: false, vocabulary: null, windows: [], byTag: [] });
  });

  it("is not a door mark or a rejected symbol", () => {
    expect(run([tag("101", 30, 21.5), tag("W1", 50, 21.5, "no-text")], { frames: [frame(30), frame(50)] }).windows).toHaveLength(0);
  });

  it("types with a letter tag the schedule read missed, drawn in the same symbol as a scheduled one (Topeka's B and C)", () => {
    const letterRows = [{ mark: "A", size: null }, { mark: "D", size: null }];
    const got = run([tag("A", 10, 21.5), tag("B", 30, 21.5), { ...tag("C", 50, 21.5), shape: "square" } as TagSymbol], { windowRows: letterRows, frames: [frame(10), frame(30), frame(50)] });
    expect(got.windows.map((w) => w.tag)).toEqual(["A", "B"]);
    // A wall code spelled like a letter is not one.
    expect(run([tag("A", 10, 21.5), tag("B", 30, 21.5)], { windowRows: letterRows, wallCodes: ["B"], frames: [frame(10), frame(30)] }).windows.map((w) => w.tag)).toEqual(["A"]);
  });
});
describe("what a counted sheet stores for the review queue", () => {
  it("stores each counted window on its frame's line, and nothing for a sheet not counted", () => {
    const frames = [frame(10), frame(30)];
    const got = run([tag("W1", 10, 21.5), tag("W2", 30, 21.5)], { frames });
    expect(windowsToStore(got, frames)).toEqual({ windows: [{ tag: "W1", ...frames[0]! }, { tag: "W2", ...frames[1]! }].map(({ tag, x1, y1, x2, y2 }) => ({ tag, x1, y1, x2, y2 })) });
    expect(windowsToStore(run([], { frames }), frames)).toBeNull();
  });

  it("reads back a stored suggestion, dropping a malformed window, and refuses anything else", () => {
    expect(storedWindowsOf({ windows: [{ tag: "A", x1: 0, y1: 0, x2: 1, y2: 0 }, { tag: "B", x1: "x" }], decided: true })).toEqual({ windows: [{ tag: "A", x1: 0, y1: 0, x2: 1, y2: 0 }], decided: true });
    expect(storedWindowsOf(null)).toBeNull();
    expect(storedWindowsOf({ feet: 3 })).toBeNull();
  });
});
