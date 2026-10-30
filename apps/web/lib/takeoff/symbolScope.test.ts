import { describe, expect, it } from "vitest";
import { scopeSentence, sheetDiscipline, sheetInScope } from "./symbolScope";

describe("sheetDiscipline", () => {
  it("reads the first letter of a US sheet number", () => {
    expect(sheetDiscipline("EL1.01")).toBe("E");
    expect(sheetDiscipline("EP1.21")).toBe("E");
    expect(sheetDiscipline("E-201")).toBe("E");
    expect(sheetDiscipline("FP-101")).toBe("F");
    expect(sheetDiscipline("MEP-201")).toBe("M");
    expect(sheetDiscipline("a101")).toBe("A");
    expect(sheetDiscipline("G010")).toBe("G");
  });
  it("has none for a page with no number", () => {
    expect(sheetDiscipline(null)).toBeNull();
    expect(sheetDiscipline("")).toBeNull();
    expect(sheetDiscipline("12")).toBeNull();
  });
});

describe("sheetInScope", () => {
  it("same discipline keeps the electrical sheets and drops the rest", () => {
    expect(sheetInScope("discipline", "EL1.01", "EP1.01")).toBe(true);
    expect(sheetInScope("discipline", "EL1.01", "E5.01")).toBe(true);
    expect(sheetInScope("discipline", "EL1.01", "M1.01")).toBe(false);
    expect(sheetInScope("discipline", "EL1.01", null)).toBe(false);
  });
  it("every sheet when asked, and when the start sheet has no number", () => {
    expect(sheetInScope("all", "EL1.01", "M1.01")).toBe(true);
    expect(sheetInScope("discipline", null, "M1.01")).toBe(true);
  });
  it("says what it will walk", () => {
    expect(scopeSentence("discipline", "EL1.01", 12, 65)).toBe("Sheets numbered E… like this one (12 of 65).");
    expect(scopeSentence("all", "EL1.01", 12, 65)).toBe("Every sheet in the set (65).");
    expect(scopeSentence("discipline", null, 65, 65)).toMatch(/no readable number/);
  });
});
