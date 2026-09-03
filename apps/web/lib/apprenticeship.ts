/**
 * Where an apprentice stands in their programme.
 *
 * Everything here is derived. The enrolment records what the SPONSOR
 * decided -- registration, sign-offs, classroom hours -- and this works out
 * what follows from it. Nothing below is written down anywhere.
 *
 * The one thing this module never does is invent a requirement. A programme
 * that has not told us how many hours a period takes gets reported as
 * unchecked, not measured against 2000: that figure is a convention, and a
 * denominator this app made up would turn "we don't know" into a percentage
 * somebody could act on.
 */

export type EnrollmentState =
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED"
  /** Both end dates set. A record that says two contradictory things is
   *  worth naming rather than resolving by precedence -- picking one would
   *  hide a data-entry error on a compliance record. */
  | "CONTRADICTORY";

export interface EnrollmentInput {
  enrolledOn: string;
  completedOn: string | null;
  cancelledOn: string | null;
  /** Null means nobody looked it up. NOT zero. */
  requiredOjtHoursPerPeriod: number | null;
  requiredClassroomHoursPerPeriod: number | null;
}

export interface PeriodInput {
  periodNumber: number;
  /** Null is "not recorded"; zero means somebody checked and they attended
   *  nothing. Those are different facts and must not collapse. */
  classroomHours: number | null;
  signedOffOn: string | null;
}

export function enrollmentState(e: EnrollmentInput): EnrollmentState {
  if (e.completedOn !== null && e.cancelledOn !== null) return "CONTRADICTORY";
  if (e.completedOn !== null) return "COMPLETED";
  if (e.cancelledOn !== null) return "CANCELLED";
  return "ACTIVE";
}

/** The period they are working in now: one past the highest SIGNED-OFF one.
 *
 * Sign-off is the only thing that closes a period -- not an hour count
 * crossing a line. The sponsor decides progression, and treating our own
 * arithmetic as though it were their decision would be recording a fact
 * about somebody else's programme that nobody stated. */
export function currentPeriod(periods: PeriodInput[]): number {
  const signedOff = periods.filter((p) => p.signedOffOn !== null).map((p) => p.periodNumber);
  return signedOff.length === 0 ? 1 : Math.max(...signedOff) + 1;
}

/** When the current period began: the latest sign-off, else the indenture
 *  date. This is the window OJT hours are counted over, and it is why those
 *  hours never need storing -- the boundary is a date, and TimeEntry has
 *  dates. */
export function currentPeriodStartedOn(e: EnrollmentInput, periods: PeriodInput[]): string {
  const dates = periods
    .filter((p): p is PeriodInput & { signedOffOn: string } => p.signedOffOn !== null)
    .map((p) => p.signedOffOn)
    .sort();
  return dates.length === 0 ? e.enrolledOn : dates[dates.length - 1];
}

export type RequirementStanding =
  /** Recorded, and at or over what the programme asks. */
  | "MET"
  /** Recorded, and under. */
  | "SHORT"
  /** The programme has no figure on file, so there is nothing to measure
   *  against and we say so. */
  | "NO_REQUIREMENT_RECORDED"
  /** There is a requirement, but nobody has recorded what was done. */
  | "NOT_RECORDED";

export function standing(done: number | null, required: number | null): RequirementStanding {
  if (required === null) return "NO_REQUIREMENT_RECORDED";
  if (done === null) return "NOT_RECORDED";
  return done >= required ? "MET" : "SHORT";
}

/** How far short, or null when there is nothing to subtract. Never negative
 *  -- "12 hours over" is not a shortfall and reporting it as -12 invites
 *  somebody to sum a column and get a smaller total than the real gap. */
export function shortfall(done: number | null, required: number | null): number | null {
  if (required === null || done === null) return null;
  return done >= required ? 0 : required - done;
}

export interface PeriodStanding {
  periodNumber: number;
  signedOffOn: string | null;
  classroomHours: number | null;
  classroom: RequirementStanding;
  classroomShortfall: number | null;
}

export function periodStandings(
  e: EnrollmentInput,
  periods: PeriodInput[],
): PeriodStanding[] {
  return [...periods]
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((p) => ({
      periodNumber: p.periodNumber,
      signedOffOn: p.signedOffOn,
      classroomHours: p.classroomHours,
      classroom: standing(p.classroomHours, e.requiredClassroomHoursPerPeriod),
      classroomShortfall: shortfall(p.classroomHours, e.requiredClassroomHoursPerPeriod),
    }));
}

/** Reads as a sentence rather than a status word, because these appear in a
 *  list where "SHORT" next to a blank cell is ambiguous about which of the
 *  two unknowns it is. */
export function standingLabel(s: RequirementStanding): string {
  switch (s) {
    case "MET":
      return "requirement met";
    case "SHORT":
      return "short of the requirement";
    case "NO_REQUIREMENT_RECORDED":
      return "no requirement recorded for this programme";
    case "NOT_RECORDED":
      return "hours not recorded";
  }
}
