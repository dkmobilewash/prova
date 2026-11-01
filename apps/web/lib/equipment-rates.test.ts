import { describe, expect, it } from "vitest";
import { overlapProblem, ratesOn, rateStanding, type EquipmentRateRow } from "./equipment-rates";

const rate = (over: Partial<EquipmentRateRow>): EquipmentRateRow => ({
  id: "r", name: "Scissor lift", unit: "DAY", rate: 450, effectiveFrom: "2026-01-01", effectiveTo: null, notes: null, ...over,
});

describe("the rates on a day", () => {
  const rows = [
    rate({ id: "old", effectiveTo: "2026-06-30", rate: 400 }),
    rate({ id: "new", effectiveFrom: "2026-07-01", rate: 450 }),
    rate({ id: "week", unit: "WEEK", rate: 1500 }),
    rate({ id: "boom", name: "Boom lift", unit: "HOUR", rate: 90, effectiveFrom: "2027-01-01" }),
  ];

  it("takes the rate in force on the work date, not today's", () => {
    expect(ratesOn(rows, "2026-05-01").map((row) => row.id)).toEqual(["old", "week"]);
    expect(ratesOn(rows, "2026-07-01").map((row) => row.id)).toEqual(["new", "week"]);
  });

  it("counts both end days", () => {
    expect(ratesOn(rows, "2026-06-30").map((row) => row.id)).toContain("old");
  });

  it("leaves out a rate not yet started", () => {
    expect(ratesOn(rows, "2026-12-31").map((row) => row.id)).not.toContain("boom");
  });
});

describe("standing", () => {
  it("says where a rate stands against today", () => {
    expect(rateStanding(rate({}), "2026-11-01")).toBe("in force");
    expect(rateStanding(rate({ effectiveFrom: "2027-01-01" }), "2026-11-01")).toBe("not yet in effect");
    expect(rateStanding(rate({ effectiveTo: "2026-10-31" }), "2026-11-01")).toBe("ended");
  });
});

describe("overlaps", () => {
  const open = rate({ id: "a" });

  it("refuses two prices for one machine on one day, whatever the spelling", () => {
    expect(overlapProblem(rate({ id: "b", name: " scissor LIFT ", effectiveFrom: "2026-06-01" }), [open])).toContain("already has a day rate");
  });

  it("allows another unit, another machine, a later span, and the rate itself", () => {
    expect(overlapProblem(rate({ id: "b", unit: "WEEK" }), [open])).toBeNull();
    expect(overlapProblem(rate({ id: "b", name: "Boom lift" }), [open])).toBeNull();
    expect(overlapProblem(rate({ id: "b", effectiveFrom: "2026-07-01" }), [rate({ id: "a", effectiveTo: "2026-06-30" })])).toBeNull();
    expect(overlapProblem(open, [open])).toBeNull();
  });
});
