import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buyoutSpecCheck, specCheckSentence, tradeForSection } from "./buyout-spec-check";
import type { SpecFindingView } from "./specs/spec-findings";

const finding = (kind: SpecFindingView["kind"], label: string): SpecFindingView => ({
  ordinal: 1, kind, label, requirement: "r", whyItCosts: "w", confidence: "HIGH", quote: `"${label}"`, sourcePageLabel: "3",
});
const lines = [
  { id: "board", tradeScope: "METAL_FRAMING_DRYWALL" },
  { id: "track", tradeScope: "METAL_FRAMING_DRYWALL" },
  { id: "spray", tradeScope: "FIREPROOFING" },
  { id: "misc", tradeScope: null },
];

describe("which trade a section belongs to", () => {
  it("reads the number as printed, however it is spaced", () => {
    expect(tradeForSection("09 21 16")).toBe("METAL_FRAMING_DRYWALL");
    expect(tradeForSection("Section 092216")).toBe("METAL_FRAMING_DRYWALL");
    expect(tradeForSection("09 24 00")).toBe("LATH_PLASTER");
    expect(tradeForSection("07 24 13")).toBe("EIFS");
    expect(tradeForSection("09 51 13")).toBe("ACOUSTICAL_CEILINGS");
    expect(tradeForSection("07 81 00")).toBe("FIREPROOFING");
    expect(tradeForSection("01 33 00")).toBeNull();
  });
});

describe("placing findings", () => {
  it("puts a finding on every line of its trade, with its section", () => {
    const check = buyoutSpecCheck(lines, [{ sectionNumber: "09 21 16", findings: [finding("NAMED_PRODUCT", "USG only")] }]);
    expect(check.byLine.get("board")?.map((f) => [f.label, f.sectionNumber])).toEqual([["USG only", "09 21 16"]]);
    expect(check.byLine.get("track")).toHaveLength(1);
    expect(check.byLine.get("spray")).toBeUndefined();
    expect(check.unplaced).toEqual([]);
  });

  it("never drops a finding: no trade, or no line of that trade, goes to unplaced", () => {
    const check = buyoutSpecCheck(lines, [
      { sectionNumber: "01 33 00", findings: [finding("PERFORMANCE", "Division one")] },
      { sectionNumber: "07 24 13", findings: [finding("FIRE_RATING", "No EIFS line")] },
    ]);
    expect(check.unplaced.map((f) => f.label)).toEqual(["Division one", "No EIFS line"]);
    expect(check.byLine.size).toBe(0);
  });

  it("leaves contract terms on the bid", () => {
    const check = buyoutSpecCheck(lines, [{ sectionNumber: "09 21 16", findings: [finding("LIQUIDATED_DAMAGES", "LDs"), finding("MOCK_UP", "Mock-up")] }]);
    expect(check.byLine.size).toBe(0);
    expect(check.unplaced).toEqual([]);
  });

  it("counts every section read, including one with nothing to show", () => {
    expect(buyoutSpecCheck(lines, [{ sectionNumber: "09 21 16", findings: [] }]).sectionsRead).toBe(1);
  });
});

describe("what it will not say", () => {
  it("never reassures, whatever it found", () => {
    const sentences = [specCheckSentence({ sectionsRead: 0 }), specCheckSentence({ sectionsRead: 1 }), specCheckSentence({ sectionsRead: 3 })];
    expect(sentences[1]).toContain("1 spec section read");
    expect(sentences[2]).toContain("3 spec sections read");
    for (const s of sentences) expect(s).not.toMatch(/complies|compliant|meets|no issues|all clear|ok\b|matches/i);
  });

  it("imports nothing from lib/takeoff", () => {
    for (const file of ["lib/buyout-spec-check.ts", "lib/buyout-spec-query.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source.length).toBeGreaterThan(100);
      expect(source).not.toMatch(/from\s+"[^"]*takeoff/);
    }
  });
});
