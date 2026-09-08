import { describe, expect, it } from "vitest";
import {
  allocateToCents,
  buildRemittanceReport,
  isWhollyUnpriced,
  periodIsFiled,
  remittanceReconciliationErrors,
  type RemittanceCraftRow,
  type RemittanceEntryInput,
} from "./fringe-remittance";
import type { FringeRateScheduleInput } from "./labor-cost";
import { NAME_NOT_RECORDED, payrollWorkerName } from "./worker-name";

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
  payType: "STRAIGHT",
  craftClassificationId: "craft_j",
  craftLabel: "Journeyman",
  unionLocalId: "local_1",
  unionLocalLabel: "Local 300",
  employeeUserId: "user_a",
  employeeFilingName: payrollWorkerName({ name: "A Worker", email: "a@example.com" }),
  employeeName: "A Worker",
  jobName: "Courthouse",
  ...over,
});

/** A member, named the way a filing names them. Takes the id and the
 * account name together so a test cannot accidentally give two people the
 * same id, which is the mistake that would make a merge look correct. */
const member = (employeeUserId: string, name: string | null) => ({
  employeeUserId,
  employeeFilingName: payrollWorkerName({ name, email: `${employeeUserId}@example.com` }),
  employeeName: name ?? `${employeeUserId}@example.com`,
});

const craftOf = (
  report: ReturnType<typeof buildRemittanceReport>,
  localLabel: string,
  craftLabel: string,
): RemittanceCraftRow => {
  const row = report.locals
    .find((l) => l.unionLocalLabel === localLabel)
    ?.crafts.find((c) => c.craftLabel === craftLabel);
  if (!row) throw new Error(`no ${localLabel} / ${craftLabel} row in the report`);
  return row;
};

const cents = (value: number) => Math.round(value * 100);

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
    //
    // THIS TEST USED TO BE VACUOUS. It called buildRemittanceReport twice
    // with byte-identical arguments and asserted the two answers matched,
    // which they do under every implementation ever written, including one
    // that multiplies fringe by 1.5. `payType` was not on the input at
    // all, so there was nothing for a wrong implementation to read. The
    // entries below now differ in exactly one field.
    const straight = buildRemittanceReport([entry({ payType: "STRAIGHT" })], schedules, "2026-08-01", "2026-08-31");
    const overtime = buildRemittanceReport([entry({ payType: "OVERTIME" })], schedules, "2026-08-01", "2026-08-31");
    const doubled = buildRemittanceReport([entry({ payType: "DOUBLE_TIME" })], schedules, "2026-08-01", "2026-08-31");

    expect(straight.total).toBe(184);
    expect(overtime.total).toBe(184);
    expect(doubled.total).toBe(184);
    // Down to the member line, which is what a fund actually credits.
    expect(craftOf(overtime, "Local 300", "Journeyman").employees[0].total).toBe(184);
    expect(craftOf(overtime, "Local 300", "Journeyman").employees[0].components).toEqual(
      craftOf(straight, "Local 300", "Journeyman").employees[0].components,
    );
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

