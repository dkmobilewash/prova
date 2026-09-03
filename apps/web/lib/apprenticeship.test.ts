import { describe, expect, it } from "vitest";
import {
  currentPeriod,
  currentPeriodStartedOn,
  enrollmentState,
  periodStandings,
  shortfall,
  standing,
  standingLabel,
  type EnrollmentInput,
  type PeriodInput,
} from "./apprenticeship";

const enrollment = (over: Partial<EnrollmentInput> = {}): EnrollmentInput => ({
  enrolledOn: "2025-01-06",
  completedOn: null,
  cancelledOn: null,
  requiredOjtHoursPerPeriod: null,
  requiredClassroomHoursPerPeriod: null,
  ...over,
});

const period = (over: Partial<PeriodInput> = {}): PeriodInput => ({
  periodNumber: 1,
  classroomHours: null,
  signedOffOn: null,
  ...over,
});

describe("enrollment state", () => {
  it("is derived from the dates, with no stored status to disagree with them", () => {
    expect(enrollmentState(enrollment())).toBe("ACTIVE");
    expect(enrollmentState(enrollment({ completedOn: "2029-01-06" }))).toBe("COMPLETED");
    expect(enrollmentState(enrollment({ cancelledOn: "2026-04-01" }))).toBe("CANCELLED");
  });

  it("names a contradictory record rather than picking a winner", () => {
    // Completed AND cancelled is a data-entry error. Resolving it by
    // precedence would hide it, on a record somebody may have to defend.
    expect(
      enrollmentState(enrollment({ completedOn: "2029-01-06", cancelledOn: "2026-04-01" })),
    ).toBe("CONTRADICTORY");
  });
});

describe("current period", () => {
  it("is 1 before anything has been signed off", () => {
    expect(currentPeriod([])).toBe(1);
    expect(currentPeriod([period({ periodNumber: 1 })])).toBe(1);
  });

  it("advances only on a SIGN-OFF, never on hours", () => {
    // The sponsor decides progression. A period with classroom hours logged
    // and no signature is still open, and saying otherwise would record our
    // arithmetic as though it were their decision.
    const worked = [period({ periodNumber: 1, classroomHours: 900, signedOffOn: null })];
    expect(currentPeriod(worked)).toBe(1);

    const signed = [period({ periodNumber: 1, classroomHours: 0, signedOffOn: "2026-01-05" })];
    expect(currentPeriod(signed)).toBe(2);
  });

  it("takes the highest signed-off period, not the count of them", () => {
    // A programme that credited period 2 without a row for period 1 still
    // has the apprentice in period 3.
    const rows = [period({ periodNumber: 2, signedOffOn: "2026-06-01" })];
    expect(currentPeriod(rows)).toBe(3);
  });
});

describe("when the current period started", () => {
  it("is the indenture date until something is signed off", () => {
    expect(currentPeriodStartedOn(enrollment(), [])).toBe("2025-01-06");
  });

  it("is the LATEST sign-off once there are some", () => {
    const rows = [
      period({ periodNumber: 1, signedOffOn: "2026-01-05" }),
      period({ periodNumber: 2, signedOffOn: "2026-07-01" }),
    ];
    expect(currentPeriodStartedOn(enrollment(), rows)).toBe("2026-07-01");
  });

  it("ignores an unsigned period even when it is the highest", () => {
    const rows = [
      period({ periodNumber: 1, signedOffOn: "2026-01-05" }),
      period({ periodNumber: 2, signedOffOn: null }),
    ];
    expect(currentPeriodStartedOn(enrollment(), rows)).toBe("2026-01-05");
  });
});

describe("the window a sign-off opens", () => {
  it("starts at the sign-off, so work done BEFORE it stops counting", () => {
    // The fixture my own click-list failed to specify. It asked a tester to
    // watch hours drop after a sign-off, but every hour in the data was
    // already after the sign-off date, so both windows held the same total
    // and a broken window would have looked identical to a working one.
    // They caught it, built the straddling case by hand, and it passed.
    // This pins that case so the next person does not need to.
    const e = enrollment({ enrolledOn: "2026-01-05" });
    const signedOff = [period({ periodNumber: 1, signedOffOn: "2026-07-01" })];

    expect(currentPeriodStartedOn(e, [])).toBe("2026-01-05");
    expect(currentPeriodStartedOn(e, signedOff)).toBe("2026-07-01");

    // An entry dated between the two -- 2026-03-10 in the run that found
    // this -- is inside the first window and outside the second. That is
    // the whole behaviour, and it is a date comparison, which is why the
    // hours never needed storing.
    const probe = "2026-03-10";
    expect(probe >= currentPeriodStartedOn(e, [])).toBe(true);
    expect(probe >= currentPeriodStartedOn(e, signedOff)).toBe(false);
  });
});

describe("measuring against a requirement", () => {
  it("refuses to measure when the programme never stated one", () => {
    // The whole point. 2000 hours is a convention, not a rule, and a
    // denominator this app invented would turn "we don't know" into a
    // percentage somebody could act on.
    expect(standing(1800, null)).toBe("NO_REQUIREMENT_RECORDED");
    expect(shortfall(1800, null)).toBeNull();
    expect(standingLabel(standing(1800, null))).toBe(
      "no requirement recorded for this programme",
    );
  });

  it("separates 'nobody recorded it' from 'they did none'", () => {
    // Null and zero go in different columns of a report to a sponsor.
    expect(standing(null, 144)).toBe("NOT_RECORDED");
    expect(standing(0, 144)).toBe("SHORT");
    expect(shortfall(null, 144)).toBeNull();
    expect(shortfall(0, 144)).toBe(144);
  });

  it("counts exactly meeting the requirement as met", () => {
    expect(standing(144, 144)).toBe("MET");
    expect(shortfall(144, 144)).toBe(0);
  });

  it("never reports a surplus as a negative shortfall", () => {
    // -12 in a shortfall column sums wrong: a column of gaps that cancels
    // itself out understates the real total owed.
    expect(shortfall(156, 144)).toBe(0);
  });
});

describe("period standings", () => {
  it("orders by period number whatever order the rows arrive in", () => {
    const rows = [period({ periodNumber: 3 }), period({ periodNumber: 1 })];
    expect(periodStandings(enrollment(), rows).map((p) => p.periodNumber)).toEqual([1, 3]);
  });

  it("carries the raw hours through beside the verdict", () => {
    const e = enrollment({ requiredClassroomHoursPerPeriod: 144 });
    const rows = [period({ periodNumber: 1, classroomHours: 100 })];
    const [first] = periodStandings(e, rows);

    expect(first.classroomHours).toBe(100);
    expect(first.classroom).toBe("SHORT");
    expect(first.classroomShortfall).toBe(44);
  });
});
