import { describe, expect, it } from "vitest";
import { generalTypeRule, typeHeightRule, wallTypeHeight, type TypeHeightRule } from "./typeHeights";

/**
 * ── PER-TYPE HEIGHTS (prereg-type-heights.md, flag TAKEOFF_TYPE_HEIGHTS) ──
 *
 * The corpus is what the documents print, as Round 36 read it (heights-key-r20.json basis
 * strings, BOARD.md H8-H11) and the phrasings Diego listed from it. Chrome's raw reports are
 * still to come (coordination/round36-reports/); each new phrasing there gets its own case here.
 */
const rule = (lines: string[], facts: Parameters<typeof typeHeightRule>[1] = { facts: [] }) => typeHeightRule({ code: "X", heightNote: null, lines }, facts);

describe("the type-rule reader: what a partition type says its height is", () => {
  it("a fixed height: Camp Bow Wow C 4'-0\", D 10'-0\", E 10'-6\"", () => {
    expect(rule(['4\'-0" HIGH'])).toEqual({ kind: "fixed", feet: 4, why: '4\'-0" HIGH' });
    expect(rule(["10'-0\""])).toMatchObject({ kind: "fixed", feet: 10 });
    expect(rule(["10'-6\""])).toMatchObject({ kind: "fixed", feet: 10.5 });
  });

  it("N above the ceiling: UCCS P0B/P0F +4\", Sedgwick +8\", CMB 0SF +6\", NG-Lakewood IW-3 +8\"", () => {
    expect(rule(['4" ABOVE CEILING'])).toMatchObject({ kind: "above-ceiling", inches: 4 });
    expect(rule(['EXTEND 8" ABOVE HIGHEST ADJACENT CEILING'])).toMatchObject({ kind: "above-ceiling", inches: 8 });
    expect(rule(['6" ABOVE FINISHED CEILING'])).toMatchObject({ kind: "above-ceiling", inches: 6 });
    expect(rule(['STUDS TO 8" ABOVE CLG'])).toMatchObject({ kind: "above-ceiling", inches: 8 });
  });

  it("to the ceiling: Bluetooth J; and Joplin K \"to ceiling, 9'-0\" U.N.O.\" reads its figure", () => {
    expect(rule(["TO CEILING"])).toMatchObject({ kind: "to-ceiling" });
    expect(rule(["TO UNDERSIDE OF CEILING"])).toMatchObject({ kind: "to-ceiling" });
    expect(rule(["TO CEILING, 9'-0\" U.N.O."])).toMatchObject({ kind: "fixed", feet: 9 });
  });

  it("to the soffit: UCCS P0E", () => {
    expect(rule(["TO UNDERSIDE OF SOFFIT"])).toMatchObject({ kind: "to-soffit" });
    expect(rule(["STUDS TO SOFFIT ABOVE"])).toMatchObject({ kind: "to-soffit" });
  });

  it("to deck / structure: priced only where the set prints ONE deck, bearing or plate value (H4)", () => {
    expect(rule(["TO DECK"])).toEqual({ kind: "to-structure", feet: null, why: "TO DECK" });
    expect(rule(["TO UNDERSIDE OF STRUCTURE"])).toMatchObject({ kind: "to-structure", feet: null });
    const oneDeck = { facts: [{ kind: "structure-elevation" as const, feet: 15, sheet: "A301", phrase: "T.O. ROOF FRAMING 15'-0\"" }] };
    expect(rule(["TO DECK (NOTE A)"], oneDeck)).toMatchObject({ kind: "to-structure", feet: 15 });
    const two = { facts: [...oneDeck.facts, { kind: "structure-elevation" as const, feet: 18, sheet: "A302", phrase: "B.O. DECK 18'-0\"" }] };
    expect(rule(["TO DECK"], two)).toMatchObject({ kind: "to-structure", feet: null });
  });

  it("a plate height, fractions kept: Topeka and Mid-City 9'-1 1/8\"", () => {
    expect(rule(['PLATE HEIGHT 9\'-1 1/8" A.F.F.'])).toEqual({ kind: "plate", feet: 9 + 1.125 / 12, why: 'PLATE HEIGHT 9\'-1 1/8" A.F.F.' });
    expect(rule(['T.O. PLATE 9\'-1 1/8"'])).toMatchObject({ kind: "plate", feet: 9 + 1.125 / 12 });
    expect(rule(["TO TOP PLATE"])).toMatchObject({ kind: "plate", feet: null });
  });

  it("partial height: a dimension, or 'see elevations' (UCCS P0P, SW A/B)", () => {
    expect(rule(['42" HIGH'])).toMatchObject({ kind: "partial", feet: 3.5 });
    expect(rule(["3'-6\" HIGH PONY WALL"])).toMatchObject({ kind: "partial", feet: 3.5 });
    expect(rule(["HEIGHT VARIES, SEE ELEVATIONS"])).toMatchObject({ kind: "partial", feet: null });
    expect(rule(["PARTIAL HEIGHT, SEE INTERIOR ELEVATIONS"])).toMatchObject({ kind: "partial", feet: null });
  });

  it("not board: a masonry type with no gypsum line (H5: K-4 M8, ELEVEN03 WS, MHK 3, Canton M8P)", () => {
    expect(rule(['8" CMU'])).toMatchObject({ kind: "no-board" });
    expect(rule(['8" CMU SHAFT WALL, 2 HR'])).toMatchObject({ kind: "no-board" });
    expect(rule(["12\" CONCRETE MASONRY UNIT"])).toMatchObject({ kind: "no-board" });
    // CMU with a facing of board is board (H8: M6F = CMU + 7/8" hat channel + 5/8" GWB): its height decides.
    expect(rule(['6" CMU', '7/8" HAT CHANNEL FURRING', '5/8" GWB'])?.kind).not.toBe("no-board");
  });

  it("a scale caption, a taper or a mesh height is not the wall's height (CBW, Joplin, K-4, Green Bay legends)", () => {
    expect(rule(['SCALE: 1/2" - 1\' - 0"'])).toBeNull();
    expect(rule(['1/2" = 1\'-0"'])).toBeNull();
    expect(rule(['1/4" PER 1\' TAPERED'])).toBeNull();
    expect(rule(['MESH UP TO 8\'-0" ON NON'])).toBeNull();
    // CBW D: the scale caption comes first in the legend's lines; the printed 10'-0" is the height.
    expect(rule(['SCALE: 1/2" - 1\' - 0"', "10' - 0\""])).toMatchObject({ kind: "fixed", feet: 10 });
  });

  it("says nothing when the type's words say nothing about height", () => {
    expect(rule(['3 5/8" METAL STUDS @ 16" O.C.', '5/8" GYP. BD. EACH SIDE'])).toBeNull();
  });

  it("reads the type's own height note before its assembly lines", () => {
    expect(typeHeightRule({ code: "A", heightNote: "TO DECK", lines: ['5/8" GWB', "10'-0\""] }, { facts: [] })).toMatchObject({ kind: "to-structure" });
  });
});

