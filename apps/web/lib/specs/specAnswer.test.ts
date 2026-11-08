import { describe, expect, it } from "vitest";
import type { SpecTradeRead } from "@prova/integrations/src/specTrade";
import { asSpecTopic, estimateWords, specAnswer } from "./specAnswer";

const empty: SpecTradeRead = { products: [], studs: [], boards: [], fireRatings: [], ceilings: [], finishLevels: [], priceDrivers: [], requirements: [], reason: "" };
const facts = [
  {
    sectionNumber: "09 21 16",
    read: {
      ...empty,
      boards: [
        { kind: "Type X", thickness: "5/8 inch", where: "at all fire-rated assemblies", quote: "Type X: ASTM C1396, 5/8 inch thick, at all fire-rated assemblies." },
        { kind: "abuse-resistant", thickness: "5/8 inch", where: "at corridors", quote: "Abuse-resistant gypsum board at corridors." },
      ],
      finishLevels: [
        { level: 4, where: null, quote: "Level 4 finish at all exposed surfaces." },
        { level: 5, where: "main lobby", quote: "Level 5 finish at the main lobby." },
      ],
      priceDrivers: [{ label: "No substitutions on board", why: "The named product must be used.", quote: "No substitutions." }],
    },
  },
  {
    sectionNumber: "09 22 16, sheet A100",
    read: {
      ...empty,
      studs: [
        { gauge: "20 GA", depth: '3-5/8"', spacing: '16" O.C.', quote: 'ALL INTERIOR STUD WALLS TO BE 3-5/8" 20GA. @ 16" O.C.' },
        { gauge: "25 GA", depth: null, spacing: '24" O.C.', quote: "STRUT: 25 GAUGE STUD @ 24\" O.C." },
      ],
      priceDrivers: [{ label: "Deflection track", why: "Slotted track at the head.", quote: "20 GA. DEEP LEG DEFLECTION TRACK" }],
    },
  },
];

describe("Ask's answer about a job's spec, every item with its source", () => {
  it("board: each board with its source and quote", () => {
    const a = specAnswer(facts, "board", []) as unknown as { sources: string[]; board: { kind: string; source: string }[] };
    expect(a.sources).toEqual(["09 21 16", "09 22 16, sheet A100"]);
    expect(a.board.map((b) => [b.kind, b.source])).toEqual([
      ["Type X", "09 21 16"],
      ["abuse-resistant", "09 21 16"],
    ]);
  });

  it("studs: the lightest gauge and widest spacing any source allows, read by code", () => {
    const a = specAnswer(facts, "studs", []) as unknown as { lightestGaugeAllowed: number; widestSpacingAllowedInches: number; studs: { source: string }[] };
    expect([a.lightestGaugeAllowed, a.widestSpacingAllowedInches]).toEqual([25, 24]);
    expect(a.studs[0].source).toBe("09 22 16, sheet A100");
  });

  it("finish level: says whether Level 5 is anywhere, and where", () => {
    const a = specAnswer(facts, "finish_level", []) as unknown as { level5Anywhere: boolean; finishLevels: { level: number; where: string | null }[] };
    expect(a.level5Anywhere).toBe(true);
    expect(a.finishLevels.find((f) => f.level === 5)?.where).toBe("main lobby");
    const none = specAnswer([facts[1]], "finish_level", []) as unknown as { level5Anywhere: boolean };
    expect(none.level5Anywhere).toBe(false);
  });

  it("not in my estimate: price items matched by the estimate lines' words, and says how", () => {
    const lines = [{ description: 'C8B — 5/8" Type X gypsum board' }, { description: 'S6A — 3 5/8" 18 ga studs' }];
    const a = specAnswer(facts, "not_in_estimate", lines) as unknown as {
      notOnEstimate: { item: string; source: string }[];
      onEstimate: { item: string; line: string }[];
      howMatched: string;
      estimateLineCount: number;
    };
    expect(a.onEstimate.map((o) => [o.item, o.line])).toEqual([
      ["Type X board at all fire-rated assemblies", 'C8B — 5/8" Type X gypsum board'],
      // 18 ga is heavier than the 20 ga minimum, so it carries it.
      ["20 ga studs", 'S6A — 3 5/8" 18 ga studs'],
    ]);
    expect(a.notOnEstimate.map((n) => n.item)).toEqual(["abuse-resistant board at corridors", "Level 5 finish at main lobby", "deflection track"]);
    // "No substitutions" is nothing a line can carry, so it is not listed as missing.
    expect(a.notOnEstimate.some((n) => /substitution/i.test(n.item))).toBe(false);
    expect(a.howMatched).toMatch(/words on the estimate's line descriptions/);
    expect(a.estimateLineCount).toBe(2);
  });

  it("reads a topic it does not know as all, and matches gauges at that weight or heavier", () => {
    expect(asSpecTopic("bogus")).toBe("all");
    expect(asSpecTopic("studs")).toBe("studs");
    const w = estimateWords("20 ga studs")!;
    expect([w.test("16 ga studs"), w.test("20 gauge"), w.test("25 ga studs")]).toEqual([true, true, false]);
    expect(estimateWords("No substitutions")).toBeNull();
  });
});
