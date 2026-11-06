import { describe, expect, it } from "vitest";
import { focusOf, heightFor, levelHeightFor, splitByLevel, heightItem, orderedCodes, reviewQueue, suggestType, typeItems, wallItem, windowsItem, type ReviewItem } from "./reviewQueue";
import type { WallGroup } from "./wallGroups";
import { propagatedTag } from "./planTextTags";

const sheet = { pageNumber: 3, sheet: "A101", feetPerUnit: 100 };
const run = (x1: number, x2: number, y = 0.5) => ({ x1, y1: y, x2, y2: y });

describe("the job's one review queue", () => {
  it("a held run is a wall item with its feet", () => {
    const item = wallItem(sheet, { id: "m1", xs: [0.1, 0.2], ys: [0.5, 0.5] });
    expect(item).toMatchObject({ kind: "wall", key: "wall:m1", pageNumber: 3, sheet: "A101" });
    expect((item as { feet: number }).feet).toBeCloseTo(10);
    expect(wallItem(sheet, { id: "m2", xs: [0.1, 0.2, 0.3], ys: [0, 0, 0] })).toBeNull();
  });

  it("UNTYPED WALLS GROUP BY THE DETECTION GROUP THEY CAME FROM, and a hand-drawn one is left to its line", () => {
    const groups = [
      { id: "g1", inches: 4.875, runs: [run(0.1, 0.2), run(0.3, 0.6)] },
      { id: "g2", inches: 6, runs: [run(0.7, 0.8)] },
      { id: "g3", inches: 0, runs: [run(0.0, 0.05)] },
    ];
    const untyped = [run(0.1, 0.2), run(0.3, 0.6), run(0.0, 0.05), run(0.9, 0.95)].map((r) => ({ xs: [r.x1, r.x2], ys: [r.y1, r.y2] }));
    const items = typeItems(sheet, untyped, groups);
    expect(items.map((i) => i.key)).toEqual(["type:3:g1"]);
    expect(items[0]).toMatchObject({ inches: 4.875, runs: [run(0.1, 0.2), run(0.3, 0.6)] });
    expect((items[0] as { feet: number }).feet).toBeCloseTo(40);
    // Its zoom is the group's longest run.
    expect(focusOf(items[0]!)).toEqual({ pageNumber: 3, ...run(0.3, 0.6) });
  });

  it("orders walls, then types, then scales, then prices; by sheet, longest first", () => {
    const items: ReviewItem[] = [
      { kind: "price", key: "price:l1", lineItemId: "l1", description: "Walls — untyped", quantity: "40", unit: "LF", askCost: false, costCategory: null },
      { kind: "scale", key: "scale:2", pageNumber: 2, sheet: "A102" },
      wallItem({ ...sheet, pageNumber: 5 }, { id: "far", xs: [0, 0.9], ys: [0, 0] })!,
      wallItem(sheet, { id: "short", xs: [0, 0.1], ys: [0, 0] })!,
      wallItem(sheet, { id: "long", xs: [0, 0.5], ys: [0, 0] })!,
      ...typeItems(sheet, [{ xs: [0.1, 0.2], ys: [0.5, 0.5] }], [{ id: "g", inches: 5, runs: [run(0.1, 0.2)] }]),
      heightItem({ id: "i1", name: "W1" }, [{ sheet, runs: [run(0.1, 0.2)], rooms: [] }], [])!,
    ];
    expect(reviewQueue(items).map((i) => i.key)).toEqual(["wall:long", "wall:short", "wall:far", "type:3:g", "height:i1", "scale:2", "price:l1"]);
    expect(focusOf(items[0]!)).toBeNull();
  });

  it("A WALL GROUP WITH NO HEIGHT is one item, on the sheet with most of it, offering the ceiling and the legend", () => {
    const other = { pageNumber: 4, sheet: "A102", feetPerUnit: 100 };
    const room = { xs: [0.1, 0.9, 0.9, 0.1], ys: [0.5, 0.5, 0.9, 0.9], heightFeet: 9, name: "201 CLASS", from: "tag" };
    const legend = { kind: "legend" as const, feet: 14, from: "legend W1: TO DECK → 14'-0\"" };
    const item = heightItem({ id: "i1", name: "W1" }, [
      { sheet, runs: [run(0.1, 0.2)], rooms: [] },
      { sheet: other, runs: [run(0.2, 0.8), run(0.3, 0.4)], rooms: [room] },
      { sheet: { ...sheet, pageNumber: 9 }, runs: [], rooms: [] },
    ], [legend])!;
    expect(item).toMatchObject({ kind: "height", key: "height:i1", itemId: "i1", pageNumber: 4, sheet: "A102" });
    expect((item as { feet: number }).feet).toBeCloseTo(80);
    expect((item as { options: { kind: string; feet: number }[] }).options.map((o) => [o.kind, o.feet])).toEqual([["ceiling", 9], ["legend", 14]]);
    expect(focusOf(item)).toEqual({ pageNumber: 4, ...run(0.2, 0.8) });
    expect(heightItem({ id: "i2", name: "W2" }, [{ sheet, runs: [], rooms: [] }], [legend])).toBeNull();
  });

  it("SUGGESTS THE TYPE THE DRAWING GIVES, and says where it came from", () => {
    const type = (code: string, thicknessIn: number | null = null) => ({ id: code, code, name: code, hasParts: true, thicknessIn });
    const group = (source: WallGroup["source"], candidates: ReturnType<typeof type>[], inches = 4.875): WallGroup => ({ inches, runs: [], feet: 0, source, candidates });
    expect(suggestType(group({ kind: "TAG", tag: "S6B" }, [type("S6B")]), "A101", [])).toEqual({ code: "S6B", from: "printed tag: S6B on A101" });
    expect(suggestType(group({ kind: "TAG", tag: propagatedTag("S6B") }, [type("S6B")]), "A101", [])?.from).toBe("tag carried along the wall: S6B");
    // A tag the library lacks is suggested only where the legend defines it ("Set type" adds it from there).
    expect(suggestType(group({ kind: "TAG", tag: "S9" }, []), "A101", ["S6B", "S9"])).toEqual({ code: "S9", from: "printed tag: S9 on A101, in the legend but not yet your library" });
    expect(suggestType(group({ kind: "TAG", tag: "S9" }, []), "A101", ["S6B"])).toBeNull();
    expect(suggestType(group({ kind: "REMAINDER" }, [type("W1", 4.875)]), "A101", [])).toEqual({ code: "W1", from: `the only type that thick: 4-7/8"` });
    // The note's default, only where it is the one type that thick (#989's rule).
    expect(suggestType(group({ kind: "GENERAL_NOTE", note: "ALL WALLS TYPE A U.N.O." }, [type("A")]), "A101", [])).toEqual({ code: "A", from: `legend's "unless noted otherwise"` });
    expect(suggestType(group({ kind: "GENERAL_NOTE", note: "ALL WALLS TYPE A U.N.O." }, [type("A"), type("B")]), "A101", [])).toBeNull();
    // Two types this thick and nothing naming one: the question, not an answer.
    expect(suggestType(group({ kind: "REMAINDER" }, [type("A"), type("B")]), "A101", [])).toBeNull();
  });

  it("pre-fills the type's own height, else the ceiling", () => {
    const heights = { S6B: { feet: 15, from: "legend S6B: TO DECK → 15'-0\"" } };
    const ceiling = { kind: "ceiling" as const, feet: 10, from: "ceiling plan, room 104: 10'-0\"" };
    expect(heightFor("s6b", heights, ceiling)).toEqual(heights.S6B);
    expect(heightFor("W1", heights, ceiling)).toEqual({ feet: 10, from: ceiling.from });
    expect(heightFor(null, heights, null)).toBeNull();
  });
});

