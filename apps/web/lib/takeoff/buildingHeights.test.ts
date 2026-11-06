import { describe, expect, it } from "vitest";
import { heightOptionLines, legendHeightOf } from "./legendHeights";
import { buildingHeights } from "./wallHeight";
import type { HeightFact } from "./wallHeights";

// Bunkie: the main building and the addition stop at 10'-0", the new warehouses at 14'-4".
const main: HeightFact = { kind: "bearing-elevation", feet: 10, sheet: "A311", phrase: "T.O. WALL 10' - 0\"", zone: "", buildings: ["ADDITION"] };
const warehouse: HeightFact = { kind: "bearing-elevation", feet: 14 + 4 / 12, sheet: "A313", phrase: "T.O. WALL 2 14' - 4\"", zone: "2", buildings: ["WAREHOUSE"] };
const set = { facts: [main, warehouse], generalNote: null, factSheets: [], buildings: ["ADDITION", "WAREHOUSE"] };
const ext = { code: "EXT", lines: ["EXTERIOR WALL TO DECK"], heightNote: null };

describe("a type's height per building part, pre-filled from its plan's building (Bunkie)", () => {
  it("keeps both heights as choices, and records the one each building's plan takes, with its source", () => {
    const got = legendHeightOf(ext, set, null);
    expect(got.heightFt).toBeNull();
    expect(got.options.map((o) => o.feet)).toEqual([10, 14 + 4 / 12]);
    expect(got.byBuilding?.map((b) => [b.building, Number(b.feet.toFixed(3)), b.from])).toEqual([
      ["ADDITION", 10, "A311 T.O. WALL 10' - 0\""],
      ["WAREHOUSE", 14.333, "A313 T.O. WALL 2 14' - 4\""],
    ]);
  });

  it("writes them into the type's notes and reads them back by building", () => {
    const notes = heightOptionLines(legendHeightOf(ext, set, null)).join("\n");
    const back = buildingHeights({ code: "EXT", notes });
    expect(Object.keys(back)).toEqual(["ADDITION", "WAREHOUSE"]);
    expect(back.WAREHOUSE).toEqual({ feet: 14.333, from: "legend EXT, WAREHOUSE: A313 T.O. WALL 2 14' - 4\" → 14'-4\"" });
  });

  it("records nothing for a type the sections give one height", () => {
    expect(legendHeightOf(ext, { ...set, facts: [main] }, null).byBuilding).toBeUndefined();
    expect(buildingHeights({ code: "S1", notes: "Height 10 ft (HIGH): fixed" })).toEqual({});
  });
});
