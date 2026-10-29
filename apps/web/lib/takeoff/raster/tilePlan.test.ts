import { describe, expect, it } from "vitest";
import { BLANK_TILE_INK, inkIn, planTiles } from "./tilePlan.mjs";

/** A 40 x 20 grey, white, with a dark block where `ink` says. */
function grey(ink: { x: number; y: number; w: number; h: number }[]): Uint8Array {
  const g = new Uint8Array(40 * 20).fill(255);
  for (const b of ink) for (let y = b.y; y < b.y + b.h; y += 1) for (let x = b.x; x < b.x + b.w; x += 1) g[y * 40 + x] = 0;
  return g;
}

describe("which tiles get read", () => {
  // Tile 10, overlap 2: columns start at 0, 8, 16, 24, 32; rows at 0, 8, 16 (the last four rows tall).
  it("drops a tile with no ink, keeps its key, and keeps the order a single worker would read in", () => {
    const g = grey([{ x: 18, y: 1, w: 12, h: 8 }]); // 96 dark pixels: 64 in the tile at x 16, 48 at x 24, 8 in each row-8 tile
    const { plan, tileKeys } = planTiles(g, 40, 20, 10, 2, null, new Set());
    expect(tileKeys).toEqual(["0:0", "8:0", "16:0", "24:0", "32:0", "0:8", "8:8", "16:8", "24:8", "32:8", "0:16", "8:16", "16:16", "24:16", "32:16"]);
    expect(plan).toEqual([
      { x0: 16, y0: 0, tw: 10, th: 10 },
      { x0: 24, y0: 0, tw: 10, th: 10 },
    ]);
  });
  it("reads only the tiles touching a region, and never one already read", () => {
    const g = grey([{ x: 0, y: 0, w: 40, h: 20 }]); // all ink
    const { plan, tileKeys } = planTiles(g, 40, 20, 10, 2, [{ x: 0, y: 0, width: 5, height: 5 }], new Set(["0:0"]));
    expect(tileKeys).toEqual([]);
    expect(plan).toEqual([]);
    const again = planTiles(g, 40, 20, 10, 2, [{ x: 0, y: 0, width: 5, height: 5 }], new Set());
    expect(again.tileKeys).toEqual(["0:0"]);
    expect(again.plan).toEqual([{ x0: 0, y0: 0, tw: 10, th: 10 }]);
  });
  it("stops counting ink once there is enough, and a single glyph is enough", () => {
    const g = grey([{ x: 0, y: 0, w: 10, h: 10 }]);
    expect(inkIn(g, 40, 0, 0, 10, 10, BLANK_TILE_INK)).toBe(BLANK_TILE_INK);
    expect(inkIn(g, 40, 10, 0, 10, 10, BLANK_TILE_INK)).toBe(0);
    expect(BLANK_TILE_INK).toBeLessThan(100);
  });
});
