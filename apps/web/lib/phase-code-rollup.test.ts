import { describe, expect, it } from "vitest";
import {
  phaseCodeRollupLine,
  rollUpPhaseCodes,
  type PhaseCodeMeta,
  type PhaseCodeRollupLine,
} from "./phase-code-rollup";

/**
 * The claims this page is worth having for, pinned one at a time.
 *
 * The headline one is not "the arithmetic adds up" — it is that UNCODED
 * WORK IS NAMED. Most line items carry no phase code and never will be
 * backfilled, so a rollup that silently dropped them would show a
 * contractor a total that looks like their whole budget and is not. Every
 * assertion below about `uncoded` and about coverage is that claim; the
 * sums are the easy half.
 */

const phase = (over: Partial<PhaseCodeMeta> & { id: string; code: string }): PhaseCodeMeta => ({
  name: `${over.code} work`,
  unit: null,
  tracksLabor: true,
  isActive: true,
  sortOrder: 0,
  ...over,
});

const line = (over: Partial<PhaseCodeRollupLine> = {}): PhaseCodeRollupLine => ({
  phaseCodeId: null,
  jobId: "job_a",
  budgetedCost: 0,
  actualCost: 0,
  unpricedLaborHours: 0,
  ...over,
});

const PLYWOOD = phase({ id: "pc_plywood", code: "04112", name: "Plywood - SF", sortOrder: 1 });
const FRAMING = phase({ id: "pc_framing", code: "09220", name: "Metal framing - LF", sortOrder: 2 });

describe("one phase across two jobs", () => {
  const rollup = rollUpPhaseCodes(
    [PLYWOOD],
    [
      line({ phaseCodeId: "pc_plywood", jobId: "job_a", budgetedCost: 10_000, actualCost: 9_000 }),
      line({ phaseCodeId: "pc_plywood", jobId: "job_b", budgetedCost: 4_000, actualCost: 5_500 }),
    ],
  );

  it("sums budget and actual across both", () => {
    // The whole reason this page exists: a JobLineItem's description is
    // free text and belongs to one job, so this total is unanswerable
    // anywhere else in the app.
    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0].budgetedCost).toBe(14_000);
    expect(rollup.rows[0].actualCost).toBe(14_500);
  });

  it("reports the variance as over budget, not as a negative to interpret", () => {
    expect(rollup.rows[0].variance).toBe(-500);
  });

  it("counts the JOBS it appears on, not the lines", () => {
    expect(rollup.rows[0].jobCount).toBe(2);
    expect(rollup.rows[0].lineCount).toBe(2);
  });

  it("counts two lines on the same job as one job", () => {
    const sameJob = rollUpPhaseCodes(
      [PLYWOOD],
      [
        line({ phaseCodeId: "pc_plywood", jobId: "job_a", budgetedCost: 1, actualCost: 1 }),
        line({ phaseCodeId: "pc_plywood", jobId: "job_a", budgetedCost: 1, actualCost: 1 }),
      ],
    );
    expect(sameJob.rows[0].jobCount).toBe(1);
    expect(sameJob.rows[0].lineCount).toBe(2);
  });
});

describe("an uncoded line", () => {
  const rollup = rollUpPhaseCodes(
    [PLYWOOD],
    [
      line({ phaseCodeId: "pc_plywood", budgetedCost: 6_000, actualCost: 5_000 }),
      line({ phaseCodeId: null, jobId: "job_z", budgetedCost: 2_000, actualCost: 3_000 }),
    ],
  );

  it("lands in the uncoded row with its own money", () => {
    expect(rollup.uncoded.budgetedCost).toBe(2_000);
    expect(rollup.uncoded.actualCost).toBe(3_000);
    expect(rollup.uncoded.lineCount).toBe(1);
    expect(rollup.uncoded.jobCount).toBe(1);
    expect(rollup.uncoded.phase).toBeNull();
  });

  it("is in NO phase row — nothing here guesses which phase it belongs to", () => {
    // The defect this whole feature refuses: spreading uncoded money over
    // the coded phases, or filing it under whatever the description
    // happened to match, would put somebody's money under a code they
    // never chose.
    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0].budgetedCost).toBe(6_000);
    expect(rollup.rows[0].actualCost).toBe(5_000);
    expect(rollup.rows[0].lineCount).toBe(1);
  });

  it("is still in the totals, so the parts add up to the whole", () => {
    expect(rollup.totals.budgetedCost).toBe(8_000);
    expect(rollup.totals.actualCost).toBe(8_000);
    expect(rollup.rows[0].budgetedCost + rollup.uncoded.budgetedCost).toBe(
      rollup.totals.budgetedCost,
    );
  });

  it("counts toward the total job count once, alongside the coded job", () => {
    expect(rollup.totals.jobCount).toBe(2);
  });
});

