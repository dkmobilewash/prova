import { describe, expect, it } from "vitest";
import { buildRemittanceReport, periodIsFiled, type RemittanceEntryInput } from "./fringe-remittance";
import type { FringeRateScheduleInput } from "./labor-cost";

const schedule = (over: Partial<FringeRateScheduleInput> = {}): FringeRateScheduleInput => ({
  baseWage: 45,
  pensionRate: 8,
  vacationRate: 3,
  healthWelfareRate: 11,
  trainingRate: 1,
  effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
  effectiveTo: null,
  ...over,
});

const entry = (over: Partial<RemittanceEntryInput> = {}): RemittanceEntryInput => ({
  date: new Date(Date.UTC(2026, 7, 17)),
  hours: 8,
  craftClassificationId: "craft_j",
  craftLabel: "Journeyman",
  unionLocalId: "local_1",
  unionLocalLabel: "Local 300",
  employeeName: "A Worker",
  jobName: "Courthouse",
  ...over,
});

const schedules = new Map([["craft_j", [schedule()]]]);

describe("buildRemittanceReport", () => {
  it("breaks the money out by fund, because that is how the form is filled in", () => {
    const report = buildRemittanceReport([entry()], schedules, "2026-08-01", "2026-08-31");
    const local = report.locals[0];
    expect(local.components).toEqual({ pension: 64, vacation: 24, healthWelfare: 88, training: 8 });
    expect(local.total).toBe(184);
    expect(report.total).toBe(184);
    expect(report.totalHours).toBe(8);
  });

  it("pays fringe at the flat rate on an overtime hour", () => {
    // Davis-Bacon convention, already followed by lib/labor-cost.ts:
    // overtime multiplies the BASE wage only. Getting this wrong would
    // overstate every remittance in a month containing overtime.
    const straight = buildRemittanceReport([entry()], schedules, "2026-08-01", "2026-08-31");
    const overtime = buildRemittanceReport([entry()], schedules, "2026-08-01", "2026-08-31");
    expect(overtime.total).toBe(straight.total);
  });

  it("groups by local, then by classification", () => {
    const report = buildRemittanceReport(
      [
        entry(),
        entry({ craftClassificationId: "craft_a", craftLabel: "Apprentice", hours: 4 }),
        entry({ unionLocalId: "local_2", unionLocalLabel: "Local 12" }),
      ],
      new Map([
        ["craft_j", [schedule()]],
        ["craft_a", [schedule({ pensionRate: 4, vacationRate: 1, healthWelfareRate: 11, trainingRate: 1 })]],
      ]),
      "2026-08-01",
      "2026-08-31",
    );
    expect(report.locals.map((l) => l.unionLocalLabel)).toEqual(["Local 12", "Local 300"]);
    const local300 = report.locals.find((l) => l.unionLocalLabel === "Local 300");
    expect(local300?.crafts.map((c) => c.craftLabel)).toEqual(["Apprentice", "Journeyman"]);
    expect(local300?.hours).toBe(12);
  });

  it("uses the rate in force on the entry's own date", () => {
    const dated = new Map([
      [
        "craft_j",
        [
          schedule({
            pensionRate: 5,
            vacationRate: 0,
            healthWelfareRate: 0,
            trainingRate: 0,
            effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
            effectiveTo: new Date(Date.UTC(2026, 5, 30)),
          }),
          schedule({
            pensionRate: 9,
            vacationRate: 0,
            healthWelfareRate: 0,
            trainingRate: 0,
            effectiveFrom: new Date(Date.UTC(2026, 6, 1)),
          }),
        ],
      ],
    ]);
    const june = buildRemittanceReport(
      [entry({ date: new Date(Date.UTC(2026, 5, 15)) })],
      dated,
      "2026-06-01",
      "2026-06-30",
    );
    const august = buildRemittanceReport([entry()], dated, "2026-08-01", "2026-08-31");
    expect(june.total).toBe(40);
    expect(august.total).toBe(72);
  });

  it("counts hours it cannot price instead of valuing them at zero", () => {
    // Under-reporting a liability to a trust fund is the expensive
    // direction to be wrong in.
    const report = buildRemittanceReport(
      [entry(), entry({ craftClassificationId: null, craftLabel: null, employeeName: "Untagged" })],
      schedules,
      "2026-08-01",
      "2026-08-31",
    );
    expect(report.totalHours).toBe(16);
    expect(report.uncomputedHours).toBe(8);
    expect(report.uncomputedNames).toEqual(["Untagged"]);
    expect(report.total).toBe(184);
  });

  it("keeps unpriceable hours on the right local's filing", () => {
    // No schedule effective on the date, but we know the local and the
    // classification — the hours belong on that filing even though the
    // money cannot be computed.
    const report = buildRemittanceReport(
      [entry({ date: new Date(Date.UTC(2025, 5, 1)) })],
      schedules,
      "2025-06-01",
      "2025-06-30",
    );
    expect(report.locals).toHaveLength(1);
    expect(report.locals[0].hours).toBe(8);
    expect(report.locals[0].uncomputedHours).toBe(8);
    expect(report.locals[0].total).toBe(0);
    expect(report.uncomputedHours).toBe(8);
  });

  it("treats a missing component rate as nothing owed to that fund", () => {
    const report = buildRemittanceReport(
      [entry()],
      new Map([["craft_j", [schedule({ trainingRate: null, vacationRate: null })]]]),
      "2026-08-01",
      "2026-08-31",
    );
    expect(report.locals[0].components).toMatchObject({ training: 0, vacation: 0, pension: 64 });
  });

  it("has nothing to report for an empty period", () => {
    const report = buildRemittanceReport([], schedules, "2026-08-01", "2026-08-31");
    expect(report).toMatchObject({ locals: [], total: 0, totalHours: 0, uncomputedHours: 0 });
  });
});

describe("periodIsFiled", () => {
  it("needs a filing that covers the whole period", () => {
    expect(
      periodIsFiled([{ periodStart: "2026-08-01", periodEnd: "2026-08-31" }], "2026-08-01", "2026-08-31"),
    ).toBe(true);
  });

  it("does not accept a filing that merely overlaps", () => {
    // A partial filing hides a real gap — the same rule the
    // certified-payroll alert applies to a week.
    expect(
      periodIsFiled([{ periodStart: "2026-08-10", periodEnd: "2026-08-20" }], "2026-08-01", "2026-08-31"),
    ).toBe(false);
  });

  it("ignores a filing with no period recorded", () => {
    expect(periodIsFiled([{ periodStart: null, periodEnd: null }], "2026-08-01", "2026-08-31")).toBe(false);
  });
});
