import { describe, expect, it } from "vitest";
import {
  LEAN_PER_HOUR_ABOVE,
  LEAN_PER_UNIT_BELOW,
  NOMINAL_QUANTITY,
  PRODUCTION_RATE_MAX,
  consequencesFor,
  laborFieldsFor,
  laborQuestion,
  leanFrom,
  readingFromForm,
  sampleRowFor,
} from "./catalog-import-labor";
import { estimatedHours } from "./labor-productivity";
import type { ImportRow } from "./catalog-import";

/**
 * The import stops guessing what a price list's Hours column means.
 *
 * The number under test throughout is **0.012**, because it is not invented:
 * it is what `CatalogImport`'s own sample carried for a square foot of
 * 5/8" board, and it is the value the shipped importer wrote into a flat
 * hours column. Every assertion below is about that one cell read three ways.
 *
 * THE CASE THIS FILE EXISTS FOR is the middle row of the table in
 * `readings a person can actually choose between`: issue #514 asked for the
 * hours column to be mapped straight into `productionRate`, and that is
 * asserted here as the 50,000-hour answer it produces, so the prescription
 * cannot be re-applied by anybody reading the issue instead of the code.
 */

function row(over: Partial<ImportRow> = {}): ImportRow {
  return {
    line: 2,
    description: '5/8" Type X board',
    unit: "SF",
    unitPrice: 2.85,
    budgetedUnitCost: 1.9,
    laborHours: 0.012,
    tradeScope: "METAL_FRAMING_DRYWALL",
    ...over,
  };
}

const at = (cell: number, reading: "PER_UNIT" | "PER_HOUR" | "FLAT") => {
  const found = consequencesFor(cell).find((c) => c.reading === reading);
  if (!found) throw new Error(`no consequence for ${reading}`);
  return found;
};

describe("readings a person can actually choose between", () => {
  // The whole design in one table. 100 SF of board, from a cell of 0.012.
  it("0.012 read three ways gives 1.2, 50,000 and 0.01 hours", () => {
    expect(at(0.012, "PER_UNIT").hoursAtNominal).toBeCloseTo(1.2, 4);
    expect(at(0.012, "PER_HOUR").hoursAtNominal).toBeCloseTo(8333.3333, 2);
    expect(at(0.012, "FLAT").hoursAtNominal).toBe(0.01);
  });

  it("stores 83.3333 units/hr for the per-unit reading, and no flat hours", () => {
    const c = at(0.012, "PER_UNIT");
    expect(c.productionRate).toBe(83.3333);
    expect(c.laborHours).toBeNull();
  });

  it("stores the cell unchanged for the units-per-hour reading", () => {
    const c = at(60, "PER_HOUR");
    expect(c.productionRate).toBe(60);
    expect(c.hoursAtNominal).toBeCloseTo(NOMINAL_QUANTITY / 60, 6);
  });

  it("FLAT shows the LOSS the column imposes — 0.012 becomes 0.01", () => {
    // The clearest available argument that flat is wrong for a per-unit file,
    // and it comes from the column width rather than from prose.
    const c = at(0.012, "FLAT");
    expect(c.laborHours).toBe(0.01);
    expect(c.laborHours).not.toBe(0.012);
    expect(c.productionRate).toBeNull();
  });

  it("never offers both columns at once, under any reading", () => {
    for (const cell of [0.012, 1.5, 60, 0.4, 83.3333]) {
      for (const c of consequencesFor(cell)) {
        expect(c.productionRate === null || c.laborHours === null).toBe(true);
      }
    }
  });
});

