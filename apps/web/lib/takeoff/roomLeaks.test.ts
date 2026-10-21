import { describe, expect, it } from "vitest";
import { leakHints } from "./roomLeaks";
import type { FoundWall } from "./roomsFromWalls";

const W = 100;
const ft = (n: number) => n / W;
const wall = (x1: number, y1: number, x2: number, y2: number): FoundWall => ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), thicknessFeet: 0.5 });
const text = (str: string, xFt: number, yFt: number) => ({ str, x: xFt * 10 - 20, y: yFt * 10, width: 40, height: 6 });

describe("leakHints", () => {
  it("names the wall end and the length that closes a room missing 3 ft of wall", () => {
    // A 10x10 room whose right wall stops 3 ft short of the bottom — too wide
    // and too far from a face for any door rule — so the tag leaks out.
    const walls = [wall(0, 0, 10, 0), wall(0, 10, 10, 10), wall(0, 0, 0, 10), wall(10, 0, 10, 7)];
    const hints = leakHints({ walls, feetPerUnit: W, widthPt: 1000, text: [text("OFFICE", 5, 4), text("101", 5, 5)] });
    expect(hints).toHaveLength(1);
    const h = hints[0].hint!;
    expect(hints[0].tag.number).toBe("101");
    expect(h.wall).toBe(3);
    expect(h.lengthFeet).toBe(3);
    expect(h.x).toBeCloseTo(ft(10));
    expect(h.y).toBeCloseTo(ft(7));
    expect(h.dy).toBe(1);
    expect(h.squareFeet).toBeGreaterThan(85); // 9.5 x 9.5 inside the faces, less the stub
  });

  it("says null when no single extension closes it", () => {
    const walls = [wall(0, 0, 10, 0), wall(0, 0, 0, 10)]; // two walls of four
    const hints = leakHints({ walls, feetPerUnit: W, widthPt: 1000, text: [text("OFFICE", 5, 4), text("101", 5, 5)] });
    expect(hints[0].hint).toBeNull();
  });
});