describe("a line whose phase code belongs to nobody we know", () => {
  // The database's foreign key makes this impossible within one company,
  // so this is the cross-company mix-up case. Counted as uncoded rather
  // than dropped: dropping it loses money out of the totals silently.
  const rollup = rollUpPhaseCodes(
    [PLYWOOD],
    [line({ phaseCodeId: "pc_someone_elses", budgetedCost: 900, actualCost: 100 })],
  );

  it("is reported as uncoded rather than disappearing", () => {
    expect(rollup.uncoded.budgetedCost).toBe(900);
    expect(rollup.totals.budgetedCost).toBe(900);
    expect(rollup.rows[0].budgetedCost).toBe(0);
  });
});

describe("coverage", () => {
  it("falls to the share of budgeted cost that is coded", () => {
    const rollup = rollUpPhaseCodes(
      [PLYWOOD],
      [
        line({ phaseCodeId: "pc_plywood", budgetedCost: 7_500, actualCost: 0 }),
        line({ phaseCodeId: null, budgetedCost: 2_500, actualCost: 0 }),
      ],
    );
    expect(rollup.budgetCoverage).toBeCloseTo(0.75, 10);
  });

  it("reads 100% when every line is coded", () => {
    const rollup = rollUpPhaseCodes(
      [PLYWOOD, FRAMING],
      [
        line({ phaseCodeId: "pc_plywood", budgetedCost: 1_000, actualCost: 400 }),
        line({ phaseCodeId: "pc_framing", budgetedCost: 3_000, actualCost: 600 }),
      ],
    );
    expect(rollup.budgetCoverage).toBe(1);
    expect(rollup.actualCoverage).toBe(1);
    expect(rollup.uncoded.lineCount).toBe(0);
  });

  it("answers the budget and the actual question separately, because they disagree", () => {
    // A company can code its budget carefully and then book spend against
    // uncoded lines. One number cannot say both, and averaging them would
    // say neither.
    const rollup = rollUpPhaseCodes(
      [PLYWOOD],
      [
        line({ phaseCodeId: "pc_plywood", budgetedCost: 10_000, actualCost: 0 }),
        line({ phaseCodeId: null, budgetedCost: 0, actualCost: 4_000 }),
      ],
    );
    expect(rollup.budgetCoverage).toBe(1);
    expect(rollup.actualCoverage).toBe(0);
  });

  it("reads 100% when there is no money at all — nothing budgeted is nothing uncoded", () => {
    // The same rule lib/wip.ts's costCoverage follows for a job with no
    // spend. A 0/0 reported as 0% would put an alarming figure on a brand
    // new account that has done nothing wrong.
    const rollup = rollUpPhaseCodes([PLYWOOD], []);
    expect(rollup.budgetCoverage).toBe(1);
    expect(rollup.actualCoverage).toBe(1);
  });
});

describe("a line with no budgeted unit cost", () => {
  const rollup = rollUpPhaseCodes(
    [PLYWOOD],
    [
      line({ phaseCodeId: "pc_plywood", budgetedCost: 5_000, actualCost: 1_000 }),
      line({ phaseCodeId: "pc_plywood", budgetedCost: null, actualCost: 2_000 }),
    ],
  );

  it("is counted, not budgeted — null is not zero", () => {
    expect(rollup.rows[0].budgetedCost).toBe(5_000);
    expect(rollup.rows[0].linesWithoutBudget).toBe(1);
    expect(rollup.rows[0].lineCount).toBe(2);
  });

  it("still brings its actual cost, so the variance is not flattering", () => {
    expect(rollup.rows[0].actualCost).toBe(3_000);
    expect(rollup.rows[0].variance).toBe(2_000);
  });
});

