import { describe, expect, it } from "vitest";
import { pitchedAt, roofIndex, roofMask, roofPartHeights, roomPitched, runPitched, seamsAt, type Seg } from "./roofParts";
import type { HeightFact } from "./wallHeights";

// 100 ft per page-width unit: 1 ft = 0.01.
const FPU = 100;
const ft = (n: number) => n / FPU;
const line = (x1: number, y1: number, x2: number, y2: number): Seg => ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2) });

// A pitched roof over x 0..40: standing seams every 1.5 ft, 40 ft long, running east-west.
const seams = Array.from({ length: 27 }, (_, i) => line(0, i * 1.5, 40, i * 1.5));
// A flat roof over x 50..90: its outline, one grid line through it, a cricket diagonal.
const flat = [line(50, 0, 90, 0), line(50, 39, 90, 39), line(50, 0, 50, 39), line(90, 0, 90, 39), line(45, 20, 95, 20), line(60, 5, 75, 18)];
const index = roofIndex([...seams, ...flat], FPU);

describe("standing seams tell a pitched roof from a flat one", () => {
  it("evenly spaced parallel lines are seams; an outline, a grid line and a cricket are not", () => {
    expect(seamsAt(index, ft(20), ft(20))).toBeGreaterThanOrEqual(4);
    expect(pitchedAt(index, ft(20), ft(20))).toBe(true);
    expect(pitchedAt(index, ft(70), ft(25))).toBe(false);
  });

  it("parallel lines at uneven spacing — a parapet, a curb, a duct — are not seams, however close", () => {
    const offsets = [0, 0.6, 3.4, 4.5, 7.0, 7.8];
    const uneven = roofIndex(offsets.map((o) => line(0, 20 + o, 30, 20 + o)), FPU);
    expect(pitchedAt(uneven, ft(15), ft(23))).toBe(false);
  });

  it("lines too short to be seams (grid dashes, ticks) do not count", () => {
    const ticks = roofIndex(Array.from({ length: 27 }, (_, i) => line(10, i * 1.5, 14, i * 1.5)), FPU);
    expect(pitchedAt(ticks, ft(12), ft(20))).toBe(false);
  });
});

describe("the two heights come from the sections", () => {
  const level = (feet: number, zone: string, sheet: string, framing = false): HeightFact => ({ kind: "bearing-elevation", feet, zone, sheet, phrase: `${zone} ${feet}`, ...(framing ? { framing } : {}) });
  it("pitched bears at the highest level, flat at the next (Joplin: TOW 16'-8\", JBE 12'-4\")", () => {
    const h = roofPartHeights([level(12, "LOWER", "A-511"), level(12 + 4 / 12, "ADMIN", "A-512"), level(16 + 8 / 12, "CENTRAL", "A-422"), level(24.6, "", "S-102", true)]);
    expect(h?.pitched.feet).toBeCloseTo(16.667, 2);
    expect(h?.pitched.from).toContain("A-422 CENTRAL");
    expect(h?.flat.feet).toBeCloseTo(12.333, 2);
  });
  it("one level is nothing to choose between", () => {
    expect(roofPartHeights([level(15, "", "A301"), level(15, "", "A351")])).toBeNull();
  });
});

describe("a wall takes the roof over its rooms, the taller where they differ", () => {
  const mask = roofMask(index, { x0: 0, y0: 0, x1: ft(100), y1: ft(40) }, "A-201");
  const room = (x0: number, x1: number) => ({ xs: [ft(x0), ft(x1), ft(x1), ft(x0)], ys: [ft(2), ft(2), ft(38), ft(38)] });
  const west = { ...room(2, 44), pitched: roomPitched(mask, room(2, 44)) };
  const east = { ...room(46, 92), pitched: roomPitched(mask, room(46, 92)) };

  it("reads each room by most of the roof over it", () => {
    expect(west.pitched).toBe(true);
    expect(east.pitched).toBe(false);
  });
  it("a region no tag names does not vote — the yard or the eaves under the seams (Joplin: 93 ft wrong)", () => {
    const yard = { ...room(2, 44), named: false };
    expect(roomPitched(mask, yard)).toBeNull();
    expect(runPitched({ ...line(45, 5, 45, 35), thicknessFeet: 0.5 }, [{ ...yard, pitched: roomPitched(mask, yard) }, east], FPU)).toBe(false);
  });

  it("between a pitched and a flat room: the pitched roof's height; inside one room: that room's; no room: nothing", () => {
    expect(runPitched({ ...line(45, 5, 45, 35), thicknessFeet: 0.5 }, [west, east], FPU)).toBe(true);
    expect(runPitched({ ...line(91.5, 5, 91.5, 35), thicknessFeet: 0.5 }, [west, east], FPU)).toBe(false);
    expect(runPitched({ ...line(10, 60, 30, 60), thicknessFeet: 0.5 }, [west, east], FPU)).toBeNull();
  });
});
