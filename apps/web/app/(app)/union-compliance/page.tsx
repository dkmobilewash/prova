import Link from "next/link";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import {
  loadRatioReviews,
  loadRemittance,
  loadUnionSetup,
  loadWorkerCrafts,
  monthBounds,
} from "@/lib/union-compliance-query";
import { UnionLocalForm } from "@/components/UnionLocalForm";
import { UnionLocalCard } from "@/components/UnionLocalCard";
import { ratioLabel } from "@/lib/apprentice-ratio";
import { money } from "@/lib/money";
import { formatHours } from "@/lib/render-hours";
import { isWhollyUnpriced } from "@/lib/fringe-remittance";
import { loadApprenticeships, loadTeamForApprenticeship } from "@/lib/apprenticeship-query";
import { ApprenticeshipForm } from "@/components/ApprenticeshipForm";
import { ApprenticeshipPanel } from "@/components/ApprenticeshipPanel";
import { WorkerCraftsPanel } from "@/components/WorkerCraftsPanel";

const STATUS_TONE: Record<string, string> = {
  WITHIN: "text-tag-green-ink",
  OVER: "text-tag-rose-ink",
  NO_JOURNEYMAN: "text-tag-rose-ink",
  INCOMPLETE: "text-tag-amber-ink",
  NOT_APPLICABLE: "text-ink-muted",
};

const STATUS_LABEL: Record<string, string> = {
  WITHIN: "within ratio",
  OVER: "over ratio",
  NO_JOURNEYMAN: "apprentice on site with no journeyman",
  INCOMPLETE: "can't be judged",
  NOT_APPLICABLE: "no apprentice hours",
};

