import { describe, expect, it } from "vitest";
import { bidRecap, type RecapRates } from "@/lib/bid-recap";
import { employerBurdenCents } from "@/lib/employer-burden";
import { calculateTimeEntryLaborCost, type FringeRateScheduleInput } from "@/lib/labor-cost";
import {
  asPayType,
  laborBasisText,
  laborHourCost,
  priceLine,
  pricingBackupLines,
  recapRatesFrom,
  tmTicketProposals,
} from "./change-order-pricing";

/**
 * The claim this file exists to pin: a change order is priced by THE BID
 * RECAP'S OWN MATH, not a re-statement of it. So every expectation below is
 * computed with `bidRecap` (or the labor-cost helpers) and compared, never
 * typed in as a constant that could drift from the recap.
 */

const RECAP_NONE = recapRatesFrom(null);

const RATES: RecapRates = {
  materialMarkupPercent: 12,
  laborMarkupPercent: 15,
  subcontractorMarkupPercent: 5,
  equipmentMarkupPercent: 20,
  otherMarkupPercent: 10,
  escalationPercent: 2,
  materialTaxPercent: 8.25,
  overheadPercent: 10,
  profitPercent: 8,
  bondPercent: 1.5,
  contingencyPercent: 0,
};

const schedule: FringeRateScheduleInput = {
  baseWage: 42.1,
  pensionRate: 6.5,
  vacationRate: 2.2,
  healthWelfareRate: 9.8,
  trainingRate: 0.6,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
};
const WORK_DATE = new Date("2026-09-10T00:00:00Z");

describe("priceLine runs the bid recap", () => {
  it("equals bidRecap over the same single line, for every category and for uncategorised", () => {
    for (const costCategory of ["LABOR", "MATERIAL", "SUBCONTRACTOR", "EQUIPMENT", "OTHER", null] as const) {
      const line = { quantity: 40, unitCost: 67.56, costCategory };
      const expected = bidRecap([{ id: "x", ...line, unitPrice: null }], RATES);
      const priced = priceLine(line, RATES);
      expect(priced.unitPrice).toBe(Math.round((expected.bidTotal / 40) * 100) / 100);
      expect(priced.steps).toEqual(expected.steps);
      expect(Math.abs((priced.sellTotal ?? 0) - expected.bidTotal)).toBeLessThanOrEqual(0.2);
    }
  });

  it("uses the equipment markup for an equipment line, and the material tax only on material", () => {
    const equipment = priceLine({ quantity: 1, unitCost: 1000, costCategory: "EQUIPMENT" }, RATES);
    expect(equipment.steps[0]).toMatchObject({ key: "markup:EQUIPMENT", ratePercent: 20, amount: 200 });
    expect(equipment.steps.some((s) => s.key === "materialTax")).toBe(false);
    const material = priceLine({ quantity: 1, unitCost: 1000, costCategory: "MATERIAL" }, RATES);
    expect(material.steps.some((s) => s.key === "materialTax")).toBe(true);
  });

  it("sums per-line sells to the whole-CO recap within a cent per step per line", () => {
    const lines = [
      { quantity: 40, unitCost: 67.56, costCategory: "LABOR" as const },
      { quantity: 3, unitCost: 412.3, costCategory: "MATERIAL" as const },
      { quantity: 2, unitCost: 250, costCategory: "EQUIPMENT" as const },
    ];
    const whole = bidRecap(lines.map((l, i) => ({ id: String(i), ...l, unitPrice: null })), RATES);
    const perLine = lines.reduce((sum, l) => sum + (priceLine(l, RATES).sellTotal ?? 0), 0);
    // Three lines × up to nine rounded steps, plus a unit-price rounding each.
    expect(Math.abs(perLine - whole.bidTotal)).toBeLessThanOrEqual(0.01 * 3 * 10 + 0.01 * 3);
  });

  it("prices nothing without a cost, and never invents one", () => {
    expect(priceLine({ quantity: 8, unitCost: null, costCategory: "LABOR" }, RATES)).toEqual({ unitPrice: null, sellTotal: null, steps: [] });
    expect(priceLine({ quantity: 0, unitCost: 10, costCategory: "LABOR" }, RATES).unitPrice).toBeNull();
  });

  it("with no rates at all, sells at cost (marked up at nothing, like the bid)", () => {
    expect(priceLine({ quantity: 2, unitCost: 50, costCategory: "LABOR" }, recapRatesFrom(null)).unitPrice).toBe(50);
  });
});