describe("the ~6,900x error this module was written to refuse", () => {
  // #514's literal prescription, priced out. Not an argument — a number.
  it("mapping hours-per-unit into the rate gives 50,000 hours for 600 SF", () => {
    const naive = estimatedHours({ quantity: 600, laborHours: null, productionRate: 0.012 });
    expect(naive).toBeCloseTo(50000, 0);

    const correct = estimatedHours({
      quantity: 600,
      laborHours: null,
      productionRate: at(0.012, "PER_UNIT").productionRate,
    });
    expect(correct).toBeCloseTo(7.2, 3);

    // The overstatement factor is exactly 1/x², which is worth asserting
    // rather than asserting the two hours figures separately: it says the
    // error GROWS as the work gets faster, so the finest per-unit factors —
    // the ones a drywall list is full of — are the worst affected.
    // 1/0.012² = 6,944, and 50,000 / 7.2 is the same number.
    expect((naive as number) / (correct as number)).toBeCloseTo(1 / 0.012 ** 2, 0);
  });

  it("and inverting a units-per-hour file is just as bad the other way", () => {
    // A list that really says 60 SF/hr, inverted: 1/60 = 0.0167 stored as a
    // rate, and 600 SF reads as 36,000 hours. This is why the fix is a
    // question and not an inversion.
    const inverted = at(60, "PER_UNIT").productionRate;
    expect(inverted).toBeCloseTo(0.0167, 4);
    expect(
      estimatedHours({ quantity: 600, laborHours: null, productionRate: inverted }),
    ).toBeGreaterThan(35000);

    // Read correctly, the same file gives ten hours.
    expect(
      estimatedHours({ quantity: 600, laborHours: null, productionRate: at(60, "PER_HOUR").productionRate }),
    ).toBeCloseTo(10, 6);
  });
});

describe("the lean is timid on purpose", () => {
  it("leans per-unit when every value is below 1", () => {
    const lean = leanFrom([0.012, 0.03, 0.02]);
    expect(lean.suggested).toBe("PER_UNIT");
    expect(lean.because).toContain("hours per unit");
  });

  it("leans units-per-hour when every value is above 10", () => {
    const lean = leanFrom([60, 83.33, 120]);
    expect(lean.suggested).toBe("PER_HOUR");
    expect(lean.because).toContain("units per hour");
  });

  it("REFUSES TO LEAN on the door-assembly case, which is the real ambiguity", () => {
    // 1.5/2/3 hours per door — or, read the other way, 0.67/0.5/0.33 doors an
    // hour. Both are sentences a person might have meant, so the numbers do
    // not settle it and the form must not pretend they do.
    const lean = leanFrom([1.5, 2, 3]);
    expect(lean.suggested).toBeNull();
    expect(lean.because).toContain("does not settle it");
  });

  it("refuses to lean when the values straddle the band", () => {
    expect(leanFrom([0.012, 60]).suggested).toBeNull();
  });

  it("does not lean on a value sitting exactly on either threshold", () => {
    // Inclusive bounds would make the lean fire on the one value that is
    // least distinguishable, which is the opposite of timid.
    expect(leanFrom([LEAN_PER_UNIT_BELOW]).suggested).toBeNull();
    expect(leanFrom([LEAN_PER_HOUR_ABOVE]).suggested).toBeNull();
  });

  it("ignores non-positive values rather than letting them decide", () => {
    expect(leanFrom([0, -1, 0.012]).suggested).toBe("PER_UNIT");
    expect(leanFrom([0, -1]).suggested).toBeNull();
  });
});

describe("a cell no reading can store", () => {
  it("gives every reading a refusal for zero, and no numbers", () => {
    for (const c of consequencesFor(0)) {
      expect(c.productionRate).toBeNull();
      expect(c.laborHours).toBeNull();
      expect(c.hoursAtNominal).toBeNull();
      expect(c.refusal).not.toBeNull();
    }
  });

  it("refuses a negative cell rather than inverting its sign away", () => {
    // parseNumber accepts "(4.00)" as -4, so this cell is reachable from a
    // real export. 1/-4 is a NEGATIVE rate, which would divide into negative
    // hours and read as a credit.
    for (const c of consequencesFor(-4)) {
      expect(c.productionRate).toBeNull();
      expect(c.hoursAtNominal).toBeNull();
    }
  });

  it("refuses a rate that would land outside the field's bounds", () => {
    // 1/0.000001 is 1,000,000 — over the ceiling the typed field also
    // enforces, so the import cannot store what the form would reject.
    const c = at(0.000001, "PER_UNIT");
    expect(c.productionRate).toBeNull();
    expect(c.refusal).toContain(String(PRODUCTION_RATE_MAX));
  });

  it("says so when a value rounds to nothing under the flat reading", () => {
    const c = at(0.004, "FLAT");
    expect(c.laborHours).toBeNull();
    expect(c.refusal).toContain("0.00");
  });
});

