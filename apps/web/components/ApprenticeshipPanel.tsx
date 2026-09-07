import Link from "next/link";
import { standingLabel } from "@/lib/apprenticeship";
import type { ApprenticeStanding } from "@/lib/apprenticeship-query";
import { ApprenticeshipRowActions } from "@/components/ApprenticeshipRowActions";
import { ApprenticeshipPeriodRow } from "@/components/ApprenticeshipPeriodRow";

/** Reads the standing out loud rather than as a status chip, because on
 * this screen "SHORT" beside a blank cell cannot be told apart from
 * "nobody recorded it", and those are different conversations with a
 * sponsor. */
function StandingNote({
  done,
  required,
  standing,
  shortfallHours,
  unit,
}: {
  done: number | null;
  required: number | null;
  standing: string;
  shortfallHours: number | null;
  unit: string;
}) {
  const tone =
    standing === "MET"
      ? "text-green-300"
      : standing === "SHORT"
        ? "text-amber-300"
        : "text-slate-500";

  return (
    <span className={`text-xs ${tone}`}>
      {done === null ? "—" : `${done} ${unit}`}
      {required !== null && <span className="text-slate-500"> of {required}</span>}
      {" · "}
      {standingLabel(standing as never)}
      {shortfallHours !== null && shortfallHours > 0 && ` · ${shortfallHours} short`}
    </span>
  );
}

export function ApprenticeshipPanel({
  rows,
  canDelete,
}: {
  rows: ApprenticeStanding[];
  canDelete: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <p className="text-sm text-slate-300">No apprenticeship registrations recorded.</p>
        <p className="mt-2 text-xs text-slate-500">
          The ratio review above reads who is on which side of a crew from the craft
          classifications. This is the other half — the programme itself: who sponsors it, the
          registration number, classroom hours and the sign-offs that move somebody up a period.
          None of that can be worked out from hours logged, which is why it has to be entered.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.enrollmentId} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-slate-100">{row.apprenticeName}</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">
              Period {row.period}
            </span>
            {row.state === "COMPLETED" && (
              <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs text-green-300">
                Completed
              </span>
            )}
            {row.state === "CANCELLED" && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                Cancelled
              </span>
            )}
            {row.state === "CONTRADICTORY" && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">
                Recorded as both completed and cancelled — fix the dates
              </span>
            )}
          </div>

          <p className="mt-1 text-xs text-slate-400">
            {row.sponsorName}
            {row.programNumber !== null && ` · ${row.programNumber}`}
            {row.craftName !== null && ` · ${row.craftName}`}
            {row.localName !== null && ` · ${row.localName}`}
            {` · indentured ${row.enrolledOn}`}
          </p>

          <div className="mt-3 flex flex-col gap-1">
            <div>
              <span className="text-xs text-slate-400">On the job, this period </span>
              <StandingNote
                done={row.ojtHoursThisPeriod}
                required={row.requiredOjtHoursPerPeriod}
                standing={row.ojt}
                shortfallHours={row.ojtShortfall}
                unit="hrs"
              />
            </div>
            <p className="text-xs text-slate-500">
              Counted from{" "}
              <Link href="/field-reports" className="underline hover:text-slate-300">
                the timesheets
              </Link>{" "}
              since {row.periodStartedOn} — nothing here is a second copy of those hours, so a
              corrected entry moves this figure with it.
            </p>
          </div>

          {row.periods.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-800 border-t border-slate-800">
              {row.periods.map((p) => (
                <ApprenticeshipPeriodRow
                  key={p.periodNumber}
                  periodId={p.id}
                  classroomHours={p.classroomHours}
                  signedOffOn={p.signedOffOn}
                  signedOffBy={p.signedOffBy}
                  canDelete={canDelete}
                >
                  <span className="text-xs text-slate-300">Period {p.periodNumber}</span>
                  <span className="text-xs text-slate-500">
                    {p.signedOffOn === null ? "not signed off" : `signed off ${p.signedOffOn}`}
                  </span>
                  <StandingNote
                    done={p.classroomHours}
                    required={null}
                    standing={p.classroom}
                    shortfallHours={p.classroomShortfall}
                    unit="classroom hrs"
                  />
                </ApprenticeshipPeriodRow>
              ))}
            </ul>
          )}

          <ApprenticeshipRowActions
            enrollmentId={row.enrollmentId}
            nextPeriod={row.period}
            canDelete={canDelete}
            enrollment={{
              sponsorName: row.sponsorName,
              programNumber: row.programNumber,
              completedOn: row.completedOn,
              cancelledOn: row.cancelledOn,
              requiredOjtHoursPerPeriod: row.requiredOjtHoursPerPeriod,
              requiredClassroomHoursPerPeriod: row.requiredClassroomHoursPerPeriod,
              note: row.note,
            }}
          />
        </div>
      ))}
    </div>
  );
}
