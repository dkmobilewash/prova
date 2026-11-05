import { describe, expect, it } from "vitest";
import { focusOf, reviewQueue, typeItems, wallItem, type ReviewItem } from "./reviewQueue";

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
    ];
    expect(reviewQueue(items).map((i) => i.key)).toEqual(["wall:long", "wall:short", "wall:far", "type:3:g", "scale:2", "price:l1"]);
    expect(focusOf(items[0]!)).toBeNull();
  });
});