describe("per-member remittance lines", () => {
  // A trust fund credits hours to an INDIVIDUAL member's account —
  // pension vesting and health & welfare eligibility both turn on how
  // many hours one person worked in the period. A report that stops at
  // "Local 300, Journeyman, 480 hours, $10,368" cannot be filed, because
  // the fund has nobody to credit.

  it("credits each priced hour to a named member", () => {
    const report = buildRemittanceReport(
      [
        entry({ ...member("user_ana", "Ana Ruiz"), hours: 8 }),
        entry({ ...member("user_bo", "Bo Chen"), hours: 4 }),
      ],
      schedules,
      "2026-08-01",
      "2026-08-31",
    );
    const craft = craftOf(report, "Local 300", "Journeyman");
    expect(craft.employees.map((e) => [e.employeeName, e.hours, e.total])).toEqual([
      ["Ana Ruiz", 8, 184],
      ["Bo Chen", 4, 92],
    ]);
    expect(craft.employees[0].components).toEqual({
      pension: 64,
      vacation: 24,
      healthWelfare: 88,
      training: 8,
    });
  });

  it("keeps one member's two classifications as two lines at the two rates that applied", () => {
    // The rates differ, the fund needs both, and a blended per-hour rate
    // is a number that appears in no agreement. Collapsing these into one
    // line for Ana would state a rate nobody agreed to.
    const report = buildRemittanceReport(
      [
        entry({ ...member("user_ana", "Ana Ruiz"), hours: 8 }),
        entry({
          ...member("user_ana", "Ana Ruiz"),
          hours: 6,
          craftClassificationId: "craft_a",
          craftLabel: "Apprentice",
        }),
      ],
      new Map([
        ["craft_j", [schedule()]],
        ["craft_a", [schedule({ pensionRate: 4, vacationRate: 1, healthWelfareRate: 11, trainingRate: 1 })]],
      ]),
      "2026-08-01",
      "2026-08-31",
    );

    const apprentice = craftOf(report, "Local 300", "Apprentice");
    const journeyman = craftOf(report, "Local 300", "Journeyman");
    expect(apprentice.employees).toHaveLength(1);
    expect(journeyman.employees).toHaveLength(1);

    // Same person, two lines, two rates: 6h at $17/h and 8h at $23/h.
    expect(apprentice.employees[0]).toMatchObject({ employeeUserId: "user_ana", hours: 6, total: 102 });
    expect(journeyman.employees[0]).toMatchObject({ employeeUserId: "user_ana", hours: 8, total: 184 });

    // And nowhere in the report is there a single 14-hour line for her,
    // which is what a collapse would produce.
    const everyLine = report.locals.flatMap((l) => l.crafts.flatMap((c) => c.employees));
    expect(everyLine).toHaveLength(2);
    expect(everyLine.some((line) => line.hours === 14)).toBe(false);
  });

  it("never merges two members who both have no name recorded", () => {
    // Two accounts with no name are two people with two fund accounts.
    // Keying the member dimension on the printed label would merge them
    // into one line crediting one of them with the other's hours — and
    // both lines read "Name not recorded", so nobody would spot it.
    const report = buildRemittanceReport(
      [
        entry({ ...member("user_x", null), hours: 8 }),
        entry({ ...member("user_y", null), hours: 3 }),
      ],
      schedules,
      "2026-08-01",
      "2026-08-31",
    );
    const craft = craftOf(report, "Local 300", "Journeyman");
    expect(craft.employees).toHaveLength(2);
    expect(craft.employees.map((e) => e.employeeUserId).sort()).toEqual(["user_x", "user_y"]);
    expect(craft.employees.map((e) => e.employeeName)).toEqual([NAME_NOT_RECORDED, NAME_NOT_RECORDED]);
    expect(craft.employees.every((e) => e.nameMissing)).toBe(true);
    expect(craft.employees.map((e) => e.hours).sort((a, b) => a - b)).toEqual([3, 8]);
  });

  it("prints a placeholder rather than an email when no name is recorded", () => {
    // The name column on a remittance is a statement to a trust fund
    // about who did the work. An email address is not that person's name.
    const report = buildRemittanceReport(
      [entry({ ...member("user_x", null) })],
      schedules,
      "2026-08-01",
      "2026-08-31",
    );
    const line = craftOf(report, "Local 300", "Journeyman").employees[0];
    expect(line.employeeName).toBe(NAME_NOT_RECORDED);
    expect(line.employeeName).not.toContain("@");
    expect(line.nameMissing).toBe(true);
  });

  it("marks a member with no priced hours as unpriced rather than as nothing owed", () => {
    // $0.00 across five fund columns is a statement that nothing is owed
    // for this person. What is true is that nobody has priced them. The
    // member row therefore satisfies isWhollyUnpriced so the document can
    // say so, exactly as the craft row already does.
    const report = buildRemittanceReport(
      [
        // Priced: a schedule is effective in August.
        entry({ ...member("user_ana", "Ana Ruiz"), hours: 8 }),
        // Not priced: no schedule was effective in 2025, same craft.
        entry({ ...member("user_bo", "Bo Chen"), hours: 5, date: new Date(Date.UTC(2025, 5, 1)) }),
      ],
      schedules,
      "2026-08-01",
      "2026-08-31",
    );
    const craft = craftOf(report, "Local 300", "Journeyman");
    const [ana, bo] = craft.employees;

    expect(bo.employeeName).toBe("Bo Chen");
    expect(bo.hours).toBe(5);
    expect(bo.uncomputedHours).toBe(5);
    expect(isWhollyUnpriced(bo)).toBe(true);

    expect(ana.uncomputedHours).toBe(0);
    expect(isWhollyUnpriced(ana)).toBe(false);

    // The craft row is only PARTLY unpriced, so it keeps its money — and
    // that money is entirely Ana's. Bo's unpriced hours must not have
    // absorbed a rounding cent from her.
    expect(isWhollyUnpriced(craft)).toBe(false);
    expect(bo.total).toBe(0);
    expect(ana.total).toBe(craft.total);
    expect(remittanceReconciliationErrors(report)).toEqual([]);
  });

  it("member lines add up to their classification line, to the cent", () => {
    // The reconciliation the whole document rests on: a remittance whose
    // lines do not add to its own total is bounced by the fund's clerk
    // before anyone looks at the money. Deliberately awkward hours and
    // rates, three members, two classifications, two locals.
    const rates = new Map([
      ["craft_j", [schedule({ pensionRate: 8.33, vacationRate: 2.17, healthWelfareRate: 11.05, trainingRate: 0.41 })]],
      ["craft_a", [schedule({ pensionRate: 4.11, vacationRate: 1.03, healthWelfareRate: 11.05, trainingRate: 0.41 })]],
    ]);
    const report = buildRemittanceReport(
      [
        entry({ ...member("user_ana", "Ana Ruiz"), hours: 7.25 }),
        entry({ ...member("user_bo", "Bo Chen"), hours: 2.5 }),
        entry({ ...member("user_cy", "Cy Okafor"), hours: 6.75 }),
        entry({ ...member("user_ana", "Ana Ruiz"), hours: 3.5, craftClassificationId: "craft_a", craftLabel: "Apprentice" }),
        entry({ ...member("user_bo", "Bo Chen"), hours: 1.25, craftClassificationId: "craft_a", craftLabel: "Apprentice" }),
        entry({
          ...member("user_cy", "Cy Okafor"),
          hours: 4.25,
          unionLocalId: "local_2",
          unionLocalLabel: "Local 12",
        }),
      ],
      rates,
      "2026-08-01",
      "2026-08-31",
    );

    expect(remittanceReconciliationErrors(report)).toEqual([]);

    // Asserted independently of that helper too, so a helper that stopped
    // checking anything could not carry this test.
    let linesSeen = 0;
    for (const local of report.locals) {
      for (const craft of local.crafts) {
        linesSeen += craft.employees.length;
        const total = (pick: (row: (typeof craft.employees)[number]) => number) =>
          cents(craft.employees.reduce((running, row) => running + pick(row), 0));
        expect(total((r) => r.hours)).toBe(cents(craft.hours));
        expect(total((r) => r.uncomputedHours)).toBe(cents(craft.uncomputedHours));
        expect(total((r) => r.components.pension)).toBe(cents(craft.components.pension));
        expect(total((r) => r.components.vacation)).toBe(cents(craft.components.vacation));
        expect(total((r) => r.components.healthWelfare)).toBe(cents(craft.components.healthWelfare));
        expect(total((r) => r.components.training)).toBe(cents(craft.components.training));
        expect(total((r) => r.total)).toBe(cents(craft.total));
      }
      // And the classification lines add to the local's printed total.
      expect(cents(local.crafts.reduce((running, c) => running + c.total, 0))).toBe(cents(local.total));
      expect(cents(local.crafts.reduce((running, c) => running + c.hours, 0))).toBe(cents(local.hours));
    }
    // Six member lines: three journeymen and two apprentices on Local
    // 300, one journeyman on Local 12. Ana and Bo each appear twice,
    // under two classifications, which is the point. If this came back 4
    // the two classifications collapsed into one line per member; if 8,
    // an entry opened a second line for somebody who already had one.
    expect(linesSeen).toBe(6);
  });

  it("splits an awkward cent instead of inventing or losing one", () => {
    // 2.5 hours at $8.33 is exactly $20.825 each. Rounding both members
    // independently gives $20.83 + $20.83 = $41.66, one cent more than
    // the $41.65 the classification line prints and the company owes.
    // Largest remainder gives the odd cent to exactly one of them.
    const report = buildRemittanceReport(
      [
        entry({ ...member("user_ana", "Ana Ruiz"), hours: 2.5 }),
        entry({ ...member("user_bo", "Bo Chen"), hours: 2.5 }),
      ],
      new Map([
        ["craft_j", [schedule({ pensionRate: 8.33, vacationRate: 0, healthWelfareRate: 0, trainingRate: 0 })]],
      ]),
      "2026-08-01",
      "2026-08-31",
    );
    const craft = craftOf(report, "Local 300", "Journeyman");
    expect(craft.components.pension).toBe(41.65);
    expect(craft.employees.map((e) => e.components.pension)).toEqual([20.83, 20.82]);
    expect(cents(20.83 + 20.82)).toBe(cents(craft.components.pension));
    expect(remittanceReconciliationErrors(report)).toEqual([]);
  });

  it("reports the discrepancy it finds rather than a bare false", () => {
    // The helper has to be able to FAIL, or the reconciliation tests above
    // are asserting against something that always returns []. This hands
    // it a hand-built row whose member line is a cent short.
    const broken = {
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      totalHours: 8,
      total: 184,
      uncomputedHours: 0,
      uncomputedNames: [],
      locals: [
        {
          unionLocalId: "local_1",
          unionLocalLabel: "Local 300",
          hours: 8,
          uncomputedHours: 0,
          components: { pension: 64, vacation: 24, healthWelfare: 88, training: 8 },
          total: 184,
          crafts: [
            {
              craftClassificationId: "craft_j",
              craftLabel: "Journeyman",
              hours: 8,
              uncomputedHours: 0,
              components: { pension: 64, vacation: 24, healthWelfare: 88, training: 8 },
              total: 184,
              employees: [
                {
                  employeeUserId: "user_ana",
                  employeeName: "Ana Ruiz",
                  nameMissing: false,
                  hours: 8,
                  uncomputedHours: 0,
                  components: { pension: 63.99, vacation: 24, healthWelfare: 88, training: 8 },
                  total: 183.99,
                },
              ],
            },
          ],
        },
      ],
    };
    const errors = remittanceReconciliationErrors(broken);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Local 300 / Journeyman");
    expect(errors[0]).toContain("pension");
    expect(errors[1]).toContain("total");
  });
});