describe("laborHourCost burdens the wage before anything is marked up", () => {
  it("is wage × pay-type multiplier + fringes + burden on the wage, from the labor-cost helpers", () => {
    const cost = laborHourCost("OVERTIME", [schedule], WORK_DATE, 31.25);
    expect(cost).not.toBeNull();
    const wageAndFringe = calculateTimeEntryLaborCost({ hours: 1, payType: "OVERTIME", date: WORK_DATE }, schedule)!;
    const base = 42.1 * 1.5;
    expect(cost!.baseRatePerHour).toBeCloseTo(base, 2);
    expect(cost!.fringePerHour).toBeCloseTo(6.5 + 2.2 + 9.8 + 0.6, 2);
    expect(cost!.burdenPerHour).toBe(employerBurdenCents(base, 31.25) / 100);
    expect(cost!.unitCost).toBeCloseTo(wageAndFringe + employerBurdenCents(base, 31.25) / 100, 2);
    expect(laborBasisText(cost!)).toContain("31.25% burden on the wage");
  });

  it("returns null when no schedule covers the work date — the never-default-a-wage case", () => {
    expect(laborHourCost("STRAIGHT", [], WORK_DATE, 20)).toBeNull();
    expect(laborHourCost("STRAIGHT", [{ ...schedule, effectiveFrom: new Date("2027-01-01T00:00:00Z") }], WORK_DATE, 20)).toBeNull();
  });

  it("treats a missing burden rate as zero burden, and says nothing about burden in the basis", () => {
    const cost = laborHourCost("STRAIGHT", [schedule], WORK_DATE, null)!;
    expect(cost.burdenPerHour).toBe(0);
    expect(laborBasisText(cost)).not.toContain("burden");
  });

  it("maps the snapshot's pay type, straight for anything unknown", () => {
    expect(asPayType("DOUBLE_TIME")).toBe("DOUBLE_TIME");
    expect(asPayType("REGULAR")).toBe("STRAIGHT");
    expect(asPayType(null)).toBe("STRAIGHT");
  });
});

