// Every test here is about a claim printed on a document signed under
// penalty of perjury, so each one states the wrong behaviour it exists to
// catch. All were verified by putting that wrong behaviour back and
// watching the named test go red -- see the mutation log in the PR.

import { describe, expect, it } from "vitest";
import {
  buildWh347,
  cashWagesFor,
  fringeCreditFor,
  wh347Days,
  WH347_DAY_COUNT,
  type Wh347TimeEntryInput,
} from "./wh347";
import type { FringeRateScheduleInput } from "./labor-cost";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Sunday 2026-08-23 through Saturday 2026-08-29. The same week
// certified-payroll-week.test.ts uses, so a reader comparing the two is
// not also translating dates.
const WEEK_START = utc("2026-08-23");

const CARPENTER: FringeRateScheduleInput = {
  baseWage: 40,
  pensionRate: 5,
  vacationRate: 2,
  healthWelfareRate: 3,
  trainingRate: 1, // fringe = 11/hr
  effectiveFrom: utc("2026-01-01"),
  effectiveTo: null,
};

const schedules = new Map([["craft-carp", [CARPENTER]]]);

const COMPANY = {
  name: "Ridgeline Drywall Inc",
  dbaName: null,
  hqAddressLine1: "1400 Foundry Rd",
  hqAddressLine2: null,
  hqCity: "Sacramento",
  hqState: "CA",
  hqZip: "95814",
};

const JOB = { name: "Maple Street Medical Office" };

function entry(over: Partial<Wh347TimeEntryInput> = {}): Wh347TimeEntryInput {
  return {
    employeeUserId: "u1",
    employee: { name: "Rosa Delgado", email: "rosa@ridgeline.test" },
    craftClassificationId: "craft-carp",
    craftLabel: "Carpenter, Journeyman",
    date: utc("2026-08-24"),
    hours: 8,
    payType: "STRAIGHT",
    ...over,
  };
}

function build(entries: Wh347TimeEntryInput[], extra: Record<string, unknown> = {}) {
  return buildWh347({
    company: COMPANY,
    job: JOB,
    weekStart: WEEK_START,
    entries,
    fringeSchedulesByCraft: schedules,
    ...extra,
  });
}

describe("the seven dated columns", () => {
  it("is exactly seven days, Sunday first, Saturday last", () => {
    const days = wh347Days(WEEK_START);
    expect(days).toHaveLength(WH347_DAY_COUNT);
    expect(days[0].toISOString()).toBe("2026-08-23T00:00:00.000Z");
    expect(days[6].toISOString()).toBe("2026-08-29T00:00:00.000Z");
    expect(days[0].getUTCDay()).toBe(0);
    expect(days[6].getUTCDay()).toBe(6);
  });

  it("takes its window from certifiedPayrollWeekWindow, so a mid-week date still yields that week", () => {
    // Guards the eight-day scar: consecutive weeks must not share a day.
    const fromWednesday = wh347Days(utc("2026-08-26"));
    expect(fromWednesday[0].toISOString()).toBe(wh347Days(WEEK_START)[0].toISOString());
    const next = wh347Days(utc("2026-08-30"));
    expect(next[0].getTime()).toBeGreaterThan(fromWednesday[6].getTime());
  });

  it("prints a day with no hours BLANK, never zero — a zero claims they worked none", () => {
    const form = build([entry({ date: utc("2026-08-24"), hours: 8 })]);
    const row = form.workers[0].hoursRows[0];
    expect(row.days[1].hours).toBe(8); // Monday
    expect(row.days[0].hours).toBeNull(); // Sunday — absent, not zero
    expect(row.days.filter((d) => d.hours === 0)).toHaveLength(0);
  });

  it("places each entry under its own date rather than collapsing the week", () => {
    const form = build([
      entry({ date: utc("2026-08-24"), hours: 8 }),
      entry({ date: utc("2026-08-25"), hours: 6 }),
      entry({ date: utc("2026-08-28"), hours: 4 }),
    ]);
    const row = form.workers[0].hoursRows[0];
    expect(row.days.map((d) => d.hours)).toEqual([null, 8, 6, null, null, 4, null]);
  });

  it("sums two entries landing on the same day into one cell", () => {
    const form = build([
      entry({ date: utc("2026-08-24"), hours: 5 }),
      entry({ date: utc("2026-08-24"), hours: 3 }),
    ]);
    expect(form.workers[0].hoursRows[0].days[1].hours).toBe(8);
    expect(form.workers[0].totalHours).toBe(8);
  });
});