describe("the drawing's type is pre-filled with its source (suggest, don't post)", () => {
  it("carries the group's suggestion onto its item, and none where the drawing named nothing", () => {
    const untyped = [{ xs: [0.1, 0.2], ys: [0.5, 0.5] }];
    expect(typeItems(sheet, untyped, [{ id: "g", inches: 5, runs: [run(0.1, 0.2)], suggested: { code: "IW-2", from: "printed tag" } }])[0]).toMatchObject({ suggested: { code: "IW-2", from: "printed tag" } });
    expect(typeItems(sheet, untyped, [{ id: "g", inches: 5, runs: [run(0.1, 0.2)] }])[0]).toMatchObject({ suggested: null });
  });

  it("puts the suggestion first and does not repeat it", () => {
    expect(orderedCodes(["IW-1", "IW-2", "IW-4"], "IW-4")).toEqual(["IW-4", "IW-1", "IW-2"]);
    expect(orderedCodes(["IW-1", "IW-2"], "C6")).toEqual(["C6", "IW-1", "IW-2"]);
    expect(orderedCodes(["IW-1", "IW-2"], null)).toEqual(["IW-1", "IW-2"]);
  });
});

describe("a group on two plans of one sheet is one item per level (by level is automatic)", () => {
  const run = (x: number) => ({ x1: x, y1: 0.1, x2: x + 0.1, y2: 0.1 });
  const item = { kind: "type", key: "type:10:g", pageNumber: 10, sheet: "A100", inches: 5, runs: [run(0.1), run(0.6), run(0.62)], feet: 30, suggested: null, ceiling: null } as Extract<ReviewItem, { kind: "type" }>;
  const levelsOf = () => [[1], [2, 3], [2, 3]];
  const heightOf = (levels: readonly number[]) => (levels[0] === 1 ? { feet: 9.667, from: "floor to floor, 1st Floor" } : { feet: 8.583, from: "floor to floor, levels 2–3" });

  it("splits by level, each with its floor-to-floor and its own key", () => {
    const got = splitByLevel(item, levelsOf, heightOf, ["A"], 100);
    expect(got.map((i) => i.kind === "type" && [i.key, i.level?.label, i.runs.length, Math.round(i.feet!)])).toEqual([
      ["type:10:g:L1", "level 1", 1, 10],
      ["type:10:g:L2,3", "levels 2–3", 2, 20],
    ]);
  });

  it("leaves a group on one level whole, and a sheet with no level untouched", () => {
    expect(splitByLevel(item, () => [[2], [2], [2]], heightOf, ["A"], 100).map((i) => i.key)).toEqual(["type:10:g"]);
    expect(splitByLevel(item, () => [[], [], []], heightOf, ["A"], 100)).toEqual([item]);
  });

  it("is the height only of a type that runs to the structure", () => {
    const level = { label: "level 1", height: { feet: 9.667, from: "x" }, codes: ["A"] };
    expect(levelHeightFor("a", level)).toEqual({ feet: 9.667, from: "x" });
    expect(levelHeightFor("C", level)).toBeNull();
    expect(levelHeightFor("A", { ...level, height: null })).toBeNull();
  });
});