describe("a retired phase code", () => {
  const RETIRED = phase({
    id: "pc_retired",
    code: "02100",
    name: "Demolition - SF",
    isActive: false,
    sortOrder: 3,
  });

  it("still reports the history coded to it", () => {
    // Retiring is isActive=false and never a delete, precisely so this
    // keeps working: the code is the evidence of how work on an
    // already-invoiced job was coded.
    const rollup = rollUpPhaseCodes(
      [PLYWOOD, RETIRED],
      [line({ phaseCodeId: "pc_retired", budgetedCost: 12_000, actualCost: 13_400 })],
    );
    const retired = rollup.rows.find((row) => row.phase?.id === "pc_retired");
    expect(retired).toBeDefined();
    expect(retired?.budgetedCost).toBe(12_000);
    expect(retired?.actualCost).toBe(13_400);
    expect(retired?.variance).toBe(-1_400);
    expect(retired?.phase?.isActive).toBe(false);
  });

  it("drops out only when it has no history at all", () => {
    const rollup = rollUpPhaseCodes([PLYWOOD, RETIRED], []);
    expect(rollup.rows.map((row) => row.phase?.id)).toEqual(["pc_plywood"]);
  });
});

describe("an active phase with no work coded to it", () => {
  it("still gets a row, so this page and the settings list agree", () => {
    const rollup = rollUpPhaseCodes([PLYWOOD, FRAMING], []);
    expect(rollup.rows.map((row) => row.phase?.code)).toEqual(["04112", "09220"]);
    expect(rollup.rows[0].budgetedCost).toBe(0);
    expect(rollup.rows[0].jobCount).toBe(0);
  });
});

