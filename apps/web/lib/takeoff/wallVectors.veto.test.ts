import { describe, expect, it } from "vitest";
import { wallsFromStrokes } from "./wallVectors";
import type { StrokeSegment } from "./wallVectors";

/**
 * The veto removes walls the rules chose, and nothing else.
 *
 * Its first version compared wall objects by IDENTITY, and every push spreads
 * the candidate into a new object — so it matched nothing and reported itself
 * as harmless on all fifty synthetic sheets. A veto that never fires is
 * indistinguishable from a veto that is never right, which is why this exists.
 */
const opts = { feetPerPoint: 1 / 12, minLengthFeet: 2 };

/** Two walls, far enough apart that neither can be confused for the other. */
const twoWalls = (): StrokeSegment[] => [
  { x1: 0, y1: 0, x2: 360, y2: 0, width: 0.5 },
  { x1: 0, y1: 6, x2: 360, y2: 6, width: 0.5 },
  { x1: 0, y1: 360, x2: 240, y2: 360, width: 0.5 },
  { x1: 0, y1: 366, x2: 240, y2: 366, width: 0.5 },
];

describe("a veto can only subtract", () => {
  it("finds both walls with no veto", () => {
    expect(wallsFromStrokes(twoWalls(), opts)).toHaveLength(2);
  });

  it("REMOVES THE ONE IT REFUSES, AND KEEPS THE OTHER", () => {
    const kept = wallsFromStrokes(twoWalls(), {
      ...opts,
      veto: (_f, wall) => wall.lengthFeet > 25,
    });
    expect(kept, "the veto removed nothing, or removed everything").toHaveLength(1);
    expect(kept[0].lengthFeet).toBeLessThan(25);
  });

  it("a veto that refuses nothing changes nothing", () => {
    const before = wallsFromStrokes(twoWalls(), opts);
    const after = wallsFromStrokes(twoWalls(), { ...opts, veto: () => false });
    expect(after).toEqual(before);
  });

  it("CANNOT ADD A WALL, whatever it returns", () => {
    // The guarantee the mode exists for: its worst case is the rules' own
    // missing footage plus what it wrongly removes, never a wall nobody
    // proposed. `decide`'s worst case is a sheet of nothing.
    const before = wallsFromStrokes(twoWalls(), opts);
    for (const veto of [() => false, () => true]) {
      const after = wallsFromStrokes(twoWalls(), { ...opts, veto });
      expect(after.length).toBeLessThanOrEqual(before.length);
    }
  });

  it("is handed the same vector the extractor reports", () => {
    // If the veto saw raw features while training saw normalised ones, every
    // threshold would be meaningless and nothing would throw.
    const reported: number[][] = [];
    const seen: number[][] = [];
    wallsFromStrokes(twoWalls(), {
      ...opts,
      onCandidate: (features) => reported.push([...features]),
      veto: (features) => {
        seen.push([...features]);
        return false;
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual(reported);
  });
});