export default async function UnionCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company, ...currentUser } = context;

  const { month: monthParam } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "")
    ? (monthParam as string)
    : new Date().toISOString().slice(0, 7);
  const { start, end } = monthBounds(month);

  const [setup, remittance, ratioReviews, apprenticeships, team, workerCrafts] = await Promise.all([
    loadUnionSetup(company.id),
    loadRemittance(company.id, month),
    loadRatioReviews(company.id, month),
    // Not scoped to the selected month: an indenture runs for years, and
    // the current period's hours are counted from the last sign-off, not
    // from whichever month this page happens to be showing.
    loadApprenticeships(company.id, new Date().toISOString().slice(0, 10)),
    loadTeamForApprenticeship(company.id),
    loadWorkerCrafts(company.id),
  ]);

  const crafts = setup.flatMap((local) => local.crafts);
  const untiered = crafts.filter((craft) => craft.tier === null);
  const unpriced = crafts.filter((craft) => craft.schedules.length === 0);
  const today = new Date().toISOString().slice(0, 10);
  const flagged = ratioReviews.filter((r) => r.summary.daysOver > 0);
  const incomplete = ratioReviews.filter((r) => r.summary.daysIncomplete > 0);

  const previousMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 2, 1));
    return date.toISOString().slice(0, 7);
  })();
  const nextMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    const date = new Date(Date.UTC(y, m, 1));
    return date.toISOString().slice(0, 7);
  })();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Union fringe &amp; apprenticeship</h1>
      <p className="mb-2 text-sm text-ink-body">
        What is owed to the trust funds this month, and whether the crews ran within their
        apprentice-to-journeyman ratio. Both computed from the hours actually logged — nothing here
        is stored, and nothing here files anything for you.
      </p>
      <p className="mb-6 text-xs text-ink-muted">
        Ratios are checked <span className="text-ink-body">per day</span>, because that is how the
        rule is written: a crew that runs two apprentices to one journeyman on Monday is out of ratio
        on Monday, and a monthly average would hide the exact day an inspector asks about. Hours on a
        craft with no tier recorded are never counted as journeyman hours — the day reads{" "}
        <span className="text-ink-body">can&apos;t be judged</span> instead, so a half-configured
        company never gets a clean bill of health.
      </p>

      <div className="mb-6 flex items-center gap-3" data-tour="uc-month">
        <Link href={`/union-compliance?month=${previousMonth}`} className="text-sm text-link">
          ← {previousMonth}
        </Link>
        <span className="text-sm text-ink-label">
          {start} to {end}
        </span>
        <Link href={`/union-compliance?month=${nextMonth}`} className="text-sm text-link">
          {nextMonth} →
        </Link>
      </div>

      {/* ------------------------------------------------ remittance --- */}
      <section className="mb-10" data-tour="uc-remittance">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-label">Fringe remittance</h2>
          <span className={`text-xs ${remittance.filed ? "text-tag-green-ink" : "text-tag-amber-ink"}`}>
            {remittance.filed
              ? "A filing covering this whole month is on record"
              : "No filing covering this whole month on record"}
          </span>
        </div>

        <p className="mb-3 text-xs text-ink-muted">
          A rate hangs off the <span className="text-ink-body">classification</span>, not its tier,
          so hours can be priced here on a day the ratio below can&apos;t judge. The two answer
          different questions — what is owed to the funds, and whether the crew was within ratio —
          and one being unanswerable doesn&apos;t make the other so.
        </p>

        {remittance.locals.length === 0 ? (
          <p className="text-sm text-ink-body">
            No hours logged this month against a craft classification, so there is nothing to remit.
          </p>
        ) : (
          <div className="space-y-4">
            {remittance.locals.map((local) => {
              // #104 finding 2: isWhollyUnpriced already guarded every
              // craft ROW below (that guard is why a row never prints
              // $0.00 for hours nobody could price) but not this header —
              // so a local whose every craft was unpriced still showed a
              // confident "$0.00" total above a table of dashes, the exact
              // false "nothing owed" statement the row-level guard exists
              // to prevent. Same check, applied one level up.
              const localBlank = isWhollyUnpriced(local);
              return (
              <div key={local.unionLocalId} className="rounded-lg border border-line-card bg-surface p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-ink">{local.unionLocalLabel}</p>
                  <p className="font-mono text-ink">
                    {localBlank ? <span className="text-ink-muted">— not yet priced</span> : money(local.total)}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead className="text-xs uppercase tracking-wide text-ink-muted">
                      <tr>
                        <th className="py-1 text-left font-medium">Classification</th>
                        <th className="py-1 text-right font-medium">Hours</th>
                        <th className="py-1 text-right font-medium">Pension</th>
                        <th className="py-1 text-right font-medium">Vacation</th>
                        <th className="py-1 text-right font-medium">H&amp;W</th>
                        <th className="py-1 text-right font-medium">Training</th>
                        <th className="py-1 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="text-ink-label">
                      {local.crafts.map((craft) => {
                        // Nothing on this row could be priced. Printing
                        // $0.00 five times reads as "nothing owed", which
                        // is the opposite of what is known — see
                        // isWhollyUnpriced.
                        const blank = isWhollyUnpriced(craft);
                        const cell = (value: number) =>
                          blank ? <span className="text-ink-muted">—</span> : money(value);
                        return (
                        <tr key={craft.craftClassificationId} className="border-t border-line-row">
                          <td className="py-1.5">
                            {craft.craftLabel}
                            {craft.uncomputedHours > 0 && (
                              <span className="ml-2 text-xs text-tag-amber-ink">
                                {formatHours(craft.uncomputedHours)} hrs unpriced
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{formatHours(craft.hours)}</td>
                          <td className="py-1.5 text-right tabular-nums">{cell(craft.components.pension)}</td>
                          <td className="py-1.5 text-right tabular-nums">{cell(craft.components.vacation)}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {cell(craft.components.healthWelfare)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{cell(craft.components.training)}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums">{cell(craft.total)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              );
            })}

            <p className="text-sm text-ink-body">
              <span className="font-mono text-ink-label">{money(remittance.total)}</span> across{" "}
              {formatHours(remittance.totalHours)} hours.
              {remittance.uncomputedHours > 0 && (
                <span className="text-tag-amber-ink">
                  {" "}
                  {formatHours(remittance.uncomputedHours)} of those hours could not be priced — no craft tag, or no
                  rate schedule in force on the day — so this total is short by whatever they are
                  worth. {remittance.uncomputedNames.join(", ")}.
                </span>
              )}
            </p>
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- ratio --- */}
      <section className="mb-10" data-tour="uc-ratio">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Apprentice ratio</h2>

        {ratioReviews.length === 0 ? (
          <p className="text-sm text-ink-body">No hours logged this month.</p>
        ) : (
          <div className="space-y-4">
            {(flagged.length > 0 || incomplete.length > 0) && (
              <p className="text-sm text-ink-body">
                {flagged.length > 0 && (
                  <span className="text-tag-rose-ink">
                    {flagged.length} {flagged.length === 1 ? "job" : "jobs"} went over the ratio.{" "}
                  </span>
                )}
                {incomplete.length > 0 && (
                  <span className="text-tag-amber-ink">
                    {incomplete.length} {incomplete.length === 1 ? "job has" : "jobs have"} days that
                    can&apos;t be judged.
                  </span>
                )}
              </p>
            )}

            {ratioReviews.map((review) => (
              <div
                key={`${review.jobId}-${review.unionLocalId}`}
                className="rounded-lg border border-line-card bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/jobs/${review.jobId}`} className="text-ink">
                    {review.jobName}
                  </Link>
                  <span className="text-xs text-ink-muted">{review.unionLocalLabel}</span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {review.rule ? (
                    <>
                      {ratioLabel(review.rule)}
                      {review.rule.programStandardReference && ` · ${review.rule.programStandardReference}`}
                    </>
                  ) : (
                    <span className="text-tag-amber-ink">
                      No ratio rule recorded for this local — nothing to measure against
                    </span>
                  )}
                </p>

                <ul className="mt-2 flex flex-col gap-1">
                  {review.days
                    .filter((day) => day.status !== "NOT_APPLICABLE")
                    .map((day) => (
                      <li key={day.date} className="text-sm">
                        <span className="font-mono text-xs text-ink-muted">{day.date}</span>{" "}
                        <span className={STATUS_TONE[day.status]}>{STATUS_LABEL[day.status]}</span>
                        <span className="text-ink-muted">
                          {" "}
                          · {formatHours(day.journeymanHours)} jrny / {formatHours(day.apprenticeHours)} appr
                          {day.allowedApprenticeHours !== null && ` (allows ${formatHours(day.allowedApprenticeHours)})`}
                          {day.unclassifiedHours > 0 &&
                            ` · ${formatHours(day.unclassifiedHours)} hrs unclassified: ${day.unclassifiedNames.join(", ")}`}
                        </span>
                      </li>
                    ))}
                  {review.days.every((day) => day.status === "NOT_APPLICABLE") && (
                    <li className="text-sm text-ink-muted">No apprentice hours this month.</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --------------------------------------- apprenticeship --- */}
      <section className="mb-10" data-tour="uc-apprenticeships">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">Apprenticeship programmes</h2>
        <p className="mb-3 text-xs text-ink-muted">
          The registration itself — sponsor, programme number, classroom hours and the sign-offs
          that close a period. On-the-job hours are read from the timesheets and stored nowhere
          here; a period is closed by a signature, never by an hour count reaching a line.
        </p>
        <p className="mb-3 text-xs text-tag-amber-ink/80">
          {/* Browser testing found this section reading "30 hrs" inches from
              "No hours logged this month" for the same person. Both were true
              under different windows, and nothing said so. */}
          Ignores the month selected above. An indenture runs for years, so these hours are
          counted from the current period&apos;s start — not from the month the rest of this page
          is showing.
        </p>
        <div className="mb-3">
          <ApprenticeshipForm
            team={team}
            crafts={crafts.map((c) => ({ id: c.id, label: c.name }))}
          />
        </div>
        <ApprenticeshipPanel rows={apprenticeships} canDelete={currentUser.role === "OWNER"} />
      </section>

      {/* ------------------------------------------ who works as what --- */}
      <section className="mb-8" data-tour="uc-worker-crafts">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">Who works under each craft</h2>
        <p className="mb-3 text-xs text-ink-muted">
          The phone&apos;s craft picker shows each person only the crafts ticked for them — one
          ticked craft is picked for them automatically. Nobody ticked for a person means they are
          shown every craft, so this never stops anyone logging hours.
        </p>
        <WorkerCraftsPanel
          people={workerCrafts}
          crafts={crafts.map((c) => ({ id: c.id, label: c.name }))}
        />
      </section>

      {/* ----------------------------------------------------- setup --- */}
      <section data-tour="uc-setup">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-label">Locals, classifications and rates</h2>
          <span className="text-xs text-ink-muted">
            {untiered.length > 0 && (
              <span className="text-tag-amber-ink">
                {untiered.length} classification{untiered.length === 1 ? "" : "s"} not tiered
              </span>
            )}
            {untiered.length > 0 && unpriced.length > 0 && " · "}
            {unpriced.length > 0 && (
              <span className="text-tag-amber-ink">
                {unpriced.length} with no rate
              </span>
            )}
          </span>
        </div>

        <p className="mb-3 text-xs text-ink-muted">
          Everything above reads from here. A classification with no tier can&apos;t be counted on
          either side of a ratio, and one with no rate in force on a date can&apos;t be priced — both
          are reported as such rather than guessed.
        </p>

        <div className="mb-4">
          <UnionLocalForm />
        </div>

        {setup.length === 0 ? (
          <p className="text-ink-body">
            No locals recorded. Add the one you work under and its classifications — nothing here is
            seeded, because there is no verified source for real local numbers and a wrong entry would
            attribute your CBA to the wrong hall.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {setup.map((local) => (
              <UnionLocalCard
                key={local.agreementId}
                local={local}
                today={today}
                canDelete={currentUser.role === "OWNER"}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
