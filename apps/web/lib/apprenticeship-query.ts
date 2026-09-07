import { prisma } from "@prova/db";
import {
  currentPeriod,
  currentPeriodStartedOn,
  enrollmentState,
  periodStandings,
  shortfall,
  standing,
  type EnrollmentInput,
  type EnrollmentState,
  type PeriodInput,
  type PeriodStanding,
  type RequirementStanding,
} from "./apprenticeship";

/**
 * Assembles apprenticeship standing from real rows.
 *
 * THE ONE THING WORTH READING: on-the-job hours are summed from TimeEntry
 * here, every time, and are stored nowhere. The window is
 * [current period started, today], and both ends are dates -- which is why
 * the hours never needed a column. A stored total would be free to disagree
 * with the timesheets it came from, and on an indenture record that is the
 * disagreement a compliance officer finds.
 */

export interface ApprenticeStanding {
  enrollmentId: string;
  apprenticeName: string;
  apprenticeUserId: string;
  sponsorName: string;
  programNumber: string | null;
  craftName: string | null;
  localName: string | null;
  state: EnrollmentState;
  enrolledOn: string;
  period: number;
  periodStartedOn: string;
  /** DERIVED from TimeEntry over the current period's window. */
  ojtHoursThisPeriod: number;
  requiredOjtHoursPerPeriod: number | null;
  /** Carried for the EDIT form, not for the standing. `enrollmentState`
   *  already folded these into `state`; the form needs the raw dates back
   *  because updateApprenticeshipEnrollment overwrites the whole row, so a
   *  field the form cannot see is a field the form would silently clear. */
  completedOn: string | null;
  cancelledOn: string | null;
  requiredClassroomHoursPerPeriod: number | null;
  note: string | null;
  ojt: RequirementStanding;
  ojtShortfall: number | null;
  periods: (PeriodStanding & {
    /** Carried here, not in the pure module: the deciding does not
     *  need a row id, the editing does. */
    id: string;
    signedOffBy: string | null;
  })[];
}

function isoDay(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function required(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export async function loadApprenticeships(
  companyId: string,
  today: string,
): Promise<ApprenticeStanding[]> {
  const enrollments = await prisma.apprenticeshipEnrollment.findMany({
    where: { companyId },
    include: {
      apprenticeUser: { select: { id: true, name: true, email: true } },
      craftClassification: { select: { name: true } },
      unionLocal: { select: { parentInternational: true, localNumber: true } },
      periods: true,
    },
    orderBy: { enrolledOn: "asc" },
  });

  const standings: ApprenticeStanding[] = [];

  for (const row of enrollments) {
    const e: EnrollmentInput = {
      enrolledOn: isoDay(row.enrolledOn)!,
      completedOn: isoDay(row.completedOn),
      cancelledOn: isoDay(row.cancelledOn),
      requiredOjtHoursPerPeriod: required(row.requiredOjtHoursPerPeriod),
      requiredClassroomHoursPerPeriod: required(row.requiredClassroomHoursPerPeriod),
    };

    const periods: PeriodInput[] = row.periods.map((p) => ({
      periodNumber: p.periodNumber,
      classroomHours: required(p.classroomHours),
      signedOffOn: isoDay(p.signedOffOn),
    }));

    const startedOn = currentPeriodStartedOn(e, periods);

    // The derivation. Inclusive of the day the period started, up to today:
    // a sign-off and a shift on the same date belong to the period that
    // opened, not to the one that closed, because the hours were worked
    // after the signature either way and dropping them would silently
    // shorten every period by a day's work.
    const worked = await prisma.timeEntry.aggregate({
      _sum: { hours: true },
      where: {
        employeeUserId: row.apprenticeUserId,
        job: { companyId },
        date: {
          gte: new Date(`${startedOn}T00:00:00.000Z`),
          lte: new Date(`${today}T00:00:00.000Z`),
        },
      },
    });

    const ojtHours = Number(worked._sum.hours ?? 0);

    standings.push({
      enrollmentId: row.id,
      apprenticeName: row.apprenticeUser.name ?? row.apprenticeUser.email,
      apprenticeUserId: row.apprenticeUserId,
      sponsorName: row.sponsorName,
      programNumber: row.programNumber,
      craftName: row.craftClassification?.name ?? null,
      localName:
        row.unionLocal === null
          ? null
          : `${row.unionLocal.parentInternational} Local ${row.unionLocal.localNumber}`,
      state: enrollmentState(e),
      enrolledOn: e.enrolledOn,
      period: currentPeriod(periods),
      periodStartedOn: startedOn,
      ojtHoursThisPeriod: ojtHours,
      requiredOjtHoursPerPeriod: e.requiredOjtHoursPerPeriod,
      completedOn: e.completedOn,
      cancelledOn: e.cancelledOn,
      requiredClassroomHoursPerPeriod: e.requiredClassroomHoursPerPeriod,
      note: row.note,
      ojt: standing(ojtHours, e.requiredOjtHoursPerPeriod),
      ojtShortfall: shortfall(ojtHours, e.requiredOjtHoursPerPeriod),
      periods: periodStandings(e, periods).map((standing) => {
        const source = row.periods.find((p) => p.periodNumber === standing.periodNumber)!;
        return { ...standing, id: source.id, signedOffBy: source.signedOffBy };
      }),
    });
  }

  return standings;
}

/** The people an indenture can be attached to. Kept beside the loader that
 * needs it rather than in a shared list, because "who can be an apprentice"
 * is everyone on the team -- the tier lives on the craft classification,
 * not on the person, and pre-filtering here would hide a new hire from the
 * form that is supposed to register them. */
export async function loadTeamForApprenticeship(companyId: string) {
  return prisma.user.findMany({
    where: { companyId },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
}