describe("pay types get their own rows", () => {
  it("does NOT fold double time into overtime — that misstates the rate on a signed form", () => {
    const form = build([
      entry({ hours: 8, payType: "STRAIGHT" }),
      entry({ hours: 2, payType: "OVERTIME" }),
      entry({ hours: 3, payType: "DOUBLE_TIME" }),
    ]);
    const labels = form.workers[0].hoursRows.map((r) => r.label);
    expect(labels).toEqual(["O", "S", "DT"]);
    const dt = form.workers[0].hoursRows.find((r) => r.label === "DT");
    expect(dt?.totalHours).toBe(3);
    const ot = form.workers[0].hoursRows.find((r) => r.label === "O");
    expect(ot?.totalHours).toBe(2); // not 5
  });

  it("prints O above S, the pre-printed form's own order", () => {
    const form = build([
      entry({ hours: 8, payType: "STRAIGHT" }),
      entry({ hours: 2, payType: "OVERTIME" }),
    ]);
    expect(form.workers[0].hoursRows.map((r) => r.label)).toEqual(["O", "S"]);
  });

  it("emits no row for a pay type nobody worked", () => {
    const form = build([entry({ payType: "STRAIGHT" })]);
    expect(form.workers[0].hoursRows).toHaveLength(1);
  });
});

describe("the hours add up", () => {
  it("row total equals the sum of its seven cells, and worker total equals the sum of its rows", () => {
    const form = build([
      entry({ date: utc("2026-08-24"), hours: 8, payType: "STRAIGHT" }),
      entry({ date: utc("2026-08-25"), hours: 8, payType: "STRAIGHT" }),
      entry({ date: utc("2026-08-25"), hours: 2, payType: "OVERTIME" }),
    ]);
    const worker = form.workers[0];
    for (const row of worker.hoursRows) {
      const cellSum = row.days.reduce((s, d) => s + (d.hours ?? 0), 0);
      expect(cellSum).toBe(row.totalHours);
    }
    expect(worker.hoursRows.reduce((s, r) => s + r.totalHours, 0)).toBe(worker.totalHours);
    expect(worker.totalHours).toBe(18);
    expect(form.totalHours).toBe(18);
  });
});

describe("column 7 is CASH wages and excludes fringe", () => {
  it("gross is base times multiplier times hours, with no fringe added", () => {
    // 8 straight at base 40 = 320. Fringe (11/hr) must NOT appear here.
    const form = build([entry({ hours: 8, payType: "STRAIGHT" })]);
    expect(form.workers[0].grossEarnedThisProject).toBe(320);
    expect(form.workers[0].fringeCredited).toBe(88);
  });

  it("overstating gross by the fringe package is exactly what this guards", () => {
    const form = build([entry({ hours: 8, payType: "STRAIGHT" })]);
    // The burdened figure job costing uses would be 8 * (40 + 11) = 408.
    expect(form.workers[0].grossEarnedThisProject).not.toBe(408);
  });

  it("applies the overtime multiplier to base only, never to fringe", () => {
    // 2 OT: cash = 2 * 40 * 1.5 = 120. Fringe = 2 * 11 = 22, NOT 33.
    const form = build([entry({ hours: 2, payType: "OVERTIME" })]);
    expect(form.workers[0].grossEarnedThisProject).toBe(120);
    expect(form.workers[0].fringeCredited).toBe(22);
  });

  it("doubles base for double time", () => {
    const form = build([entry({ hours: 4, payType: "DOUBLE_TIME" })]);
    expect(form.workers[0].grossEarnedThisProject).toBe(320);
  });

  it("reports base rate and fringe per hour separately, because 4(a) turns on the split", () => {
    const form = build([entry()]);
    expect(form.workers[0].baseHourlyRate).toBe(40);
    expect(form.workers[0].fringePerHour).toBe(11);
  });

  it("cashWagesFor and fringeCreditFor return null with no schedule rather than guessing", () => {
    expect(cashWagesFor(8, "STRAIGHT", null)).toBeNull();
    expect(fringeCreditFor(8, null)).toBeNull();
  });
});

