import { describe, expect, it, vi } from "vitest";

/**
 * Which TimeEntry rows an indenture's OJT hours are summed FROM.
 *
 * #104 finding 9 scoped that sum to the enrollment's craft. Correct for
 * TAGGED hours, and a silent zero for everything else: `craftClassificationId`
 * on TimeEntry is nullable, `LogTimeEntryForm`'s craft select defaults to
 * "No craft tag", and a Prisma scalar equality compiles to SQL `=`, which
 * never matches NULL. So the ordinary case — a crew that logs hours without
 * picking a craft — stopped counting toward the apprentice's hours on the
 * one record that gates work on public jobs. Under-reporting there is not a
 * cosmetic bug: it reads as an apprentice who is behind their programme.
 *
 * THE FAKE BELOW IS THE TEST, so it is worth saying exactly what it does.
 * It does not hand back rows and hope; it INTERPRETS the where-clause the
 * loader builds, with the two Prisma/SQL rules this defect turns on:
 *
 *   - a scalar equality (`field: value`) matches by `===`, so a null column
 *     never satisfies it, and `field: null` matches ONLY null;
 *   - an `undefined` filter is dropped rather than matched literally.
 *
 * and it THROWS on any where key it does not implement. Both halves matter.
 * A fake that ignored the craft condition would pass against the broken
 * loader and be worse than no file; a fake that silently skipped a
 * condition it did not recognise would be the same failure one refactor
 * later — this repo's own scar is a guard that parsed nothing and passed
 * thirteen assertions. Two tests at the bottom hold the fake to both rules,
 * because an interpreter nobody checks is just a more elaborate way to
 * assert `true`.
 */

type Where = Record<string, unknown>;

type TimeEntryRow = {
  employeeUserId: string;
  craftClassificationId: string | null;
  date: Date;
  hours: string;
  job: { companyId: string };
};

type EnrollmentRow = {
  id: string;
  companyId: string;
  apprenticeUserId: string;
  craftClassificationId: string | null;
  sponsorName: string;
  programNumber: string | null;
  enrolledOn: Date;
  completedOn: Date | null;
  cancelledOn: Date | null;
  requiredOjtHoursPerPeriod: string | null;
  requiredClassroomHoursPerPeriod: string | null;
  note: string | null;
  apprenticeUser: { id: string; name: string | null; email: string };
  craftClassification: { name: string } | null;
  unionLocal: { parentInternational: string; localNumber: string } | null;
  periods: {
    id: string;
    periodNumber: number;
    classroomHours: string | null;
    signedOffOn: Date | null;
    signedOffBy: string | null;
  }[];
};

const COMPANY = "company-prova";
const OTHER_COMPANY = "company-someone-else";
const APPRENTICE = "user-sam";
const OTHER_WORKER = "user-dana";
const DRYWALL = "craft-drywall";
const PLASTER = "craft-plaster";
const TODAY = "2026-09-30";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Read by the fake at call time, set by `standingsFor` per test. */
const state: { enrollments: EnrollmentRow[]; timeEntries: TimeEntryRow[] } = {
  enrollments: [],
  timeEntries: [],
};

function scalar(condition: unknown, path: string): string {
  if (typeof condition !== "string") {
    throw new Error(`${path}: this fake only implements a plain string equality, got ${JSON.stringify(condition)}`);
  }
  return condition;
}

/**
 * Just enough of Prisma's where semantics to answer "which rows would the
 * database have summed", and loud about anything outside that.
 */
function matches(row: TimeEntryRow, where: Where, path: string): boolean {
  for (const [key, condition] of Object.entries(where)) {
    // Prisma DROPS an undefined filter. Deliberately the first branch: the
    // craft-less-enrollment case depends on it.
    if (condition === undefined) continue;

    switch (key) {
      case "OR": {
        if (!Array.isArray(condition) || condition.length === 0) {
          throw new Error(`${path}.OR must be a non-empty array, got ${JSON.stringify(condition)}`);
        }
        const any = condition.some((branch, i) => matches(row, branch as Where, `${path}.OR[${i}]`));
        if (!any) return false;
        break;
      }
      case "AND": {
        if (!Array.isArray(condition)) {
          throw new Error(`${path}.AND must be an array, got ${JSON.stringify(condition)}`);
        }
        const all = condition.every((branch, i) => matches(row, branch as Where, `${path}.AND[${i}]`));
        if (!all) return false;
        break;
      }
      case "employeeUserId": {
        if (row.employeeUserId !== scalar(condition, `${path}.employeeUserId`)) return false;
        break;
      }
      case "craftClassificationId": {
        // The whole defect in two lines. `=` in SQL never matches NULL, so
        // an untagged row fails a craft equality; `IS NULL` matches only
        // untagged rows. Anything else here is a filter shape this fake
        // cannot honestly answer for.
        if (condition !== null && typeof condition !== "string") {
          throw new Error(
            `${path}.craftClassificationId: this fake implements a string equality and null only, got ${JSON.stringify(condition)}`,
          );
        }
        if (row.craftClassificationId !== condition) return false;
        break;
      }
      case "job": {
        const nested = condition as Where;
        const keys = Object.keys(nested);
        if (keys.length !== 1 || keys[0] !== "companyId") {
          throw new Error(`${path}.job: this fake implements { companyId } only, got ${keys.join(", ")}`);
        }
        if (row.job.companyId !== scalar(nested.companyId, `${path}.job.companyId`)) return false;
        break;
      }
      case "date": {
        const range = condition as Where;
        for (const [op, bound] of Object.entries(range)) {
          if (!(bound instanceof Date)) {
            throw new Error(`${path}.date.${op}: expected a Date, got ${JSON.stringify(bound)}`);
          }
          if (op === "gte") {
            if (row.date.getTime() < bound.getTime()) return false;
          } else if (op === "lte") {
            if (row.date.getTime() > bound.getTime()) return false;
          } else {
            throw new Error(`${path}.date.${op}: this fake implements gte and lte only`);
          }
        }
        break;
      }
      default:
        throw new Error(
          `${path}.${key}: the loader filters on something this fake does not implement — teach it that filter rather than letting the sum ignore it`,
        );
    }
  }
  return true;
}