describe("tmTicketProposals", () => {
  it("prices per diem and travel as OTHER and mileage as EQUIPMENT, through the recap", () => {
    const lookups = { schedulesByCraftName: new Map(), burdenPercent: 0, rates: RATES, workDate: WORK_DATE };
    const rows = tmTicketProposals(
      {
        labor: [{ workerName: "A", hours: "8", craftLabel: null, perDiemAmount: "60", travelPayAmount: null }],
        materials: [],
        extras: [{ kind: "TRAVEL", amount: "45.00" }, { kind: "MILEAGE", miles: "40", rate: "0.70" }, { kind: "MILEAGE", miles: "9", rate: null }],
      },
      lookups,
    ).filter((row) => row.costCategory !== "LABOR");
    const sell = (unitCost: number, costCategory: "OTHER" | "EQUIPMENT") => priceLine({ quantity: 1, unitCost, costCategory }, RATES).unitPrice;
    expect(rows.map((row) => [row.costCategory, row.quantity, row.budgetedUnitCost, row.unitPrice])).toEqual([
      ["OTHER", 1, 60, sell(60, "OTHER")],
      ["OTHER", 1, 45, sell(45, "OTHER")],
      ["EQUIPMENT", 1, 28, sell(28, "EQUIPMENT")],
      ["EQUIPMENT", 1, null, null],
    ]);
    expect(rows[0].unitPrice).toBeGreaterThan(60);
    expect(pricingBackupLines({ quantity: 1, unitCost: 28, costCategory: "EQUIPMENT" }, RATES, rows[2].unitPrice!).join(" ")).toContain("Equipment markup 20%");
  });

  const snapshot = {
    labor: [
      { workerName: "Ana Ruiz", hours: "8", payType: "STRAIGHT", craftLabel: "Carpenter JM", lineItemDescription: null },
      { workerName: "Luis Ortega", hours: "2.5", payType: "OVERTIME", craftLabel: "Laborer", lineItemDescription: null },
    ],
    materials: [{ description: "40 sheets 5/8 type X", vendorName: "Foundation", orderedOn: "2026-09-10" }],
  };
  const lookups = {
    schedulesByCraftName: new Map([["Carpenter JM", [schedule]]]),
    burdenPercent: 31.25,
    rates: RATES,
    workDate: WORK_DATE,
  };

  it("prices a labor row whose craft has a wage, through the recap, and carries the basis in the description", () => {
    const [ana] = tmTicketProposals(snapshot, lookups);
    const cost = laborHourCost("STRAIGHT", [schedule], WORK_DATE, 31.25)!;
    expect(ana).toMatchObject({ unit: "hr", quantity: 8, costCategory: "LABOR", budgetedUnitCost: cost.unitCost });
    expect(ana.unitPrice).toBe(priceLine({ quantity: 8, unitCost: cost.unitCost, costCategory: "LABOR" }, RATES).unitPrice);
    expect(ana.description).toContain("Labor — Ana Ruiz, Carpenter JM, straight, 8 h");
    expect(ana.description).toContain(laborBasisText(cost));
  });

  it("leaves a labor row with no wage UNPRICED and says why, keeping its hours", () => {
    const [, luis] = tmTicketProposals(snapshot, lookups);
    expect(luis).toMatchObject({ quantity: 2.5, costCategory: "LABOR", budgetedUnitCost: null, unitPrice: null });
    expect(luis.description).toContain("UNPRICED: no wage on file for Laborer");
  });

  it("lands every material unpriced for the person to cost", () => {
    const [, , board] = tmTicketProposals(snapshot, lookups);
    expect(board).toMatchObject({ quantity: 1, costCategory: "MATERIAL", budgetedUnitCost: null, unitPrice: null });
    expect(board.description).toContain("40 sheets 5/8 type X (Foundation)");
  });

  it("drafts nothing from an empty or malformed snapshot rather than throwing", () => {
    expect(tmTicketProposals({}, lookups)).toEqual([]);
    expect(tmTicketProposals("junk", lookups)).toEqual([]);
  });
});

describe("pricingBackupLines", () => {
  it("lists cost, every recap step with its rate, and the sell — and nothing for an unpriced line", () => {
    const line = { quantity: 40, unitCost: 67.56, costCategory: "LABOR" as const };
    const lines = pricingBackupLines(line, RATES, priceLine(line, RATES).unitPrice!);
    const expected = bidRecap([{ id: "x", ...line, unitPrice: null }], RATES);
    expect(lines[0]).toBe("Cost $67.56 × 40 = $2,702.40");
    expect(lines).toHaveLength(2 + expected.steps.length);
    expect(lines[1]).toBe("Labor markup 15%: +$405.36");
    expect(lines.at(-1)).toMatch(/^Sell \$[\d,.]+ × 40 = \$[\d,.]+$/);
    expect(pricingBackupLines({ quantity: 1, unitCost: null, costCategory: "LABOR" }, RATES, 1)).toEqual([]);
  });

  it("prints no backup when the line's price is not what these rates give", () => {
    const line = { quantity: 1, unitCost: 1000, costCategory: "EQUIPMENT" as const };
    const recapped = priceLine(line, RATES).unitPrice!;
    expect(pricingBackupLines(line, RATES, recapped).at(-1)).toContain(`Sell $`);
    expect(pricingBackupLines(line, RATES, 1500)).toEqual([]);
    expect(pricingBackupLines(line, RECAP_NONE, recapped)).toEqual([]);
  });
});
