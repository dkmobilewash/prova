import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { wallHeightChain } from "./heightsByCode";
import { wallChainWithRooms } from "./wallSides";

/**
 * ── THE ONE CHAIN THE PRODUCT AND ZERO-TOUCH SHARE (#1198 wired into the eval's run side) ──
 *
 * `wallChainWithRooms` is the parity: `assignWallHeights` (the product) and `zzZeroTouch.eval.ts`
 * (the scorer) both call it, so the eval prices exactly the height the product writes. These tests
 * pin the two properties the wiring rests on, and a census pins the shared call itself — the
 * 2026-11-17 doors exam is what happens when a measured number and the thing it measures drift.
 */

const ROOM = { id: 1, tag: { number: "101" }, xs: [0.1, 0.4, 0.4, 0.1], ys: [0.1, 0.1, 0.4, 0.4] };
// The wall lies on the room's south edge: the probe finds the room on one side, nothing on the other.
const WALL = { xs: [0.1, 0.4], ys: [0.4, 0.4] };
const FIGURES = { floorToFloorFt: null, structureFt: null, setCeilingFt: null };
const ANSWER = { convention: "FIXED" as const, fixedFt: 10 };

describe("wallChainWithRooms", () => {
  it("beside no room it IS the set-level chain — the pre-#1198 zero-touch behavior, so the wiring is a strict refinement", () => {
    const bare = wallHeightChain(null, [null, null], [null, null], ANSWER, FIGURES);
    const through = wallChainWithRooms({ wall: WALL, rooms: [], ceilingOf: () => null, namedOf: () => false, roofMask: undefined, rule: null, answer: ANSWER, figures: FIGURES });
    expect(through).toEqual(bare);
    expect(through?.feet).toBe(10); // and not null: the company answer still lands
  });

  it("a room's ceiling reaches the chain through the probe (to-ceiling rule, 12 ft room -> 12 ft wall, not the 10 ft answer)", () => {
    const rule = { kind: "to-ceiling", setCeilingFeet: null, from: "test rule" } as never;
    const h = wallChainWithRooms({ wall: WALL, rooms: [ROOM], ceilingOf: () => 12, namedOf: (r) => r.tag !== null, roofMask: undefined, rule, answer: ANSWER, figures: FIGURES });
    expect(h?.feet).toBe(12);
    expect(h?.assumed).toBe(false);
    // The same wall beside the same room with NO ceiling read falls through to the answer.
    const none = wallChainWithRooms({ wall: WALL, rooms: [ROOM], ceilingOf: () => null, namedOf: () => true, roofMask: undefined, rule, answer: ANSWER, figures: FIGURES });
    expect(none?.feet).toBe(10);
    expect(none?.assumed).toBe(true);
  });
});

describe("the shared call is real on both sides (code, not comments)", () => {
  const code = (rel: string) =>
    readFileSync(join(__dirname, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  it("assignWallHeights calls wallChainWithRooms and no longer carries its own probe loop", () => {
    const s = code("wallHeightsAssign.ts");
    expect(s).toMatch(/wallChainWithRooms\(\{/);
    expect(s).not.toMatch(/wallSideRooms\(/);
  });
  it("the zero-touch eval calls wallChainWithRooms and no longer prices every run wall at one set-level height", () => {
    const s = code("realplan/zzZeroTouch.eval.ts");
    expect(s).toMatch(/wallChainWithRooms\(\{/);
    expect(s).toMatch(/sheetRooms\(\{/);
    // the old line: zeroBoardSf from a single chainFeet for every run
    expect(s).not.toMatch(/lengthFeet \* chainFeet \* 2/);
  });
});
