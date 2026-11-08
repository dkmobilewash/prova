import { describe, expect, it } from "vitest";
import { specTradeReadFrom, type SpecTradeRead } from "@prova/integrations/src/specTrade";
import { checkWallType, gaugeFrom, linePart, spacingFrom, specSays, specSaysLine, thicknessFrom } from "./specTradeFacts";

const empty: SpecTradeRead = { products: [], studs: [], boards: [], fireRatings: [], ceilings: [], finishLevels: [], priceDrivers: [], requirements: [], reason: "" };

const board: SpecTradeRead = {
  ...empty,
  boards: [
    { kind: "Type X", thickness: "5/8 inch", where: "at all fire-rated assemblies", quote: "Type X: ASTM C1396, 5/8 inch thick" },
    { kind: "abuse-resistant", thickness: "5/8 inch", where: "at corridors", quote: "Abuse-resistant gypsum board: 5/8 inch" },
  ],
  finishLevels: [
    { level: 4, where: "all exposed surfaces unless otherwise indicated", quote: "Level 4 finish at all exposed surfaces" },
    { level: 5, where: "main lobby", quote: "Level 5 finish at the main lobby" },
  ],
  fireRatings: [{ rating: "1-hour", assembly: "UL Design U419", quote: "Fire-rated partitions: UL Design U419, 1-hour." }],
};
const framing: SpecTradeRead = {
  ...empty,
  studs: [{ gauge: "20 gauge (33 mil) minimum", depth: "3-5/8 inch", spacing: "16 inches on center maximum", quote: "Steel studs: 20 gauge (33 mil) minimum" }],
  priceDrivers: [{ label: "Deflection track", why: "Slotted track at walls to structure", quote: "Slotted deflection track at all partitions" }],
};
const sections = [
  { sectionNumber: "09 21 16", read: board },
  { sectionNumber: "09 22 16", read: framing },
];

describe("the spec's numbers come from the printed words", () => {
  it("reads gauge, mils, spacing and thickness", () => {
    expect(gaugeFrom("20 gauge (33 mil) minimum")).toBe(20);
    expect(gaugeFrom("18 mil")).toBe(25);
    expect(gaugeFrom("43 mils")).toBe(18);
    expect(gaugeFrom("heavy duty")).toBeNull();
    expect(spacingFrom("16 inches on center maximum")).toBe(16);
    expect(spacingFrom('24" o.c.')).toBe(24);
    expect(spacingFrom("at 16 o.c.")).toBe(16);
    expect(thicknessFrom("5/8 inch")).toBe(0.625);
    expect(thicknessFrom("1/2-inch")).toBe(0.5);
    expect(thicknessFrom("8 feet")).toBeNull();
  });
});

describe("a legend wall type checked against the spec", () => {
  it("a rated metal-stud wall: Type X, Level 4, 20 ga, 16 in, deflection track, the UL design — and no conflict when it agrees", () => {
    const check = checkWallType(
      { code: "A1", lines: ['3 5/8" 20 GA. MTL. STUDS @ 16" O.C.', '(1) LAYER 5/8" TYPE X GYP. BD. EACH SIDE', "1 HR RATED"] },
      sections,
    );
    expect(check.applies).toEqual(['09 21 16: 5/8" Type X, Level 4, UL Design U419', '09 22 16: 20 ga min, 16" o.c. max, deflection track']);
    expect(check.conflicts).toEqual([]);
  });

  it("flags lighter studs, wider spacing, thinner board and a rated wall without Type X, each with the spec's quote", () => {
    const check = checkWallType(
      { code: "B", lines: ['3 5/8" 25 GA. MTL. STUDS @ 24" O.C.', '1/2" GYP. BD. EACH SIDE', "1 HOUR"] },
      sections,
    );
    expect(check.conflicts.map((c) => [c.what, c.legend, c.spec, c.sectionNumber])).toEqual([
      ["Board on a rated wall", "not Type X", "Type X", "09 21 16"],
      ["Board thickness", '1/2"', '5/8" or thicker', "09 21 16"],
      ["Stud gauge", "25 ga", "20 ga or heavier", "09 22 16"],
      ["Stud spacing", '24" o.c.', '16" o.c. or closer', "09 22 16"],
    ]);
    expect(check.conflicts[2].quote).toBe("Steel studs: 20 gauge (33 mil) minimum");
  });

  it("an unrated wall takes no Type X conflict and no UL design; a wall the spec says nothing about gets nothing", () => {
    const unrated = checkWallType({ code: "C", lines: ['6" 20 GA. MTL. STUDS @ 16" O.C.', '5/8" GYP. BD. ONE SIDE'] }, sections);
    expect(unrated.conflicts).toEqual([]);
    expect(unrated.applies[1]).toBe('09 22 16: 20 ga min, 16" o.c. max, deflection track');
    expect(checkWallType({ code: "D", lines: ["CMU WALL"] }, [{ sectionNumber: "09 51 13", read: empty }])).toEqual({ code: "D", applies: [], conflicts: [] });
  });
});