describe("the row the question is asked about", () => {
  it("is the median carrier, not the first row", () => {
    const rows = [row({ line: 2, laborHours: 0.5 }), row({ line: 3, laborHours: 0.012 }), row({ line: 4, laborHours: 0.1 })];
    expect(sampleRowFor(rows)?.line).toBe(4);
  });

  it("prefers a row with a unit, so the sentence reads", () => {
    const rows = [row({ line: 2, unit: null, laborHours: 0.01 }), row({ line: 3, unit: "SF", laborHours: 0.9 })];
    expect(sampleRowFor(rows)?.unit).toBe("SF");
  });

  it("skips rows with no usable value", () => {
    const rows = [row({ line: 2, laborHours: 0 }), row({ line: 3, laborHours: 0.012 })];
    expect(sampleRowFor(rows)?.line).toBe(3);
  });

  it("is null when nothing carries labor", () => {
    expect(sampleRowFor([row({ laborHours: null })])).toBeNull();
  });
});

describe("when the question is raised at all", () => {
  it("is absent when no row has an hours figure", () => {
    expect(laborQuestion([row({ laborHours: null })]).kind).toBe("absent");
  });

  it("is absent when the file has no rows", () => {
    expect(laborQuestion([]).kind).toBe("absent");
  });

  it("is absent when values exist but none can be stored — nothing to choose", () => {
    // Every reading refuses, so a question would offer three identical
    // outcomes and make the person pick between them for no reason.
    expect(laborQuestion([row({ laborHours: 0 }), row({ laborHours: -2 })]).kind).toBe("absent");
  });

  it("is asked, with counts, as soon as one row carries labor", () => {
    const q = laborQuestion([row({ laborHours: 0.012 }), row({ line: 3, laborHours: 0 }), row({ line: 4, laborHours: null })]);
    if (q.kind !== "ask") throw new Error("expected a question");
    expect(q.cell).toBe(0.012);
    expect(q.carrying).toBe(2);
    expect(q.unusable).toBe(1);
    expect(q.consequences).toHaveLength(3);
  });
});

describe("the submitted answer is never guessed through", () => {
  it("accepts the three readings, case-insensitively", () => {
    expect(readingFromForm("PER_UNIT")).toBe("PER_UNIT");
    expect(readingFromForm("per_hour")).toBe("PER_HOUR");
    expect(readingFromForm(" flat ")).toBe("FLAT");
  });

  it("returns null for anything else, so the caller must refuse", () => {
    for (const bad of ["", "HOURS", "per unit", null, undefined, 3, {}]) {
      expect(readingFromForm(bad)).toBeNull();
    }
  });
});

describe("what one row writes", () => {
  it("writes only the rate under the per-unit reading", () => {
    expect(laborFieldsFor(row(), "PER_UNIT")).toEqual({
      defaultLaborHours: null,
      productionRate: "83.3333",
    });
  });

  it("writes only flat hours under the flat reading", () => {
    expect(laborFieldsFor(row({ laborHours: 2.5 }), "FLAT")).toEqual({
      defaultLaborHours: "2.5",
      productionRate: null,
    });
  });

  it("writes nothing for a row with no hours cell", () => {
    expect(laborFieldsFor(row({ laborHours: null }), "PER_UNIT")).toEqual({
      defaultLaborHours: null,
      productionRate: null,
    });
  });

  it("writes nothing for a row whose value no reading can store", () => {
    expect(laborFieldsFor(row({ laborHours: 0 }), "PER_UNIT")).toEqual({
      defaultLaborHours: null,
      productionRate: null,
    });
  });

  it("round-trips: what it writes, read by the app, gives the hours shown", () => {
    // The end-to-end claim, composed from the real `estimatedHours` rather
    // than restated. A preview that promises 1.2 hours and a product that
    // computes something else is the defect wearing a nicer coat.
    const fields = laborFieldsFor(row(), "PER_UNIT");
    const shown = at(0.012, "PER_UNIT").hoursAtNominal;
    const computed = estimatedHours({
      quantity: NOMINAL_QUANTITY,
      laborHours: fields.defaultLaborHours != null ? Number(fields.defaultLaborHours) : null,
      productionRate: fields.productionRate != null ? Number(fields.productionRate) : null,
    });
    expect(computed).toBeCloseTo(shown as number, 9);
  });
});
