import { describe, expect, it } from "vitest";
import { BLANK_RATES, heightBand, laborAssembly, laborPlan, ratesFromJson, type ProductionRates, type WallForLabor } from "./productionRates";

// A company's own rates, typed in for this test — the product seeds none (BLANK_RATES).
const RATES: ProductionRates = {
  framingLfPerHr: 20,
  boardSfPerHr: { regular: 60, typeX: 50, special: 40 },
  finishSfPerHr: { level3: 55, level4: 45, level5: 30 },
  defaultFinishLevel: 4,
  ceilingSfPerHr: 40,
  doorFramesPerHr: 2,
  doorsPerHr: 1.5,
  windowFramesPerHr: 3,
  over10Multiplier: 1.15,
  over14Multiplier: 1.3,
  crewRatePerHr: 62,
};

// Baker's three types, their parts exactly as #1091 writes them.
const part = (description: string, unit: string, basis: string, factor: number) => ({ description, unit, basis, factor });
const S6B = laborAssembly([part("6in metal stud at 16in o.c.", "EA", "STUDS", 1), part("6in track, top and bottom", "LF", "LINEAR_FT", 2), part("5/8in type X gypsum board, 4x8 sheets", "SHT", "BOARDED_SQFT", 1 / 32), part("joint compound", "LB", "BOARDED_SQFT", 0.14)], 4);
const C8B = laborAssembly([part("5/8in gypsum board, 4x8 sheets", "SHT", "BOARDED_SQFT", 1 / 32), part("cavity insulation", "SF", "FACE_SQFT", 1), part("joint compound", "LB", "BOARDED_SQFT", 0.14)], 4);
const S6A = laborAssembly([part("6in metal stud, 25 ga at 24in o.c.", "EA", "STUDS", 1), part("6in track, bottom, 25 ga", "LF", "LINEAR_FT", 1), part("5/8in type X gypsum board, 2 layers per side, 4x8 sheets", "SHT", "BOARDED_SQFT", 2 / 32), part("joint compound", "LB", "BOARDED_SQFT", 0.14)], 4);

// S6B 120 lf x 10 ft both sides (2,400 sf); C8B 80 x 12 one side (960 sf); S6A 60 x 14 both sides (1,680 sf).
const BAKER: WallForLabor[] = [
  { code: "S6B", assembly: S6B, heightFt: 10, linearFt: 120, boardedSqFt: 2400 },
  { code: "C8B", assembly: C8B, heightFt: 12, linearFt: 80, boardedSqFt: 960 },
  { code: "S6A", assembly: S6A, heightFt: 14, linearFt: 60, boardedSqFt: 1680 },
];
const hours = (plan: ReturnType<typeof laborPlan>, re: RegExp) => plan.lines.find((l) => re.test(l.description))?.hours;

describe("Baker's labor, against a hand calculation", () => {
  const plan = laborPlan(BAKER, [], RATES);
  // By hand:
  //   S6B (10 ft, no multiplier): framing 120/20 = 6.00 · hang type X 2,400/50 = 48.00 · finish L4 2,400/45 = 53.33
  //   C8B (12 ft, x1.15, concrete so no framing): hang regular 960/60 = 16 x1.15 = 18.40 · finish 960/45 = 21.333 x1.15 = 24.53
  //   S6A (14 ft is not OVER 14, so x1.15): framing 60/20 = 3 x1.15 = 3.45 · hang 2 layers 3,360/50 = 67.2 x1.15 = 77.28 · finish 1,680/45 = 37.333 x1.15 = 42.93
  const hand: [RegExp, number][] = [
    [/S6B — framing/, 6.0], [/S6B — hang type X board$/, 48.0], [/S6B — tape and finish, Level 4$/, 53.33],
    [/C8B — hang regular board, over 10 ft/, 18.4], [/C8B — tape and finish, Level 4, over 10 ft/, 24.53],
    [/S6A — framing, studs and track, over 10 ft/, 3.45], [/S6A — hang type X board, 2 layers, over 10 ft/, 77.28], [/S6A — tape and finish, Level 4, over 10 ft/, 42.93],
  ];
  for (const [re, want] of hand) it(`${re.source} = ${want} h`, () => expect(hours(plan, re)).toBe(want));
  it("writes exactly those eight lines, and C8B (board on concrete) gets no framing", () => {
    expect(plan.lines).toHaveLength(8);
    expect(hours(plan, /C8B — framing/)).toBeUndefined();
    expect(plan.missing).toEqual([]);
  });
  it("totals 273.92 hours, $16,983.04 at $62 an hour", () => {
    const total = plan.lines.reduce((n, l) => n + l.hours, 0);
    expect(Math.round(total * 100) / 100).toBe(273.92);
    expect(Math.round(total * 62 * 100) / 100).toBe(16983.04);
  });
});