describe("the reader's reply into a read", () => {
  it("drops an item with no quote, a blank required value, or a finish level outside 0-5", () => {
    const read = specTradeReadFrom({
      products: [{ manufacturer: "USG", product: null, quote: "USG Corporation" }, { manufacturer: "Acme", quote: "" }],
      studs: [{ gauge: null, depth: null, spacing: null, quote: "x" }],
      boards: [{ kind: " ", thickness: "5/8", where: null, quote: "q" }],
      finishLevels: [{ level: 7, where: null, quote: "q" }, { level: 5, where: "lobby", quote: "Level 5 at lobby" }],
      priceDrivers: [{ label: "L5", why: "", quote: "q" }],
      reason: "read it",
    });
    expect(read.products).toEqual([{ manufacturer: "USG", product: null, quote: "USG Corporation" }]);
    expect(read.studs).toEqual([]);
    expect(read.boards).toEqual([]);
    expect(read.finishLevels).toEqual([{ level: 5, where: "lobby", quote: "Level 5 at lobby" }]);
    expect(read.priceDrivers).toEqual([]);
    expect(specTradeReadFrom(null)).toEqual(empty);
  });
});

describe("what the spec says that changes a wall type's price", () => {
  const abuse: SpecTradeRead = {
    ...empty,
    boards: [...board.boards, { kind: "abuse-resistant", thickness: "5/8 inch", where: "at corridors", quote: "q" }],
    finishLevels: [{ level: 5, where: "THE LOBBY", quote: "q" }],
  };
  const drawn = [
    { sectionNumber: "09 21 16", read: abuse },
    { sectionNumber: "09 22 16, sheet A100", read: framing },
  ];

  it("a rated wall gets Type X; every board wall abuse board and Level 5 where they apply; studs heavier than 25 ga and deflection track, with the legend's lighter gauge said", () => {
    const says = specSays(['3 5/8" 25 GA. MTL. STUDS @ 16" O.C.', '5/8" TYPE X GYP. BD. EACH SIDE', "1 HR"], drawn);
    expect(specSaysLine(says)).toBe(
      "Spec says: Type X board (09 21 16); abuse-resistant board at corridors (09 21 16); Level 5 finish at the lobby (09 21 16); 20 ga studs minimum, the legend says 25 ga (09 22 16, sheet A100); deflection track (09 22 16, sheet A100)",
    );
  });

  it("an unrated wall gets no Type X; a CMU wall gets nothing; a type with no legend words gets every item with its where", () => {
    expect(specSays(['3 5/8" 20 GA. MTL. STUDS @ 16" O.C.', '5/8" GYP. BD. EACH SIDE'], drawn).map((s) => s.text)).toEqual([
      "abuse-resistant board at corridors",
      "Level 5 finish at the lobby",
      "20 ga studs minimum",
      "deflection track",
    ]);
    expect(specSays(["8\" CMU"], drawn)).toEqual([]);
    expect(specSays(null, drawn).map((s) => s.text)[0]).toBe("Type X board at all fire-rated assemblies");
    expect(specSaysLine([])).toBe("");
    expect(
      specSaysLine([
        { text: "Type X board", source: "09 21 16", part: "board" },
        { text: "Type X board", source: "09 21 16, sheet G001", part: "board" },
      ]),
    ).toBe("Spec says: Type X board (09 21 16; 09 21 16, sheet G001)");
  });

  it("an estimate line is board or framing by its words", () => {
    expect(linePart("C8B — 5/8\" gypsum board")).toBe("board");
    expect(linePart("S6A studs, 3 5/8\" 20 ga")).toBe("framing");
    expect(linePart("Insulation")).toBeNull();
  });
});