describe("the reading order", () => {
  it("is the company's sortOrder, not the code and not the name", () => {
    // "The order the company reads them in, which is not alphabetical and
    // is not the code order either" — the model comment.
    const rollup = rollUpPhaseCodes(
      [
        phase({ id: "c", code: "01000", name: "Aardvark", sortOrder: 9 }),
        phase({ id: "a", code: "09999", name: "Zebra", sortOrder: 1 }),
        phase({ id: "b", code: "05000", name: "Middle", sortOrder: 5 }),
      ],
      [],
    );
    expect(rollup.rows.map((row) => row.phase?.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a tie on the code, so two phases at the same sort order are stable", () => {
    const rollup = rollUpPhaseCodes(
      [
        phase({ id: "second", code: "04120", sortOrder: 0 }),
        phase({ id: "first", code: "04110", sortOrder: 0 }),
      ],
      [],
    );
    expect(rollup.rows.map((row) => row.phase?.id)).toEqual(["first", "second"]);
  });
});

describe("the uncoded row when everything is coded", () => {
  it("is still there, at zero", () => {
    // A row that vanishes when it is empty is a row nobody can trust when
    // it is not, because its absence and its non-existence look the same
    // on screen.
    const rollup = rollUpPhaseCodes(
      [PLYWOOD],
      [line({ phaseCodeId: "pc_plywood", budgetedCost: 100, actualCost: 100 })],
    );
    expect(rollup.uncoded).toBeDefined();
    expect(rollup.uncoded.lineCount).toBe(0);
    expect(rollup.uncoded.budgetedCost).toBe(0);
    expect(rollup.uncoded.actualCost).toBe(0);
    expect(rollup.uncoded.variance).toBe(0);
  });
});

describe("hours nobody could price are named, not averaged in at zero (#287)", () => {
  // `actualCost` on a line now includes burdened labor (lib/labor-job-cost.ts).
  // When no FringeRateSchedule covers an entry's craft and date, labor-cost.ts
  // returns null rather than guessing a wage — so those hours add NO dollars,
  // and $0 of labor is indistinguishable from cheap labor inside a variance.
  //
  // A cost code is exactly where that misreads worst: `tracksLabor` is a
  // column on PhaseCode, so a phase flagged as tracking labor could report a
  // handsome underrun built entirely out of hours nobody had a rate for.

  it("carries unpriced hours up to the phase row and the totals", () => {
    const rollup = rollUpPhaseCodes(
      [PLYWOOD],
      [
        line({ phaseCodeId: PLYWOOD.id, budgetedCost: 10_000, actualCost: 4_000, unpricedLaborHours: 120 }),
        line({ phaseCodeId: PLYWOOD.id, budgetedCost: 5_000, actualCost: 2_000 }),
      ],
    );

    expect(rollup.rows[0].unpricedLaborHours).toBe(120);
    expect(rollup.totals.unpricedLaborHours).toBe(120);
    // The variance still reads as a $9,000 underrun. That is the number the
    // caveat exists to qualify, so it must NOT be silently adjusted.
    expect(rollup.rows[0].variance).toBe(9_000);
  });

  it("reports unpriced hours on uncoded work too", () => {
    const rollup = rollUpPhaseCodes(
      [PLYWOOD],
      [line({ phaseCodeId: null, budgetedCost: 1_000, actualCost: 0, unpricedLaborHours: 8 })],
    );
    expect(rollup.uncoded.unpricedLaborHours).toBe(8);
    expect(rollup.totals.unpricedLaborHours).toBe(8);
  });

  it("reports zero when every hour was priced", () => {
    const rollup = rollUpPhaseCodes(
      [PLYWOOD],
      [line({ phaseCodeId: PLYWOOD.id, budgetedCost: 100, actualCost: 90 })],
    );
    expect(rollup.rows[0].unpricedLaborHours).toBe(0);
    expect(rollup.totals.unpricedLaborHours).toBe(0);
  });
});

describe("phaseCodeRollupLine: turning a row into a costed line (#287)", () => {
  const CARPENTER = "craft_carpenter";
  const schedules = new Map([
    [
      CARPENTER,
      [
        {
          baseWage: 40,
          pensionRate: 5,
          vacationRate: 3,
          healthWelfareRate: 2,
          trainingRate: 0,
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
          effectiveTo: null,
        },
      ],
    ],
  ]);

  const entry = (over: Record<string, unknown> = {}) => ({
    lineItemId: "li_1",
    craftClassificationId: CARPENTER,
    date: new Date("2026-06-01T00:00:00Z"),
    hours: 10,
    payType: "STRAIGHT" as const,
    perDiemAmount: null,
    travelPayAmount: null,
    ...over,
  });

  const row = (over: Record<string, unknown> = {}) => ({
    phaseCodeId: "pc_plywood",
    jobId: "job_a",
    quantity: 100,
    budgetedUnitCost: 30,
    costEntries: [{ amount: 400 }],
    timeEntries: [entry()],
    ...over,
  });

  it("adds burdened labor to the manual cost entries", () => {
    // Hand-worked: $40 base + $10 of fringes = $50/hr burdened, 10 hours =
    // $500 of labor, on top of $400 of booked material. $900, not $400.
    const line = phaseCodeRollupLine(row(), schedules);
    expect(line.actualCost).toBe(900);
    expect(line.unpricedLaborHours).toBe(0);
  });

  it("still multiplies the budget out of the two Decimals", () => {
    expect(phaseCodeRollupLine(row(), schedules).budgetedCost).toBe(3_000);
  });

  it("keeps null budgeted cost as null, never as zero", () => {
    expect(phaseCodeRollupLine(row({ budgetedUnitCost: null }), schedules).budgetedCost).toBeNull();
  });

  it("adds no dollars for hours no schedule covers, and counts them", () => {
    // A craft with no schedule in the map: labor-cost.ts refuses to guess a
    // wage, so the hours cost nothing AND say so.
    const line = phaseCodeRollupLine(
      row({ timeEntries: [entry({ craftClassificationId: "craft_unknown", hours: 12 })] }),
      schedules,
    );
    expect(line.actualCost).toBe(400);
    expect(line.unpricedLaborHours).toBe(12);
  });

  it("costs a line with hours and no cost entries at all", () => {
    // The self-performed shape: the crew's time IS the cost.
    const line = phaseCodeRollupLine(row({ costEntries: [] }), schedules);
    expect(line.actualCost).toBe(500);
  });

  it("leaves a line with no hours exactly as it was", () => {
    const line = phaseCodeRollupLine(row({ timeEntries: [] }), schedules);
    expect(line.actualCost).toBe(400);
    expect(line.unpricedLaborHours).toBe(0);
  });
});