describe("a sheet's counted windows are one item to confirm (suggest, don't post)", () => {
  const sheet = { pageNumber: 4, sheet: "A101", feetPerUnit: 100 };
  const stored = { windows: [{ tag: "A", x1: 0.1, y1: 0.2, x2: 0.14, y2: 0.2 }, { tag: "B", x1: 0.3, y1: 0.2, x2: 0.34, y2: 0.2 }] };

  it("lights every window and zooms to none until one is looked at", () => {
    const item = windowsItem(sheet, stored)!;
    expect(item).toMatchObject({ kind: "windows", key: "windows:4", sheet: "A101", tags: ["A", "B"], at: null });
    expect(focusOf(item)).toBeNull();
    expect(focusOf({ ...item, at: 1 } as ReviewItem)).toEqual({ pageNumber: 4, x1: 0.3, y1: 0.2, x2: 0.34, y2: 0.2 });
  });

  it("leaves the queue once decided, and is never an item with nothing in it", () => {
    expect(windowsItem(sheet, { ...stored, decided: true })).toBeNull();
    expect(windowsItem(sheet, { windows: [] })).toBeNull();
  });

  it("comes after the wall heights and before the scales", () => {
    const windows = windowsItem(sheet, stored)!;
    const scale: ReviewItem = { kind: "scale", key: "scale:1", pageNumber: 1, sheet: "A100" };
    const height: ReviewItem = { kind: "height", key: "height:x", itemId: "x", name: "S1", pageNumber: 9, sheet: "A109", runs: [], feet: null, options: [] };
    expect(reviewQueue([scale, windows, height]).map((i) => i.kind)).toEqual(["height", "windows", "scale"]);
  });
});
