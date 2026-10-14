import { Disclosure } from "@/components/Disclosure";
import { EmployerBurdenRateForm } from "@/components/EmployerBurdenRateForm";
import {
  EmployerBurdenRateRow,
  type EmployerBurdenRateStanding,
} from "@/components/EmployerBurdenRateRow";
import {
  employerBurdenPercentText,
  type EmployerBurdenRateRecord,
  type EmployerBurdenStanding,
} from "@/lib/employer-burden";

/**
 * The /settings section for the employer burden percentage.
 *
 * Renders what `employerBurdenStanding` derived — which rate is in force is
 * decided there, from the dates, and nowhere else. This component only says
 * it.
 *
 * THE EMPTY STATE IS THE IMPORTANT ONE, because it is where every company
 * starts and it has to say plainly what the figures currently leave out
 * rather than read as a feature nobody has got round to.
 */
export function EmployerBurdenRates({
  standing,
  canDelete,
}: {
  standing: EmployerBurdenStanding<EmployerBurdenRateRecord>;
  canDelete: boolean;
}) {
  const { current, upcoming, history } = standing;
  const upcomingIds = new Set(upcoming.map((record) => record.id));
  const rowStanding = (record: EmployerBurdenRateRecord): EmployerBurdenRateStanding =>
    record.id === current?.id ? "current" : upcomingIds.has(record.id) ? "upcoming" : "past";

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-ink-label">Employer burden</h2>
      {/* What it is and the base-wage-only modelling choice live in the
          Estimating tab's one "How this works" on /settings (declutter). */}

      {current ? (
        <p className="mb-3 text-sm text-ink">
          In force: <span className="font-semibold">{employerBurdenPercentText(current.percent)}%</span>{" "}
          of base wages, from {current.effectiveDate}.
          {upcoming[0] && (
            <>
              {" "}
              The next rate on file, {employerBurdenPercentText(upcoming[0].percent)}%, starts{" "}
              {upcoming[0].effectiveDate}.
            </>
          )}
        </p>
      ) : history.length > 0 ? (
        <p className="mb-3 text-sm text-ink-body">
          No rate on file has taken effect yet. The earliest one recorded starts{" "}
          {upcoming[0]?.effectiveDate} — until then, job cost carries wage and fringes only.
        </p>
      ) : null}

      <div className="mb-3">
        <EmployerBurdenRateForm />
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-card bg-surface/50 p-5">
          <p className="text-sm font-medium text-ink-label">No employer burden recorded</p>
          <p className="mt-1 text-sm text-ink-body">
            Until you record one, every job&apos;s labor cost is the base wage plus the four CBA
            fringes and nothing else — no employer FICA, no unemployment, no workers&apos; comp. That
            understates cost to date and OVERSTATES percent complete. Ask your accountant for the
            percentage and record it with the button above.
          </p>
          <Disclosure variant="plain" summary="Why there is no default" className="mt-2">
            <p className="text-sm text-ink-body">
              This app will not guess the figure: employer FICA has a wage base per employee per
              year, unemployment is per-state with your own experience rating, and comp is a
              class-code rate times your mod times what the carrier actually wrote — none of which
              is in here.
            </p>
          </Disclosure>
        </div>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {history.map((record) => (
            <EmployerBurdenRateRow
              key={record.id}
              record={record}
              standing={rowStanding(record)}
              canDelete={canDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