describe("it never invents a number", () => {
  it("nulls the whole line's money when ANY day has no effective schedule", () => {
    const lapsed: FringeRateScheduleInput = { ...CARPENTER, effectiveTo: utc("2026-08-24") };
    const form = buildWh347({
      company: COMPANY,
      job: JOB,
      weekStart: WEEK_START,
      entries: [
        entry({ date: utc("2026-08-24"), hours: 8 }), // covered
        entry({ date: utc("2026-08-26"), hours: 8 }), // after effectiveTo
      ],
      fringeSchedulesByCraft: new Map([["craft-carp", [lapsed]]]),
    });
    // A partial gross reads as a complete one, so there is no partial.
    expect(form.workers[0].grossEarnedThisProject).toBeNull();
    expect(form.workers[0].baseHourlyRate).toBeNull();
    expect(form.workers[0].blocking).toContain("rateOfPay");
    expect(form.workers[0].blocking).toContain("grossEarned");
    // The hours themselves are still reported — they were worked.
    expect(form.workers[0].totalHours).toBe(16);
  });

  it("never prints an email in the name column", () => {
    const form = build([entry({ employee: { name: null, email: "rosa@ridgeline.test" } })]);
    expect(form.workers[0].name).toBe("Name not recorded");
    expect(form.workers[0].name).not.toContain("@");
    expect(form.workers[0].blocking).toContain("workerName");
  });

  it("names untagged hours rather than leaving column 3 to be guessed", () => {
    const form = build([entry({ craftClassificationId: null, craftLabel: null })]);
    expect(form.workers[0].classification).toBe("Not tagged");
    expect(form.workers[0].blocking).toContain("classification");
  });

  it("reports deductions and net wages as blocking, never as zero", () => {
    const form = build([entry()]);
    expect(form.workers[0].deductions).toBeNull();
    expect(form.workers[0].netWagesThisWeek).toBeNull();
    expect(form.workers[0].blocking).toContain("deductions");
    expect(form.workers[0].blocking).toContain("netWages");
  });
});

describe("one line per worker per classification", () => {
  it("splits a worker who ran two crafts, because the rate follows the classification", () => {
    const form = build([
      entry({ craftClassificationId: "craft-carp", craftLabel: "Carpenter, Journeyman" }),
      entry({ craftClassificationId: "craft-lath", craftLabel: "Lather", hours: 4 }),
    ]);
    expect(form.workers).toHaveLength(2);
    expect(form.workers.map((w) => w.classification).sort()).toEqual(["Carpenter, Journeyman", "Lather"]);
  });

  it("keeps one line for one worker on one craft across several days", () => {
    const form = build([
      entry({ date: utc("2026-08-24") }),
      entry({ date: utc("2026-08-25") }),
    ]);
    expect(form.workers).toHaveLength(1);
  });

  it("sorts by worker name so the same crew prints in the same order every week", () => {
    const form = build([
      entry({ employeeUserId: "u2", employee: { name: "Zeke Warren", email: "z@x.test" } }),
      entry({ employeeUserId: "u1", employee: { name: "Ana Boyd", email: "a@x.test" } }),
    ]);
    expect(form.workers.map((w) => w.name)).toEqual(["Ana Boyd", "Zeke Warren"]);
  });
});

describe("the header", () => {
  it("takes the contractor address off the company record", () => {
    const form = build([entry()]);
    expect(form.header.contractorName).toBe("Ridgeline Drywall Inc");
    expect(form.header.contractorAddress).toBe("1400 Foundry Rd, Sacramento, CA 95814");
  });

  it("prefers the DBA name, because that is the name on the contract", () => {
    const form = buildWh347({
      company: { ...COMPANY, dbaName: "Ridgeline Interiors" },
      job: JOB,
      weekStart: WEEK_START,
      entries: [entry()],
      fringeSchedulesByCraft: schedules,
    });
    expect(form.header.contractorName).toBe("Ridgeline Interiors");
  });

  it("week ending is the SATURDAY, which is what the form asks for", () => {
    const form = build([entry()]);
    expect(form.header.weekEnding.toISOString()).toBe("2026-08-29T00:00:00.000Z");
  });

  it("reports a missing address as null rather than an empty string of commas", () => {
    const form = buildWh347({
      company: { name: "X", dbaName: null, hqAddressLine1: null, hqAddressLine2: null, hqCity: null, hqState: null, hqZip: null },
      job: JOB,
      weekStart: WEEK_START,
      entries: [entry()],
      fringeSchedulesByCraft: schedules,
    });
    expect(form.header.contractorAddress).toBeNull();
  });
});

