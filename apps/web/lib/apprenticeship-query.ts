import { prisma } from "@prova/db";
import {
  currentPeriod,
  currentPeriodStartedOn,
  enrollmentState,
  ojtWindowEndsOn,
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
 * [current period started, the day the indenture ends or today, whichever
 * is first], and both ends are dates -- which is why the hours never needed
 * a column. A stored total would be free to disagree with the timesheets it
 * came from, and on an indenture record that is the disagreement a
 * compliance officer finds.
 *
 * The window used to end at `today` unconditionally and to ignore the
 * craft, so a completed indenture kept accruing and a person holding two
 * enrolments had the same shift counted against both.
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
  /** The last day of that window: today, or the day the indenture ended. */
  ojtCountedThrough: string;
  /** Hours inside the window carrying NO craft tag, and therefore excluded
   *  from `ojtHoursThisPeriod`. Zero when the indenture records no craft of
   *  its own, since nothing was filtered out. A total that silently drops
   *  rows has to say which. */
  untaggedHoursThisPeriod: number;
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
    // Not `today`. An indenture that COMPLETED or was CANCELLED stops
    // accruing on-the-job hours on the day it ended — see ojtWindowEndsOn.
    const endsOn = ojtWindowEndsOn(e, today);

    // The derivation. Inclusive of the day the period started, up to the
    // end of the window: a sign-off and a shift on the same date belong to
    // the period that opened, not to the one that closed, because the hours
    // were worked after the signature either way and dropping them would
    // silently shorten every period by a day's work.
    //
    // Scoped to the indenture's OWN craft classification where it records
    // one. Without that filter every hour the person worked counted towards
    // every indenture they hold, so a second enrolment — a carpenter
    // indenturing into drywall — counted the same shift twice, once against
    // each. Two programmes each shown as satisfied by one day's work is
    // exactly the claim a sponsor would find false.
    const window = {
      gte: new Date(`${startedOn}T00:00:00.000Z`),
      lte: new Date(`${endsOn}T00:00:00.000Z`),
    };
    const scope = {
      employeeUserId: row.apprenticeUserId,
      job: { companyId },
      date: window,
    };

    // A window that closed before the current period opened has no days in
    // it at all. Prisma would happily return null for that; being explicit
    // keeps the zero honest rather than accidental.
    const empty = endsOn < startedOn;

    const [worked, untagged] = empty
      ? [null, null]
      : await Promise.all([
          prisma.timeEntry.aggregate({
            _sum: { hours: true },
            where: row.craftClassificationId
              ? { ...scope, craftClassificationId: row.craftClassificationId }
              : scope,
          }),
          // What the craft filter left out, so the figure names its own
          // gap instead of quietly being short. Hours with NO craft tag
          // cannot be attributed to an indenture, and saying so is the
          // difference between "they are 40 short" and "40 of their hours
          // are untagged".
          row.craftClassificationId
            ? prisma.timeEntry.aggregate({
                _sum: { hours: true },
                where: { ...scope, craftClassificationId: null },
              })
            : Promise.resolve(null),
        ]);

    const ojtHours = Number(worked?._sum.hours ?? 0);
    const untaggedHoursThisPeriod = Number(untagged?._sum.hours ?? 0);

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
      ojtCountedThrough: endsOn,
      untaggedHoursThisPeriod,
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