vi.mock("@prova/db", () => ({
  prisma: {
    apprenticeshipEnrollment: {
      findMany: async (args: { where: Where }) => {
        const keys = Object.keys(args.where);
        if (keys.length !== 1 || keys[0] !== "companyId") {
          throw new Error(`enrollment where: expected { companyId }, got ${keys.join(", ")}`);
        }
        return state.enrollments
          .filter((e) => e.companyId === args.where.companyId)
          .sort((a, b) => a.enrolledOn.getTime() - b.enrolledOn.getTime());
      },
    },
    timeEntry: {
      aggregate: async (args: { _sum: Record<string, boolean>; where: Where }) => {
        if (args._sum.hours !== true) {
          throw new Error(`aggregate _sum: expected { hours: true }, got ${JSON.stringify(args._sum)}`);
        }
        const rows = state.timeEntries.filter((row) => matches(row, args.where, "where"));
        // SUM over no rows is NULL in SQL, and the loader is supposed to
        // cope with that. Returning 0 here would hide it.
        if (rows.length === 0) return { _sum: { hours: null } };
        return { _sum: { hours: String(rows.reduce((total, row) => total + Number(row.hours), 0)) } };
      },
    },
  },
}));

function enrollment(over: Partial<EnrollmentRow> & { id: string }): EnrollmentRow {
  return {
    companyId: COMPANY,
    apprenticeUserId: APPRENTICE,
    craftClassificationId: null,
    sponsorName: "Carpenters JATC",
    programNumber: "2026-114",
    enrolledOn: day("2026-01-05"),
    completedOn: null,
    cancelledOn: null,
    requiredOjtHoursPerPeriod: "1000",
    requiredClassroomHoursPerPeriod: "144",
    note: null,
    apprenticeUser: { id: APPRENTICE, name: "Sam Apprentice", email: "sam@example.test" },
    craftClassification: null,
    unionLocal: null,
    periods: [],
    ...over,
  };
}

function entry(over: Partial<TimeEntryRow> & { hours: string; date: Date }): TimeEntryRow {
  return {
    employeeUserId: APPRENTICE,
    craftClassificationId: null,
    job: { companyId: COMPANY },
    ...over,
  };
}

/**
 * One week of a real timesheet: some hours tagged, some not, plus three
 * rows that must never be counted. Those three are here to keep the fake
 * honest — if it ignored the date, the job or the employee, the totals
 * below would all be wrong and the file would say so.
 */
const TIMESHEET: TimeEntryRow[] = [
  entry({ hours: "8", date: day("2026-02-10"), craftClassificationId: DRYWALL }),
  // The ordinary case: nobody picked a craft in the form.
  entry({ hours: "6", date: day("2026-02-11") }),
  entry({ hours: "5", date: day("2026-02-12"), craftClassificationId: PLASTER }),
  // Before the indenture began.
  entry({ hours: "4", date: day("2025-12-20") }),
  // Another contractor's job.
  entry({ hours: "3", date: day("2026-02-11"), job: { companyId: OTHER_COMPANY } }),
  // Somebody else's hours.
  entry({ hours: "7", date: day("2026-02-11"), employeeUserId: OTHER_WORKER }),
];

async function standingsFor(enrollments: EnrollmentRow[], timeEntries = TIMESHEET, today = TODAY) {
  state.enrollments = enrollments;
  state.timeEntries = timeEntries;
  const { loadApprenticeships } = await import("./apprenticeship-query");
  return loadApprenticeships(COMPANY, today);
}

