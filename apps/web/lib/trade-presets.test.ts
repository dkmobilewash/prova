import { describe, expect, it } from "vitest";
import { MARKUP_FIELDS, markupNeeded, presetWallTypes, TRADE_PRESETS, tradePreset } from "./trade-presets";
import { STARTER_TYPES, TRADE_ONLY_STARTERS } from "./wall-type-starters";

describe("trade presets", () => {
  it("offers the five trades, in the order the screen shows them", () => {
    expect(TRADE_PRESETS.map((p) => p.choice)).toEqual(["FRAMING_DRYWALL", "ACOUSTICAL_CEILINGS", "PLASTER_EIFS", "FIREPROOFING", "OTHER"]);
    expect(tradePreset("NOPE")).toBeNull();
  });

  it("sets the takeoff switches Diego decided on 2026-11-05", () => {
    const table = Object.fromEntries(
      TRADE_PRESETS.map((p) => [p.choice, [p.switches.wholeSetTakeoffOn, p.switches.roomFinderOn, p.switches.doorsWindowsOn, !p.switches.symbolCountOff]]),
    );
    expect(table).toEqual({
      FRAMING_DRYWALL: [true, true, true, true],
      ACOUSTICAL_CEILINGS: [true, true, false, true],
      PLASTER_EIFS: [true, false, true, true],
      FIREPROOFING: [false, true, false, true],
      OTHER: [true, true, true, true],
    });
    for (const p of TRADE_PRESETS) {
      expect(p.switches.scannedPlansOn, p.choice).toBe(false);
      expect(p.switches.planCompareOn, p.choice).toBe(false);
    }
  });

  it("names only starter wall types that exist, and every trade but Other gets some", () => {
    for (const p of TRADE_PRESETS) {
      expect(() => presetWallTypes(p), p.choice).not.toThrow();
      expect(presetWallTypes(p).length > 0, p.choice).toBe(p.choice !== "OTHER");
    }
  });

  it("keeps the trade-only starters out of the library's own starter button", () => {
    const general = new Set(STARTER_TYPES.map((t) => t.code));
    for (const t of TRADE_ONLY_STARTERS) expect(general.has(t.code), t.code).toBe(false);
  });

  it("puts plaster and EIFS on ONE face, so cladding is not counted twice", () => {
    for (const code of ["PL1", "EIFS1"]) expect(TRADE_ONLY_STARTERS.find((t) => t.code === code)?.sides, code).toBe(1);
  });

  it("NEVER CARRIES A PRICE OR A PERCENTAGE — the preset's data has nothing that could be one", () => {
    const json = JSON.stringify(TRADE_PRESETS);
    expect(json).not.toMatch(/markup|overhead|profit|price|cost|rate/i);
    for (const t of TRADE_ONLY_STARTERS) {
      for (const part of t.parts) expect(Object.keys(part).sort(), `${t.code} ${part.description}`).toEqual(expect.not.arrayContaining(["unitPrice", "unitCost"]));
    }
  });
});

describe("markupNeeded", () => {
  const all = Object.fromEntries(MARKUP_FIELDS.map((f) => [f, "10"]));
  it("is never true for a company that predates the trade question", () => {
    expect(markupNeeded({ tradePresetAskedAt: null }, null)).toBe(false);
  });
  it("is true for a new company until all four figures are set, and zero counts as set", () => {
    const asked = { tradePresetAskedAt: new Date() };
    expect(markupNeeded(asked, null)).toBe(true);
    expect(markupNeeded(asked, { ...all, profitPercent: null })).toBe(true);
    expect(markupNeeded(asked, all)).toBe(false);
    expect(markupNeeded(asked, { ...all, overheadPercent: "0" })).toBe(false);
  });
});
