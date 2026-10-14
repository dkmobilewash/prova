import { ExperienceModRateForm } from "@/components/ExperienceModRateForm";
import { ExperienceModRateRow, type ExperienceModRateStanding } from "@/components/ExperienceModRateRow";
import { Disclosure } from "@/components/Disclosure";
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
    // Density audit #25: one status line with Record beside it; what an EMR
    // is, and the rates on file, one click down.
    <section className="mb-8" data-tour="compliance-mod-rate">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink" data-emr-status>
          <span className="font-semibold text-ink-label">Experience modification rate</span>
          {" · "}
          {current ? (
            <>
              Current rate <span className="font-semibold">{current.rate}</span>, effective {current.effectiveDate},
              issued by {current.source}.
            </>
          ) : history.length > 0 ? (
            <span className="text-ink-body">
              No rate on file has taken effect yet. The earliest one recorded starts {upcoming[0]?.effectiveDate}.
            </span>
          ) : (
            <span className="text-ink-body">No mod rate on file</span>
          )}
        </p>
        <ExperienceModRateForm />
      </div>

      {current && currentIsPastItsPolicyYear && (
        <p className="mb-2 text-sm text-tag-amber-ink">
          That policy year ended {policyYearEnd(current.effectiveDate)} — this is the newest rate in force, not
          necessarily this year&apos;s.{" "}
          {/* Review finding: this always said "record the new one", even
              with the next rate already on file directly below it. */}
          {upcoming[0]
            ? `The next rate on file, ${upcoming[0].rate}, starts ${upcoming[0].effectiveDate}.`
            : "Record the new one when the bureau issues it."}
        </p>
      )}

      {history.length > 0 && (
        <Disclosure variant="plain" summary={`Rates on file · ${history.length}`} className="mb-2">
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
        </Disclosure>
      )}

      <Disclosure variant="plain" summary="What the EMR is, and where it comes from">
        <p className="text-sm text-ink-body">
          The mod rate on your workers&apos; comp, as the rating bureau issued it — the figure a GC asks for on a
          prequalification form.
        </p>
        <p className="mt-2 text-sm text-ink-body">
          This app never computes or estimates an EMR. It comes from the rating bureau — NCCI or your state&apos;s
          bureau — through your carrier or broker, on a rating worksheet. The OSHA log on the Safety page is part
          of what a bureau calculates one from, but it is not the rate. Record the rate on the worksheet with the
          button above.
        </p>
      </Disclosure>
    </section>
  );
}