describe("OJT hours for a craft-scoped indenture", () => {
  it("counts hours logged with no craft tag at all", async () => {
    const [row] = await standingsFor([
      enrollment({
        id: "e-drywall",
        craftClassificationId: DRYWALL,
        craftClassification: { name: "Drywall finisher" },
      }),
    ]);

    // 8 tagged drywall + 6 untagged. The 6 are the regression: a craft
    // equality drops them, and the apprentice reads 8 hours short of where
    // they actually are.
    expect(row.ojtHoursThisPeriod).toBe(14);
    expect(row.ojtShortfall).toBe(986);
  });

  it("still leaves a DIFFERENT craft's tagged hours out", async () => {
    const [row] = await standingsFor([
      enrollment({
        id: "e-drywall",
        craftClassificationId: DRYWALL,
        craftClassification: { name: "Drywall finisher" },
      }),
    ]);

    // The plaster row's 5 hours belong to a plaster indenture, so 19 would
    // be #104 finding 9 coming back. Counting untagged hours must not be a
    // way of counting everything again.
    expect(row.ojtHoursThisPeriod).not.toBe(19);
    expect(row.ojtHoursThisPeriod).toBe(14);
  });

  it("counts every hour in the window when the enrollment records no craft", async () => {
    const [row] = await standingsFor([enrollment({ id: "e-unscoped" })]);

    // Nothing to disambiguate with, so 8 + 6 + 5. Unchanged behaviour, and
    // it rests on Prisma dropping an `undefined` filter.
    expect(row.ojtHoursThisPeriod).toBe(19);
  });

  it("still stops at the date the indenture closed", async () => {
    const afterClosing = [
      ...TIMESHEET,
      entry({ hours: "40", date: day("2026-08-01"), craftClassificationId: DRYWALL }),
      entry({ hours: "20", date: day("2026-08-02") }),
    ];

    const [row] = await standingsFor(
      [
        enrollment({
          id: "e-done",
          craftClassificationId: DRYWALL,
          craftClassification: { name: "Drywall finisher" },
          completedOn: day("2026-06-01"),
        }),
      ],
      afterClosing,
    );

    // Both August rows are past completedOn — including the untagged one,
    // which is the half a craft-or-null filter could have let back in.
    expect(row.state).toBe("COMPLETED");
    expect(row.ojtHoursThisPeriod).toBe(14);
  });

  /**
   * THE RESIDUAL, PINNED ON PURPOSE.
   *
   * Untagged hours cannot be attributed to one of two open indentures, so
   * both count them. That is a knowing over-count of the untagged portion,
   * and it is the better of the two available wrongs: the alternative on
   * `main` drops those hours from BOTH, which is a compliance figure
   * reading low on every ordinary single-indenture apprentice, not just on
   * this rare shape. This test exists so that changing the trade-off is a
   * deliberate act with a failing test attached, rather than a surprise.
   */
  it("counts the same untagged hours for two open indentures in different crafts — knowingly", async () => {
    const rows = await standingsFor([
      enrollment({
        id: "e-drywall",
        craftClassificationId: DRYWALL,
        craftClassification: { name: "Drywall finisher" },
      }),
      enrollment({
        id: "e-plaster",
        craftClassificationId: PLASTER,
        craftClassification: { name: "Plasterer" },
        enrolledOn: day("2026-01-06"),
      }),
    ]);

    const drywall = rows.find((r) => r.enrollmentId === "e-drywall")!;
    const plaster = rows.find((r) => r.enrollmentId === "e-plaster")!;

    expect(drywall.ojtHoursThisPeriod).toBe(14); // 8 drywall + 6 untagged
    expect(plaster.ojtHoursThisPeriod).toBe(11); // 5 plaster + the same 6
    // Tagged hours are still attributed once each, which is what finding 9
    // was about. Only the 6 untagged hours are double-counted.
    expect(drywall.ojtHoursThisPeriod + plaster.ojtHoursThisPeriod).toBe(19 + 6);
  });
});

describe("the fake's own semantics", () => {
  const untagged = entry({ hours: "1", date: day("2026-02-11") });
  const tagged = entry({ hours: "1", date: day("2026-02-11"), craftClassificationId: DRYWALL });

  it("does not let a craft equality match an untagged row", () => {
    // If this ever passes, every assertion above is meaningless: the fake
    // would be answering "yes" to the filter the defect turns on.
    expect(matches(untagged, { craftClassificationId: DRYWALL }, "where")).toBe(false);
    expect(matches(tagged, { craftClassificationId: DRYWALL }, "where")).toBe(true);
    expect(matches(untagged, { craftClassificationId: null }, "where")).toBe(true);
    expect(matches(tagged, { craftClassificationId: null }, "where")).toBe(false);
    expect(matches(untagged, { craftClassificationId: undefined }, "where")).toBe(true);
  });

  it("throws on a filter it does not implement rather than ignoring it", () => {
    expect(() => matches(untagged, { jobLineItemId: "line-1" }, "where")).toThrow(
      /does not implement/,
    );
  });
});
