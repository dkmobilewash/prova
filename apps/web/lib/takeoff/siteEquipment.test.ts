import { describe, expect, it } from "vitest";
import { offeredCandidates, SITE_EQUIPMENT_LONGEST_FEET, SITE_EQUIPMENT_REACH_FEET, siteEquipmentWord } from "./offeredCandidates";
import type { WallCandidate } from "./wallVectors";

// 100 ft per page-width unit, 1000 pt wide: 1 ft = 0.01 units = 10 pt.
const FPU = 100;
const W = 1000;
const wall = (x1: number, y1: number, x2: number, y2: number): WallCandidate =>
  ({ x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU, thicknessFeet: 0.5 }) as WallCandidate;
const word = (str: string, xFt: number, yFt: number) => ({ str, x: xFt * 10 - 20, y: yFt * 10, width: 40, height: 8 });
const sheet = (walls: WallCandidate[], textItems?: ReturnType<typeof word>[]) => ({ walls, segments: [], widthPt: W, feetPerUnit: FPU, planBoxes: null, textItems });

describe("site equipment: a word within reach sets a wall aside", () => {
  const run = wall(0.1, 0.5, 0.4, 0.5); // 30 ft along y = 50 ft

  it("KEEPS a building's long wall with a word beside one end: Camp Bow Wow's 128 ft exterior wall and PLAY YARD", () => {
    const long = wall(0.1, 0.5, 0.1 + (SITE_EQUIPMENT_LONGEST_FEET + 1) / FPU, 0.5);
    expect(offeredCandidates(sheet([long], [word("PLAY YARD", 15, 55)])).setAsideLines.some((l) => l.kind === "site-equipment")).toBe(false);
  });
  it("still sets aside a run right at the limit", () => {
    const atLimit = wall(0.1, 0.5, 0.1 + SITE_EQUIPMENT_LONGEST_FEET / FPU - 0.001, 0.5);
    expect(offeredCandidates(sheet([atLimit], [word("PLAY YARD", 15, 55)])).setAsideLines.some((l) => l.kind === "site-equipment")).toBe(true);
  });
  it("SETS ASIDE a wall with OUTDOOR RUN written 5 ft from it, and says which word", () => {
    const got = offeredCandidates(sheet([run], [word("OUTDOOR RUN", 25, 55)]));
    expect(got.candidates).toEqual([]);
    expect(got.setAsideLines.map((l) => [l.kind, l.why])).toEqual([["site-equipment", "'RUN' is written 5 ft away"]]);
    expect(got.setAside[0].n).toBe(1);
  });

  it("offers it when the word is beyond reach, or is not an equipment word, or there is no text at all", () => {
    expect(offeredCandidates(sheet([run], [word("OUTDOOR RUN", 25, 50 + SITE_EQUIPMENT_REACH_FEET + 1)])).candidates).toHaveLength(1);
    expect(offeredCandidates(sheet([run], [word("KENNEL", 25, 52)])).candidates).toHaveLength(1);
    expect(offeredCandidates(sheet([run])).candidates).toHaveLength(1);
  });

  it("matches the words as words — RUNNING and GATEWAY are not RUN and GATE", () => {
    expect(siteEquipmentWord(run, [word("RUNNING TRACK", 25, 52)], W, FPU)).toBeNull();
    expect(siteEquipmentWord(run, [word("GATEWAY", 25, 52)], W, FPU)).toBeNull();
    expect(siteEquipmentWord(run, [word("8' CHAIN LINK", 25, 52)], W, FPU)?.word).toBe("CHAIN LINK");
    expect(siteEquipmentWord(run, [word("TRENCH DRAIN, RE: PLUMBING", 25, 52)], W, FPU)?.word).toBe("TRENCH DRAIN");
  });
});

describe("a run with no extent is never offered", () => {
  it("COUNTS IT ASIDE AND LEAVES THE OTHERS", () => {
    const point = { x1: 0.3, y1: 0.3, x2: 0.3, y2: 0.3, lengthFeet: 2.3, thicknessFeet: 0.32, curved: true } as WallCandidate;
    const got = offeredCandidates(sheet([wall(0.1, 0.5, 0.4, 0.5), point]));
    expect(got.candidates).toHaveLength(1);
    expect(got.setAside.find((a) => a.kind === "zero-extent")?.n).toBe(1);
  });
});
