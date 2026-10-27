import { describe, expect, it } from "vitest";
import { withoutUnitPlanJunk } from "./unitPlanJunk";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

// One page-width unit = 100 ft, so 0.01 is a foot.
const FPU = 100;
const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });
const wall = (x1: number, y1: number, x2: number, y2: number, thicknessFeet: number): WallCandidate =>
  ({ x1, y1, x2, y2, thicknessFeet, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU }) as WallCandidate;

/** A 30 ft wall at y 0.5, faces 0.005 apart (6 in), both faces solid. */
const solidFaces = [seg(0.1, 0.5025, 0.4, 0.5025), seg(0.1, 0.4975, 0.4, 0.4975)];
const long = wall(0.1, 0.5, 0.4, 0.5, 0.5);

describe("unit-plan junk", () => {
  it("keeps a wall drawn with two solid faces", () => {
    expect(withoutUnitPlanJunk({ walls: [long], segments: solidFaces, feetPerUnit: FPU }).kept).toEqual([long]);
  });

  it("DROPS A PAIR WHOSE FACES ARE DASHED — an overhead line, not a wall", () => {
    const dashes: StrokeSegment[] = [];
    for (let x = 0.1; x < 0.4; x += 0.02) {
      dashes.push(seg(x, 0.5025, x + 0.008, 0.5025), seg(x, 0.4975, x + 0.008, 0.4975));
    }
    const got = withoutUnitPlanJunk({ walls: [long], segments: dashes, feetPerUnit: FPU });
    expect(got.junk.map((j) => j.reason)).toEqual(["dashed"]);
  });

  it("keeps a wall with a door gap in one face, which is few pieces", () => {
    const gapped = [seg(0.1, 0.5025, 0.2, 0.5025), seg(0.23, 0.5025, 0.4, 0.5025), seg(0.1, 0.4975, 0.4, 0.4975)];
    expect(withoutUnitPlanJunk({ walls: [long], segments: gapped, feetPerUnit: FPU }).junk).toEqual([]);
  });

  it("DROPS A SHORT CLOSED BOX — a cabinet, capped at both ends", () => {
    // 6 ft long, 2 ft deep: a base cabinet run.
    const box = wall(0.1, 0.5, 0.16, 0.5, 2);
    const strokes = [seg(0.1, 0.51, 0.16, 0.51), seg(0.1, 0.49, 0.16, 0.49), seg(0.1, 0.49, 0.1, 0.51), seg(0.16, 0.49, 0.16, 0.51)];
    // A neighbour so the free-standing rule is not what catches it.
    const neighbour = wall(0.1, 0.4, 0.1, 0.6, 0.5);
    const got = withoutUnitPlanJunk({ walls: [box, neighbour], segments: strokes, feetPerUnit: FPU });
    expect(got.junk.map((j) => [j.wall, j.reason])).toEqual([[box, "closed-box"]]);
  });

  it("keeps a short 6 in wall capped at BOTH ends — a segment between two door jambs", () => {
    const between = wall(0.1, 0.5, 0.16, 0.5, 0.5);
    const strokes = [seg(0.1, 0.5025, 0.16, 0.5025), seg(0.1, 0.4975, 0.16, 0.4975), seg(0.1, 0.4975, 0.1, 0.5025), seg(0.16, 0.4975, 0.16, 0.5025)];
    const neighbour = wall(0.1, 0.4, 0.1, 0.6, 0.5);
    expect(withoutUnitPlanJunk({ walls: [between, neighbour], segments: strokes, feetPerUnit: FPU }).junk).toEqual([]);
  });

  it("keeps a short wall capped at one end only — a wall end is drawn closed", () => {
    const stub = wall(0.1, 0.5, 0.16, 0.5, 0.5);
    const strokes = [seg(0.1, 0.5025, 0.16, 0.5025), seg(0.1, 0.4975, 0.16, 0.4975), seg(0.16, 0.4975, 0.16, 0.5025)];
    const neighbour = wall(0.1, 0.4, 0.1, 0.6, 0.5);
    expect(withoutUnitPlanJunk({ walls: [stub, neighbour], segments: strokes, feetPerUnit: FPU }).junk).toEqual([]);
  });

  it("DROPS A SHORT FREE-STANDING RUN that reaches no other candidate — a shelf in a room", () => {
    const shelf = wall(0.3, 0.3, 0.34, 0.3, 1);
    const far = wall(0.1, 0.1, 0.1, 0.4, 0.5);
    const got = withoutUnitPlanJunk({ walls: [shelf, far], segments: [], feetPerUnit: FPU });
    expect(got.junk.map((j) => [j.wall, j.reason])).toEqual([[shelf, "free-standing"]]);
  });

  it("keeps a short run that meets another candidate at one end, and any long run", () => {
    const stub = wall(0.1, 0.5, 0.16, 0.5, 0.5);
    const neighbour = wall(0.1, 0.4, 0.1, 0.6, 0.5);
    expect(withoutUnitPlanJunk({ walls: [stub, neighbour], segments: [], feetPerUnit: FPU }).junk).toEqual([]);
    const lone = wall(0.3, 0.3, 0.5, 0.3, 0.5);
    expect(withoutUnitPlanJunk({ walls: [lone], segments: [], feetPerUnit: FPU }).junk).toEqual([]);
  });
});
