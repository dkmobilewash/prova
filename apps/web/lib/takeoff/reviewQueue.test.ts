import { describe, expect, it } from "vitest";
import { focusOf, heightFor, heightItem, reviewQueue, suggestType, typeItems, wallItem, type ReviewItem } from "./reviewQueue";
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
      { kind: "price", key: "price:l1", lineItemId: "l1", description: "Walls — untyped", quantity: "40", unit: "LF" },
      { kind: "scale", key: "scale:2", pageNumber: 2, sheet: "A102" },
      wallItem({ ...sheet, pageNumber: 5 }, { id: "far", xs: [0, 0.9], ys: [0, 0] })!,
      wallItem(sheet, { id: "short", xs: [0, 0.1], ys: [0, 0] })!,
      wallItem(sheet, { id: "long", xs: [0, 0.5], ys: [0, 0] })!,
      ...typeItems(sheet, [{ xs: [0.1, 0.2], ys: [0.5, 0.5] }], [{ id: "g", inches: 5, runs: [run(0.1, 0.2)] }]),
      heightItem({ id: "i1", name: "W1" }, [{ sheet, runs: [run(0.1, 0.2)], rooms: [] }], null)!,
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
    ], legend)!;
    expect(item).toMatchObject({ kind: "height", key: "height:i1", itemId: "i1", pageNumber: 4, sheet: "A102" });
    expect((item as { feet: number }).feet).toBeCloseTo(80);
    expect((item as { options: { kind: string; feet: number }[] }).options.map((o) => [o.kind, o.feet])).toEqual([["ceiling", 9], ["legend", 14]]);
    expect(focusOf(item)).toEqual({ pageNumber: 4, ...run(0.2, 0.8) });
    expect(heightItem({ id: "i2", name: "W2" }, [{ sheet, runs: [], rooms: [] }], legend)).toBeNull();
  });

  it("SUGGESTS THE TYPE THE DRAWING GIVES, and says where it came from", () => {
    const type = (code: string, thicknessIn: number | null = null) => ({ id: code, code, name: code, hasParts: true, thicknessIn });
    const group = (source: WallGroup["source"], candidates: ReturnType<typeof type>[], inches = 4.875): WallGroup => ({ inches, runs: [], feet: 0, source, candidates });
    expect(suggestType(group({ kind: "TAG", tag: "S6B" }, [type("S6B")]), "A101", [])).toEqual({ code: "S6B", from: "tag S6B on A101" });
    expect(suggestType(group({ kind: "TAG", tag: propagatedTag("S6B") }, [type("S6B")]), "A101", [])?.from).toBe("tag S6B carried along the wall on A101");
    // A tag the library lacks is suggested only where the legend defines it ("Set type" adds it from there).
    expect(suggestType(group({ kind: "TAG", tag: "S9" }, []), "A101", ["S6B", "S9"])).toEqual({ code: "S9", from: "tag S9 on A101, from the legend" });
    expect(suggestType(group({ kind: "TAG", tag: "S9" }, []), "A101", ["S6B"])).toBeNull();
    expect(suggestType(group({ kind: "REMAINDER" }, [type("W1", 4.875)]), "A101", [])).toEqual({ code: "W1", from: `the only 4-7/8" type in your library` });
    expect(suggestType(group({ kind: "GENERAL_NOTE", note: "ALL WALLS TYPE A U.N.O." }, [type("A"), type("B")]), "A101", [])).toEqual({ code: "A", from: "sheet note: ALL WALLS TYPE A U.N.O." });
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
