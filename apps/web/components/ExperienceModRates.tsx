import { ExperienceModRateForm } from "@/components/ExperienceModRateForm";
import { ExperienceModRateRow, type ExperienceModRateStanding } from "@/components/ExperienceModRateRow";
import { policyYearEnd, type EmrRecord, type EmrStanding } from "@/lib/emr";

/**
 * The /compliance section for the experience modification rate.
 *
 * Renders what `emrStanding` derived — which rate is current is decided
 * there, from the dates, and nowhere else. This component only says it.
 */
export function ExperienceModRates({
  standing,
  canDelete,
}: {
  standing: EmrStanding<EmrRecord>;
  canDelete: boolean;
}) {
  const { current, upcoming, history, currentIsPastItsPolicyYear } = standing;
  const upcomingIds = new Set(upcoming.map((record) => record.id));
  const rowStanding = (record: EmrRecord): ExperienceModRateStanding =>
    record.id === current?.id ? "current" : upcomingIds.has(record.id) ? "upcoming" : "past";

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-semibold text-ink-label">Experience modification rate</h2>
      <p className="mb-3 text-sm text-ink-body">
        The mod rate on your workers&apos; comp, as the rating bureau issued it — the figure a GC asks for on a
        prequalification form.
      </p>

      {current ? (
        <p className="mb-3 text-sm text-ink">
          Current rate <span className="font-semibold">{current.rate}</span>, effective {current.effectiveDate},
          issued by {current.source}.
          {currentIsPastItsPolicyYear && (
            <span className="text-tag-amber-ink">
              {" "}
              That policy year ended {policyYearEnd(current.effectiveDate)} — this is the newest rate on file, not
              necessarily this year&apos;s. Record the new one when the bureau issues it.
            </span>
          )}
        </p>
      ) : history.length > 0 ? (
        <p className="mb-3 text-sm text-ink-body">
          No rate on file has taken effect yet. The earliest one recorded starts {upcoming[0]?.effectiveDate}.
        </p>
      ) : null}

      <div className="mb-3">
        <ExperienceModRateForm />
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-card bg-surface/50 p-5">
          <p className="text-sm font-medium text-ink-label">No mod rate on file</p>
          <p className="mt-1 text-sm text-ink-body">
            This app never computes or estimates an EMR. It comes from the rating bureau — NCCI or your state&apos;s
            bureau — through your carrier or broker, on a rating worksheet. The OSHA log on the Safety page is part
            of what a bureau calculates one from, but it is not the rate. Record the rate on the worksheet with the
            button above.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {history.map((record) => (
            <ExperienceModRateRow
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