describe("height and finish level change the hours", () => {
  it("S6B at 12 ft moves into the over-10 band: 6.90 / 66.24 / 73.60", () => {
    const p = laborPlan([{ ...BAKER[0], heightFt: 12, boardedSqFt: 2880 }], [], RATES);
    expect(hours(p, /framing, studs and track, over 10 ft/)).toBe(6.9);
    expect(hours(p, /hang type X board, over 10 ft/)).toBe(66.24); // 2,880/50 = 57.6 x1.15
    expect(hours(p, /tape and finish, Level 4, over 10 ft/)).toBe(73.6); // 2,880/45 = 64 x1.15
  });
  it("over 14 ft takes the second multiplier: 16 ft is x1.3", () => {
    expect(heightBand(16, RATES)).toMatchObject({ band: "over 14 ft", multiplier: 1.3 });
    expect(heightBand(14, RATES)).toMatchObject({ band: "over 10 ft", multiplier: 1.15 });
    expect(heightBand(10, RATES)).toMatchObject({ band: "", multiplier: 1 });
  });
  it("a Level 5 wall (the spec's skim on the compound) takes the Level 5 rate: 2,400/30 = 80.00", () => {
    const l5 = laborAssembly([part("5/8in type X gypsum board, 4x8 sheets", "SHT", "BOARDED_SQFT", 1 / 32), part("joint compound, Level 5 skim (spec 09 29 00)", "LB", "BOARDED_SQFT", 0.21)], 4);
    expect(l5.finishLevel).toBe(5);
    expect(hours(laborPlan([{ ...BAKER[0], assembly: l5 }], [], RATES), /Level 5/)).toBe(80);
  });
  it("ceilings are their square feet over the ceiling rate", () => {
    expect(laborPlan([], [{ description: "Ceiling — ACT 2x2", squareFeet: 1200 }], RATES).lines).toEqual([{ description: "Labor — Ceiling — ACT 2x2 — install", hours: 30 }]);
  });
});

describe("no rate is ever assumed", () => {
  it("with nothing set there are no labor lines, and every rate the walls need is named", () => {
    const p = laborPlan(BAKER, [], BLANK_RATES);
    expect(p.lines).toEqual([]);
    expect(p.missing).toEqual(expect.arrayContaining(["framing (lin ft per hour)", "hanging type X board (sq ft per hour)", "hanging regular board (sq ft per hour)", "taping and finishing, Level 4 (sq ft per hour)", "the over-10 ft multiplier"]));
  });
  it("hours with no crew rate are named as missing the cost, so the estimate asks for it", () => {
    const p = laborPlan(BAKER, [], { ...RATES, crewRatePerHr: null });
    expect(p.lines.length).toBe(8); // the hours are known…
    expect(p.missing).toEqual(["the crew rate ($ per hour)"]); // …what they cost is not
  });
  it("one rate missing leaves only that work out", () => {
    const p = laborPlan(BAKER, [], { ...RATES, boardSfPerHr: { ...RATES.boardSfPerHr, regular: null } });
    expect(hours(p, /C8B — hang/)).toBeUndefined();
    expect(hours(p, /S6B — hang/)).toBe(48);
    expect(p.missing).toEqual(["hanging regular board (sq ft per hour)"]);
  });
  it("a stored value that is missing, zero or nonsense reads as BLANK, never as a default", () => {
    const r = ratesFromJson({ framingLfPerHr: 0, boardSfPerHr: { typeX: -5, regular: "60" }, crewRatePerHr: 55 });
    expect(r.framingLfPerHr).toBeNull();
    expect(r.boardSfPerHr).toEqual({ regular: null, typeX: null, special: null });
    expect(r.crewRatePerHr).toBe(55);
    expect(ratesFromJson(null)).toEqual(BLANK_RATES);
  });
});

describe("posted doors, at the company's door rates", () => {
  it("by others: no labor line and nothing asked", () => {
    expect(laborPlan([], [], RATES, { count: 14, scope: "BY_OTHERS" })).toEqual({ lines: [], missing: [] });
  });
  it("frames: one EA line, the doors, at frames per hour", () => {
    expect(laborPlan([], [], RATES, { count: 14, scope: "FRAMES" }).lines).toEqual([{ description: "Labor — Doors — set hollow-metal frames", hours: 7, unit: "EA", quantity: 14, perHr: 2 }]);
  });
  it("doors and frames: the frames and the doors hung", () => {
    expect(laborPlan([], [], RATES, { count: 3, scope: "DOORS_AND_FRAMES" }).lines).toEqual([
      { description: "Labor — Doors — set hollow-metal frames", hours: 1.5, unit: "EA", quantity: 3, perHr: 2 },
      { description: "Labor — Doors — hang doors, with hardware", hours: 2, unit: "EA", quantity: 3, perHr: 1.5 },
    ]);
  });
  it("a blank door rate writes nothing and is named, and so is a blank crew rate", () => {
    const plan = laborPlan([], [], { ...BLANK_RATES, doorFramesPerHr: 2 }, { count: 3, scope: "DOORS_AND_FRAMES" });
    expect(plan.lines.map((l) => l.description)).toEqual(["Labor — Doors — set hollow-metal frames"]);
    expect(plan.missing).toEqual(["hanging doors (doors per hour)", "the crew rate ($ per hour)"]);
  });
  it("the door rates are stored and read back like every rate, blank when missing", () => {
    expect(ratesFromJson(JSON.parse(JSON.stringify(RATES)))).toMatchObject({ doorFramesPerHr: 2, doorsPerHr: 1.5 });
    expect(ratesFromJson({})).toMatchObject({ doorFramesPerHr: null, doorsPerHr: null });
  });
});

describe("confirmed windows, at the window frame rate, behind the same setting", () => {
  it("installed: one EA line, the windows, at frames per hour", () => {
    expect(laborPlan([], [], RATES, { count: 0, scope: "FRAMES", windows: 6 }).lines).toEqual([{ description: "Labor — Windows — set window frames", hours: 2, unit: "EA", quantity: 6, perHr: 3 }]);
  });
  it("by others: nothing, and a blank rate is named", () => {
    expect(laborPlan([], [], RATES, { count: 0, scope: "BY_OTHERS", windows: 6 }).lines).toEqual([]);
    expect(laborPlan([], [], { ...RATES, windowFramesPerHr: null }, { count: 0, scope: "FRAMES", windows: 6 }).missing).toContain("setting window frames (frames per hour)");
  });
});
