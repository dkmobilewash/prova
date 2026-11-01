import { describe, expect, it } from "vitest";
import { roomSeals } from "./roomSeals";
import type { FoundWall } from "./roomsFromWalls";
import type { StrokeSegment } from "./wallVectors";

const FPU = 100;
const ft = (n: number) => n / FPU;
/** A door swing in page-width units: the leaf and a flattened quarter arc, 3 ft. */
function swing(hx: number, hy: number): StrokeSegment[] {
  const r = ft(3);
  const out: StrokeSegment[] = [{ x1: ft(hx), y1: ft(hy), x2: ft(hx), y2: ft(hy) + r }];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * (Math.PI / 2);
    const b = ((i + 1) / 16) * (Math.PI / 2);
    out.push({ x1: ft(hx) + r * Math.sin(a), y1: ft(hy) + r * Math.cos(a), x2: ft(hx) + r * Math.sin(b), y2: ft(hy) + r * Math.cos(b) });
  }
  return out;
}
const wall = (x1: number, y1: number, x2: number, y2: number): FoundWall => ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), thicknessFeet: 0.4 });

describe("what closes a doorway", () => {
  it("a door swing is a seal, hinge to strike", () => {
    const seals = roomSeals([], swing(20, 20), FPU);
    expect(seals).toHaveLength(1);
    expect(Math.hypot(seals[0]!.x2 - seals[0]!.x1, seals[0]!.y2 - seals[0]!.y1) * FPU).toBeCloseTo(3, 1);
  });
  it("no swings, no seals, whatever the walls", () => {
    expect(roomSeals([wall(0, 0, 30, 0)], [], FPU)).toEqual([]);
  });
  // A wall stopping 3 ft short of a through wall: the corner gap `cornerSeals` looks for.
  const corner = [wall(0, 20, 30, 20), wall(10, 0, 10, 17)];
  it("a corner gap with a swing drawn at it is sealed too", () => {
    expect(roomSeals(corner, swing(9, 17), FPU).length).toBe(2);
  });
  it("a corner gap with the only swing far away is left open: most corner gaps are not doors", () => {
    expect(roomSeals(corner, swing(60, 60), FPU).length).toBe(1);
  });
});