describe("the general rule for walls the plan does not type", () => {
  it("'ALL WALLS TO DECK U.N.O.' is a rule for every untyped wall (Baker A601 note A)", () => {
    expect(generalTypeRule(["A. ALL WALLS TO DECK ABOVE UNLESS NOTED OTHERWISE"])).toMatchObject({ rule: { kind: "to-structure" } });
  });
  it("'UNTYPED WALLS = TYPE A' and 'M6F U.N.O.' name a type instead (Canton G101: untyped = M6F)", () => {
    expect(generalTypeRule(["UNTYPED WALLS SHALL BE TYPE A"])).toEqual({ typeCode: "A" });
    expect(generalTypeRule(["ALL INTERIOR WALLS M6F U.N.O."])).toEqual({ typeCode: "M6F" });
    expect(generalTypeRule(["WALL TYPE 3 UNLESS NOTED OTHERWISE"])).toEqual({ typeCode: "3" });
  });
  it("is nothing when no note says it", () => {
    expect(generalTypeRule(["ALL DIMENSIONS ARE TO FACE OF STUD"])).toBeNull();
  });
});

describe("assignment: a wall's height from its type's rule and the rooms either side", () => {
  const at = (r: TypeHeightRule | null, ceilings: (number | null)[] = [], setCeilingFt: number | null = null) => wallTypeHeight(r, ceilings, setCeilingFt);
  it("N above ceiling = the HIGHER adjacent ceiling + N; else the set's one ceiling; else a question", () => {
    expect(at({ kind: "above-ceiling", inches: 6, why: "" }, [9, 10])).toMatchObject({ kind: "height", feet: 10.5 });
    expect(at({ kind: "above-ceiling", inches: 4, why: "" }, [null, null], 9)).toMatchObject({ kind: "height", feet: 9 + 4 / 12 });
    expect(at({ kind: "above-ceiling", inches: 4, why: "" }, [null, null], null)).toMatchObject({ kind: "needs-answer" });
  });
  it("to ceiling = that ceiling; fixed, plate and partial = the number", () => {
    expect(at({ kind: "to-ceiling", why: "" }, [8, 9])).toMatchObject({ kind: "height", feet: 9 });
    expect(at({ kind: "fixed", feet: 10.5, why: "" })).toMatchObject({ kind: "height", feet: 10.5 });
    expect(at({ kind: "plate", feet: 9.09375, why: "" })).toMatchObject({ kind: "height", feet: 9.09375 });
    expect(at({ kind: "partial", feet: 3.5, why: "" })).toMatchObject({ kind: "height", feet: 3.5 });
  });
  it("to deck with one printed value is that value; with none, soffit, a plate or partial with no figure: the one question", () => {
    expect(at({ kind: "to-structure", feet: 15, why: "" })).toMatchObject({ kind: "height", feet: 15 });
    for (const r of [{ kind: "to-structure", feet: null, why: "" }, { kind: "to-soffit", why: "" }, { kind: "plate", feet: null, why: "" }, { kind: "partial", feet: null, why: "" }] as TypeHeightRule[]) {
      expect(at(r, [9, 9], 9)).toMatchObject({ kind: "needs-answer" });
    }
  });
  it("no board is excluded, and no type rule falls through to today's chain", () => {
    expect(at({ kind: "no-board", why: "" })).toMatchObject({ kind: "no-board" });
    expect(at(null)).toBeNull();
  });
});