describe("fileable", () => {
  it("is false while anything is blocking — a form you cannot complete must not look ready to sign", () => {
    const form = build([entry()]);
    expect(form.fileable).toBe(false);
    expect(form.blocking.length).toBeGreaterThan(0);
  });

  it("blocks on the statement of compliance until page 2 is signed for THIS week", () => {
    // This used to be added unconditionally, because page 2 did not exist.
    // The defect it now guards is the opposite one: a form that reports
    // itself ready to file with nobody's signature on page 2.
    expect(build([entry()]).blocking).toContain("statementOfCompliance");
    expect(
      build([entry()], { statementOfComplianceSignedOn: utc("2026-08-31") }).blocking,
    ).not.toContain("statementOfCompliance");
  });

  it("reports the signature date it was given, so the page can print it", () => {
    expect(build([entry()]).statementOfComplianceSignedOn).toBeNull();
    expect(
      build([entry()], { statementOfComplianceSignedOn: utc("2026-08-31") })
        ?.statementOfComplianceSignedOn?.toISOString(),
    ).toBe("2026-08-31T00:00:00.000Z");
  });

  it("is fileable once every field is sourced — the whole point of the two structural blockers", () => {
    // The control for every "is false while anything is blocking" case
    // above. Without it they are all satisfied by a function that returns
    // fileable: false unconditionally, which is what this module did until
    // page 2 and the payroll counter existed.
    const form = buildWh347({
      company: COMPANY,
      job: {
        name: "Maple Street Medical Office",
        location: "1200 Maple St, Sacramento CA",
        contractNumber: "SAC-2026-0041",
      },
      weekStart: WEEK_START,
      entries: [],
      fringeSchedulesByCraft: schedules,
      payrollNumber: 12,
      statementOfComplianceSignedOn: utc("2026-08-31"),
    });
    // No workers, so none of the per-worker blockers (identifying number,
    // deductions, net wages) apply — a "no work performed" payroll, which
    // is a real filing an agency expects for every week of a contract.
    expect(form.blocking).toEqual([]);
    expect(form.fileable).toBe(true);
  });

  it("blocks on the payroll number until a counter issues one", () => {
    expect(build([entry()]).blocking).toContain("payrollNumber");
    expect(build([entry()], { payrollNumber: 4 }).blocking).not.toContain("payrollNumber");
    expect(build([entry()], { payrollNumber: 4 }).header.payrollNumber).toBe(4);
  });

  it("blocks on project location and contract number, which a Job does not record", () => {
    const form = build([entry()]);
    expect(form.blocking).toContain("projectLocation");
    expect(form.blocking).toContain("contractNumber");
  });

  it("deduplicates blocking fields across workers and reports them in a stable order", () => {
    const form = build([
      entry({ employeeUserId: "u1", employee: { name: null, email: "a@x.test" } }),
      entry({ employeeUserId: "u2", employee: { name: null, email: "b@x.test" } }),
    ]);
    expect(form.blocking.filter((f) => f === "workerName")).toHaveLength(1);
    expect(form.blocking.indexOf("payrollNumber")).toBeLessThan(form.blocking.indexOf("workerName"));
  });
});

describe("hours outside the week", () => {
  it("does not place an entry from another week into a column", () => {
    const form = build([
      entry({ date: utc("2026-08-24"), hours: 8 }),
      entry({ date: utc("2026-09-02"), hours: 8 }), // next week entirely
    ]);
    expect(form.totalHours).toBe(8);
    expect(form.workers[0].hoursRows[0].days.reduce((s, d) => s + (d.hours ?? 0), 0)).toBe(8);
  });
});

describe("an empty week", () => {
  it("returns a form with no workers rather than throwing", () => {
    const form = build([]);
    expect(form.workers).toEqual([]);
    expect(form.totalHours).toBe(0);
    expect(form.days).toHaveLength(WH347_DAY_COUNT);
    expect(form.fileable).toBe(false);
  });
});
