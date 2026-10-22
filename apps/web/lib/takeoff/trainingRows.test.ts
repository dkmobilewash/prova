import { describe, expect, it } from "vitest";
import { trainingRows, trainingRowsSentence, type LabelledSheet } from "./trainingRows";

const row = (label: number) => ({ features: [1, 2, 3], label, lengthFt: 10 });

const sheet = (set: string, name: string, labels: number[]): LabelledSheet => ({
  set,
  sheet: name,
  rows: labels.map(row),
});

describe("building training rows", () => {
  it("REFUSES a held-out set and keeps the rest", () => {
    // The assertion this whole feature exists for. Gen BBQ's labels are a test
    // answer key; a model that has seen them is not being tested by them.
    const got = trainingRows([
      sheet("Camp Bow Wow - 100% CD_ARCH (2) (1).pdf", "A101", [1, 0, 1]),
      sheet("Gen-BBQ-Sacramento-CA.pdf", "A100", [1, 1, 1, 1]),
      sheet("NG-Green-Bay-WI.pdf", "A3.1", [0, 1]),
    ]);
    expect(got.rows).toHaveLength(5);
    expect(got.rows.every((r) => !r.family.includes("gen-bbq"))).toBe(true);
    expect(got.refused).toHaveLength(1);
    expect(got.refused[0].rows).toBe(4);
    expect(got.refused[0].why).toContain("restaurant");
  });

  it("refuses every one of the four held out on 2026-10-20", () => {
    const got = trainingRows([
      sheet("CENTRAL-BANK-OF-THE-MIDWEST-Drawings.pdf", "A101", [1]),
      sheet("Gen-BBQ-Sacramento-CA.pdf", "A101", [1]),
      sheet("SLN-Terminal-Public-Area-Improvements-Plans.pdf", "A-101A", [1]),
      sheet("stem-bid-drawings (1).pdf", "A-1.1", [1]),
    ]);
    expect(got.rows).toEqual([]);
    expect(got.refused).toHaveLength(4);
  });

  it("makes a family of the SET, not the sheet", () => {
    // Two floors of one tower are one building. Splitting between them scores
    // a model on the building it trained on — measured, and the reason six
    // labelled sheets turned out to be three families.
    const got = trainingRows([
      sheet("IFBREBID-Murray-Tower-Package.pdf", "A101", [1]),
      sheet("IFBREBID-Murray-Tower-Package.pdf", "A102", [1]),
    ]);
    expect(got.counts.families).toBe(1);
    expect(new Set(got.rows.map((r) => r.case)).size, "but two cases").toBe(2);
  });

  it("counts positives and families for the run's own report", () => {
    const got = trainingRows([
      sheet("E_Street_421-Set.pdf", "A2.1", [1, 1, 0]),
      sheet("BUNKIE-BID-DRAWINGS.pdf", "A100", [0, 0]),
    ]);
    expect(got.counts.rows).toBe(5);
    expect(got.counts.positive).toBe(2);
    expect(got.counts.families).toBe(2);
    expect(got.counts.sheets).toBe(2);
  });

  it("carries the length through, and a missing one as null", () => {
    const got = trainingRows([
      { set: "NG-Green-Bay-WI.pdf", sheet: "A3.1", rows: [{ features: [1], label: 1 }] },
    ]);
    expect(got.rows[0].lengthFt).toBeNull();
  });

  it("says what it refused, in a sentence a run can print", () => {
    const got = trainingRows([
      sheet("E_Street_421-Set.pdf", "A2.1", [1, 0]),
      sheet("SLN-Terminal-Public-Area-Improvements-Plans.pdf", "A-101A", [1, 1, 1]),
    ]);
    expect(trainingRowsSentence(got)).toContain("REFUSED 3 rows from 1 held-out set(s)");
    expect(trainingRowsSentence(got)).toContain("SLN-Terminal");
  });

  it("says plainly when nothing was held out", () => {
    const got = trainingRows([sheet("E_Street_421-Set.pdf", "A2.1", [1])]);
    expect(trainingRowsSentence(got)).toContain("Nothing was held out.");
  });

  it("builds nothing from nothing without pretending otherwise", () => {
    const got = trainingRows([]);
    expect(got.rows).toEqual([]);
    expect(got.counts.families).toBe(0);
  });
});