describe("allocateToCents", () => {
  it("always sums to the target, whatever the shares round to on their own", () => {
    const cases: { shares: number[]; target: number }[] = [
      { shares: [20.825, 20.825], target: 4165 },
      { shares: [1 / 3, 1 / 3, 1 / 3], target: 100 },
      { shares: [0.004, 0.004, 0.004], target: 1 },
      { shares: [10, 0, 5], target: 1500 },
      { shares: [], target: 0 },
    ];
    for (const { shares, target } of cases) {
      const allocated = allocateToCents(shares, target);
      expect(allocated.reduce((running, value) => running + value, 0)).toBe(target);
      expect(allocated).toHaveLength(shares.length);
    }
  });

  it("never hands a residual cent to a share of zero", () => {
    // A member with no priced hours must not be credited a stray cent to
    // make somebody else's rounding work. Their line is unpriced, which
    // is a different statement from "one cent is owed".
    //
    // THE FIXTURE MATTERS AND THE OBVIOUS ONE IS VACUOUS. This test
    // originally asserted allocateToCents([0, 0.004, 0.004], 1) === [0,1,0]
    // and allocateToCents([0, 0], 0) === [0,0], and BOTH pass with the
    // zero-share guard deleted. A zero share has remainder 0, which the
    // largest-remainder comparator already sorts last, so with a residual
    // of 1 the guard is never consulted. It was offered as proof of the
    // guard and proved nothing.
    //
    // Discriminating requires residual > count of positive shares, so the
    // comparator runs out of positive candidates and the filter is the
    // only thing left standing between a zero share and a cent.
    expect(allocateToCents([0, 0.004], 2)).toEqual([0, 2]); // unguarded: [1, 1]
    expect(allocateToCents([0, 0, 0.004], 3)).toEqual([0, 0, 3]); // unguarded: [1, 1, 1]

    // Kept because they pin real behaviour, even though neither can fail
    // on this guard alone.
    expect(allocateToCents([0, 0.004, 0.004], 1)).toEqual([0, 1, 0]);
    expect(allocateToCents([0, 0], 0)).toEqual([0, 0]);
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

  // The two ONE-SIDED overlaps. Both halves of the rule have to hold, and
  // the fixture above satisfies neither of them — so it says nothing about
  // whether they are joined by AND or by OR. Flipping `&&` to `||` survived
  // the whole suite (issue #108), and a half-filed union period reporting as
  // filed is money the fund is owed and nobody chases.
  it("does not accept a filing that starts in time but ENDS EARLY", () => {
    // Covers the start of the month, stops on the 20th. The last eleven
    // days are unfiled.
    expect(
      periodIsFiled([{ periodStart: "2026-07-25", periodEnd: "2026-08-20" }], "2026-08-01", "2026-08-31"),
    ).toBe(false);
  });

  it("does not accept a filing that STARTS LATE but runs past the end", () => {
    // Mirror image: the first nine days are unfiled.
    expect(
      periodIsFiled([{ periodStart: "2026-08-10", periodEnd: "2026-09-05" }], "2026-08-01", "2026-08-31"),
    ).toBe(false);
  });

  it("accepts a filing that covers MORE than the period on both sides", () => {
    // The positive case that keeps the two halves from being tightened to
    // equality instead: a quarterly filing covers a month inside it.
    expect(
      periodIsFiled([{ periodStart: "2026-07-01", periodEnd: "2026-09-30" }], "2026-08-01", "2026-08-31"),
    ).toBe(true);
  });

  it("ignores a filing with no period recorded", () => {
    expect(periodIsFiled([{ periodStart: null, periodEnd: null }], "2026-08-01", "2026-08-31")).toBe(false);
  });
});

describe("isWhollyUnpriced", () => {
  it("is true when no hour on the row could be priced", () => {
    // The table renders em-dashes for these instead of five $0.00 cells.
    // The copy promised "unpriced rather than as $0" and the rendering
    // said $0.00 five times — found in a browser, invisible to a unit
    // test, because the numbers were right and only the display lied.
    expect(isWhollyUnpriced({ hours: 8, uncomputedHours: 8 })).toBe(true);
  });

  it("is false when some hours WERE priced", () => {
    // That money is genuinely owed on the hours that priced. Blanking it
    // would swing the error the other way.
    expect(isWhollyUnpriced({ hours: 10, uncomputedHours: 2 })).toBe(false);
  });

  it("is false for a fully priced row and for an empty one", () => {
    expect(isWhollyUnpriced({ hours: 8, uncomputedHours: 0 })).toBe(false);
    expect(isWhollyUnpriced({ hours: 0, uncomputedHours: 0 })).toBe(false);
  });
});