describe("one wall, its type, the plan's general rule and the deck zones together (product and eval call this)", async () => {
  const { wallHeightByType } = await import("./typeHeights");
  const { deckZones, deckValues } = await import("./deckHeights");
  const rules = new Map<string, TypeHeightRule>([
    ["C", { kind: "fixed", feet: 4, why: "4'-0\"" }],
    ["P0B", { kind: "above-ceiling", inches: 4, why: '4" ABOVE CEILING' }],
    ["A", { kind: "to-structure", feet: null, why: "TO DECK" }],
    ["M8", { kind: "no-board", why: '8" CMU' }],
  ]);
  const deck = { zones: deckZones(deckValues([{ str: 'BOTTOM OF ROOF DECK ELEVATION = 112\'-6" UNO', x: 0.1, y: 0.1, height: 0.004 }]), { floorElevation: 100 }), at: { x: 0.5, y: 0.5 }, feetPerUnit: 100 };
  const base = { rules, general: null, sideCeilings: [9, 8] as (number | null)[], setCeilingFt: null, deck: null };
  it("a typed wall takes its type's rule", () => {
    expect(wallHeightByType({ ...base, code: "C" })).toMatchObject({ kind: "height", feet: 4 });
    expect(wallHeightByType({ ...base, code: "P0B" })).toMatchObject({ kind: "height", feet: 9 + 4 / 12 });
    expect(wallHeightByType({ ...base, code: "M8" })).toMatchObject({ kind: "no-board" });
  });
  it("a to-deck type takes the deck zone's printed value; with no zone, the one question", () => {
    expect(wallHeightByType({ ...base, code: "A", deck })).toMatchObject({ kind: "height", feet: 12.5 });
    expect(wallHeightByType({ ...base, code: "A" })).toMatchObject({ kind: "needs-answer" });
  });
  it("an untyped wall takes the plan's general rule: a named type, or a rule", () => {
    expect(wallHeightByType({ ...base, code: null, general: { typeCode: "C" } })).toMatchObject({ kind: "height", feet: 4 });
    expect(wallHeightByType({ ...base, code: null, general: { rule: { kind: "to-structure", feet: null, why: "ALL WALLS TO DECK U.N.O." } }, deck })).toMatchObject({ kind: "height", feet: 12.5 });
  });
  it("a type the legend gives no rule for, and an untyped wall with no general rule, fall through to today's chain", () => {
    expect(wallHeightByType({ ...base, code: "ZZ" })).toBeNull();
    expect(wallHeightByType({ ...base, code: null })).toBeNull();
  });
});
