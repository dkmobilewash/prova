import { describe, expect, it } from "vitest";
import { doorScopeFrom, framesOpenings, framingAssembly, laborSource, openingFraming, windowOpeningTrackFt } from "./doorLines";
import { TRADE_PRESETS } from "@/lib/trade-presets";

// The starter partition's own parts, as `wall-type-starters.ts` writes them.
const W1 = [
  { id: "stud", description: "3⅝″ 20ga studs", unit: "ea", basis: "STUDS" },
  { id: "track", description: "3⅝″ 20ga track, top and bottom", unit: "lin ft", basis: "LINEAR_FT" },
  { id: "board", description: "⅝″ Type X board, 4x8 sheets", unit: "sheets", basis: "BOARDED_SQFT" },
  { id: "hang", description: "Hang, tape and finish ⅝″ board", unit: "sq ft", basis: "BOARDED_SQFT" },
];

describe("an opening's framing, from the partition's own parts", () => {
  it("the stud part as 4 king and jack studs, the track part as 4 ft of header, per door", () => {
    expect(openingFraming(W1).map((f) => [f.part.id, f.perDoor, f.what])).toEqual([
      ["stud", 4, "king and jack studs, 4 per door"],
      ["track", 4, "header, 4 lin ft per door"],
    ]);
  });
  it("never a deflection track, and never a part in a unit it would have to guess", () => {
    const parts = [
      { id: "defl", description: "6in deflection track, top", unit: "lin ft", basis: "LINEAR_FT" },
      { id: "studlf", description: "6in metal stud", unit: "lin ft", basis: "STUDS" },
    ];
    expect(openingFraming(parts)).toEqual([]);
  });
  it("comes from the default partition first, then a type this job's walls use, and only one that frames with studs", () => {
    const act = { id: "act", components: [{ id: "grid", description: "Ceiling grid", unit: "sq ft", basis: "AREA_SQFT" }] };
    const w1 = { id: "w1", components: W1 };
    expect(framingAssembly([act, w1], [null, "act", "w1"])?.id).toBe("w1");
    expect(framingAssembly([act, w1], ["act"])).toBeNull();
  });
  it("only a framing trade frames the opening", () => {
    expect(framesOpenings(["METAL_FRAMING_DRYWALL"])).toBe(true);
    expect(framesOpenings(["ACOUSTICAL_CEILINGS", "LATH_PLASTER"])).toBe(false);
  });
});

describe("the setting", () => {
  it("takes only its three answers", () => {
    expect(["BY_OTHERS", "FRAMES", "DOORS_AND_FRAMES", "ALL", ""].map(doorScopeFrom)).toEqual(["BY_OTHERS", "FRAMES", "DOORS_AND_FRAMES", null, null]);
  });
  it("every trade preset starts at by others", () => {
    expect(TRADE_PRESETS.map((p) => p.doorScope)).toEqual(TRADE_PRESETS.map(() => "BY_OTHERS"));
  });
});

describe("where a labor line's price came from", () => {
  const rates = { crewRatePerHr: 85, doorFramesPerHr: 2, doorsPerHr: 1.5 };
  const line = (description: string, cost: string) => ({ description, costCategory: "LABOR", budgetedUnitCost: cost });
  it("a door task names its own rate and the crew rate", () => {
    expect(laborSource(line("Labor — Doors — set hollow-metal frames", "42.50"), rates)).toBe("Your production rate: 2 frames per hour, at your crew rate of $85.00/hr");
    expect(laborSource(line("Labor — Doors — hang doors, with hardware", "56.67"), rates)).toBe("Your production rate: 1.5 doors per hour, at your crew rate of $85.00/hr");
  });
  it("an hour line names the crew rate", () => {
    expect(laborSource(line("Labor — W1 — framing, studs and track", "85.00"), rates)).toBe("Your production rates, at your crew rate of $85.00/hr");
  });
  it("a cost somebody typed over it is theirs, so the source goes", () => {
    expect(laborSource(line("Labor — Doors — set hollow-metal frames", "60.00"), rates)).toBeNull();
    expect(laborSource({ ...line("Labor — Doors — set hollow-metal frames", "42.50"), costCategory: "MATERIAL" }, rates)).toBeNull();
  });
});

describe("a window's rough opening", () => {
  it("track for the header (width + 1 ft of bearing) and the sill (width)", () => {
    expect(windowOpeningTrackFt(3)).toBe(7);
  });
  it("its labor line names the window frame rate", () => {
    expect(laborSource({ description: "Labor — Windows — set window frames", costCategory: "LABOR", budgetedUnitCost: "28.33" }, { crewRatePerHr: 85, doorFramesPerHr: 2, doorsPerHr: 1.5, windowFramesPerHr: 3 })).toBe("Your production rate: 3 window frames per hour, at your crew rate of $85.00/hr");
  });
});
