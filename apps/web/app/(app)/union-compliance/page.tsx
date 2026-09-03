import Link from "next/link";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { loadRatioReviews, loadRemittance, loadUnionSetup, monthBounds } from "@/lib/union-compliance-query";
import { UnionLocalForm } from "@/components/UnionLocalForm";
import { UnionLocalCard } from "@/components/UnionLocalCard";
import { ratioLabel } from "@/lib/apprentice-ratio";
import { money } from "@/lib/money";
import { isWhollyUnpriced } from "@/lib/fringe-remittance";
import { loadApprenticeships, loadTeamForApprenticeship } from "@/lib/apprenticeship-query";
import { ApprenticeshipForm } from "@/components/ApprenticeshipForm";
import { ApprenticeshipPanel } from "@/components/ApprenticeshipPanel";

const STATUS_TONE: Record<string, string> = {
  WITHIN: "text-green-300",
  OVER: "text-red-300",
  NO_JOURNEYMAN: "text-red-300",
  INCOMPLETE: "text-amber-300",
  NOT_APPLICABLE: "text-slate-500",
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

  const [setup, remittance, ratioReviews, apprenticeships, team] = await Promise.all([
    loadUnionSetup(company.id),
    loadRemittance(company.id, month),
    loadRatioReviews(company.id, month),
    // Not scoped to the selected month: an indenture runs for years, and
    // the current period's hours are counted from the last sign-off, not
    // from whichever month this page happens to be showing.
    loadApprenticeships(company.id, new Date().toISOString().slice(0, 10)),
    loadTeamForApprenticeship(company.id),
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
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Union fringe &amp; apprenticeship</h1>
      <p className="mb-2 text-sm text-slate-400">
        What is owed to the trust funds this month, and whether the crews ran within their
        apprentice-to-journeyman ratio. Both computed from the hours actually logged — nothing here
        is stored, and nothing here files anything for you.
      </p>
      <p className="mb-6 text-xs text-slate-500">
        Ratios are checked <span className="text-slate-400">per day</span>, because that is how the
        rule is written: a crew that runs two apprentices to one journeyman on Monday is out of ratio
        on Monday, and a monthly average would hide the exact day an inspector asks about. Hours on a
        craft with no tier recorded are never counted as journeyman hours — the day reads{" "}
        <span className="text-slate-400">can&apos;t be judged</span> instead, so a half-configured
        company never gets a clean bill of health.
      </p>

      <div className="mb-6 flex items-center gap-3">
        <Link href={`/union-compliance?month=${previousMonth}`} className="text-sm text-blue-400">
          ← {previousMonth}
        </Link>
        <span className="text-sm text-slate-300">
          {start} to {end}
        </span>
        <Link href={`/union-compliance?month=${nextMonth}`} className="text-sm text-blue-400">
          {nextMonth} →
        </Link>
      </div>

      {/* ------------------------------------------------ remittance --- */}
      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">Fringe remittance</h2>
          <span className={`text-xs ${remittance.filed ? "text-green-300" : "text-amber-300"}`}>
            {remittance.filed
              ? "A filing covering this whole month is on record"
              : "No filing covering this whole month on record"}
          </span>
        </div>

        <p className="mb-3 text-xs text-slate-500">
          A rate hangs off the <span className="text-slate-400">classification</span>, not its tier,
          so hours can be priced here on a day the ratio below can&apos;t judge. The two answer
          different questions — what is owed to the funds, and whether the crew was within ratio —
          and one being unanswerable doesn&apos;t make the other so.
        </p>

        {remittance.locals.length === 0 ? (
          <p className="text-sm text-slate-400">
            No hours logged this month against a craft classification, so there is nothing to remit.
          </p>
        ) : (
          <div className="space-y-4">
            {remittance.locals.map((local) => (
              <div key={local.unionLocalId} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-slate-100">{local.unionLocalLabel}</p>
                  <p className="font-mono text-slate-100">{money(local.total)}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-500">
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
                    <tbody className="text-slate-300">
                      {local.crafts.map((craft) => {
                        // Nothing on this row could be priced. Printing
                        // $0.00 five times reads as "nothing owed", which
                        // is the opposite of what is known — see
                        // isWhollyUnpriced.
                        const blank = isWhollyUnpriced(craft);
                        const cell = (value: number) =>
                          blank ? <span className="text-slate-600">—</span> : money(value);
                        return (
                        <tr key={craft.craftClassificationId} className="border-t border-slate-800">
                          <td className="py-1.5">
                            {craft.craftLabel}
                            {craft.uncomputedHours > 0 && (
                              <span className="ml-2 text-xs text-amber-300">
                                {craft.uncomputedHours} hrs unpriced
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{craft.hours}</td>
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
            ))}

            <p className="text-sm text-slate-400">
              <span className="font-mono text-slate-200">{money(remittance.total)}</span> across{" "}
              {remittance.totalHours} hours.
              {remittance.uncomputedHours > 0 && (
                <span className="text-amber-300">
                  {" "}
                  {remittance.uncomputedHours} of those hours could not be priced — no craft tag, or no
                  rate schedule in force on the day — so this total is short by whatever they are
                  worth. {remittance.uncomputedNames.join(", ")}.
                </span>
              )}
            </p>
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- ratio --- */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Apprentice ratio</h2>

        {ratioReviews.length === 0 ? (
          <p className="text-sm text-slate-400">No hours logged this month.</p>
        ) : (
          <div className="space-y-4">
            {(flagged.length > 0 || incomplete.length > 0) && (
              <p className="text-sm text-slate-400">
                {flagged.length > 0 && (
                  <span className="text-red-300">
                    {flagged.length} {flagged.length === 1 ? "job" : "jobs"} went over the ratio.{" "}
                  </span>
                )}
                {incomplete.length > 0 && (
                  <span className="text-amber-300">
                    {incomplete.length} {incomplete.length === 1 ? "job has" : "jobs have"} days that
                    can&apos;t be judged.
                  </span>
                )}
              </p>
            )}

            {ratioReviews.map((review) => (
              <div
                key={`${review.jobId}-${review.unionLocalId}`}
                className="rounded-lg border border-slate-800 bg-slate-900 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/jobs/${review.jobId}`} className="text-slate-100">
                    {review.jobName}
                  </Link>
                  <span className="text-xs text-slate-500">{review.unionLocalLabel}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {review.rule ? (
                    <>
                      {ratioLabel(review.rule)}
                      {review.rule.programStandardReference && ` · ${review.rule.programStandardReference}`}
                    </>
                  ) : (
                    <span className="text-amber-300">
                      No ratio rule recorded for this local — nothing to measure against
                    </span>
                  )}
                </p>

                <ul className="mt-2 flex flex-col gap-1">
                  {review.days
                    .filter((day) => day.status !== "NOT_APPLICABLE")
                    .map((day) => (
                      <li key={day.date} className="text-sm">
                        <span className="font-mono text-xs text-slate-500">{day.date}</span>{" "}
                        <span className={STATUS_TONE[day.status]}>{STATUS_LABEL[day.status]}</span>
                        <span className="text-slate-500">
                          {" "}
                          · {day.journeymanHours} jrny / {day.apprenticeHours} appr
                          {day.allowedApprenticeHours !== null && ` (allows ${day.allowedApprenticeHours})`}
                          {day.unclassifiedHours > 0 &&
                            ` · ${day.unclassifiedHours} hrs unclassified: ${day.unclassifiedNames.join(", ")}`}
                        </span>
                      </li>
                    ))}
                  {review.days.every((day) => day.status === "NOT_APPLICABLE") && (
                    <li className="text-sm text-slate-500">No apprentice hours this month.</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --------------------------------------- apprenticeship --- */}
      <section className="mb-10">
        <h2 className="mb-1 text-sm font-semibold text-slate-300">Apprenticeship programmes</h2>
        <p className="mb-3 text-xs text-slate-500">
          The registration itself — sponsor, programme number, classroom hours and the sign-offs
          that close a period. On-the-job hours are read from the timesheets and stored nowhere
          here; a period is closed by a signature, never by an hour count reaching a line.
        </p>
        <p className="mb-3 text-xs text-amber-300/80">
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

      {/* ----------------------------------------------------- setup --- */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">Locals, classifications and rates</h2>
          <span className="text-xs text-slate-500">
            {untiered.length > 0 && (
              <span className="text-amber-300">
                {untiered.length} classification{untiered.length === 1 ? "" : "s"} not tiered
              </span>
            )}
            {untiered.length > 0 && unpriced.length > 0 && " · "}
            {unpriced.length > 0 && (
              <span className="text-amber-300">
                {unpriced.length} with no rate
              </span>
            )}
          </span>
        </div>

        <p className="mb-3 text-xs text-slate-500">
          Everything above reads from here. A classification with no tier can&apos;t be counted on
          either side of a ratio, and one with no rate in force on a date can&apos;t be priced — both
          are reported as such rather than guessed.
        </p>

        <div className="mb-4">
          <UnionLocalForm />
        </div>

        {setup.length === 0 ? (
          <p className="text-slate-400">
            No locals recorded. Add the one you work under and its classifications — nothing here is
            seeded, because there is no verified source for real local numbers and a wrong entry would
            attribute your CBA to the wrong hall.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
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
