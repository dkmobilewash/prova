import Link from "next/link";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import {
  loadDeterminations,
  loadReviewableWeeks,
  reviewJobWeek,
} from "@/lib/prevailing-wage-query";
import { loadRuleSets } from "@/lib/prevailing-wage-query";
import { RuleSetForm } from "@/components/RuleSetForm";
import { RuleSetRow } from "@/components/RuleSetRow";
import { DeterminationRuleSetPicker } from "@/components/DeterminationRuleSetPicker";
import { splitLabel } from "@/components/prevailingWageLabels";

export default async function PrevailingWagePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; week?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company, ...currentUser } = context;

  const { job: jobParam, week: weekParam } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const [ruleSets, determinations, weeks] = await Promise.all([
    loadRuleSets(company.id),
    loadDeterminations(company.id),
    loadReviewableWeeks(company.id),
  ]);

  const selected =
    weeks.find((w) => w.jobId === jobParam && w.weekStart === weekParam) ?? weeks[0] ?? null;
  const review = selected
    ? await reviewJobWeek(company.id, selected.jobId, selected.weekStart)
    : null;

  const options = ruleSets.map((rs) => ({ id: rs.id, name: rs.name, jurisdiction: rs.jurisdiction }));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Prevailing wage rules</h1>
      <p className="mb-2 text-sm text-ink-body">
        The rules a jurisdiction sets — when an hour becomes overtime, when it becomes double time,
        how soon the report is due — recorded per jurisdiction and per date range, then applied to
        the hours your crews actually logged.
      </p>
      <p className="mb-6 text-xs text-ink-muted">
        <span className="text-ink-body">These are rules, never rates.</span> There is no
        prevailing-wage dataset in this app and nothing here is seeded: every threshold is one you
        enter from the awarding body&apos;s own documents, with the citation next to it. A blank
        threshold means nobody has looked it up, and a week is then reported as{" "}
        <span className="text-ink-body">unchecked</span> rather than measured against a number we
        invented. Nothing here rewrites a time entry — it reports where what was entered and what
        the rules imply disagree, and a person decides which is wrong.
      </p>

      {/* --------------------------------------------------- review --- */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Check a week against the rules</h2>

        {weeks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-card bg-surface/50 p-5 text-sm text-ink-body">
            No hours logged on a job that carries a wage determination. Only those jobs are checked —
            certified payroll isn&apos;t required on private work, and offering to review every week
            would bury the ones that matter.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {weeks.slice(0, 12).map((week) => {
                const active = selected?.jobId === week.jobId && selected?.weekStart === week.weekStart;
                return (
                  <Link
                    key={`${week.jobId}-${week.weekStart}`}
                    href={`/prevailing-wage?job=${week.jobId}&week=${week.weekStart}`}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      active
                        ? "border-brand text-link"
                        : "border-line-card text-ink-label hover:bg-neutral-100"
                    }`}
                  >
                    {week.jobName} · week of {week.weekStart}
                  </Link>
                );
              })}
            </div>

            {review && (
              <div className="rounded-lg border border-line-card bg-surface p-4">
                <p className="mb-3 text-sm text-ink-label">
                  {review.jobName} · week of {selected?.weekStart}
                  {review.ruleSetName ? (
                    <span className="text-ink-muted"> · {review.ruleSetName}</span>
                  ) : (
                    <span className="text-tag-amber-ink"> · no rules attached to this job</span>
                  )}
                </p>

                {review.employees.length === 0 ? (
                  <p className="text-sm text-ink-body">No hours logged that week.</p>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {review.employees.map((employee) => (
                      <li key={employee.employeeUserId}>
                        <p className="text-sm font-medium text-ink-label">
                          {employee.employeeName}
                          <span className="ml-2 font-normal text-ink-muted">
                            {employee.review.totalHours} hrs
                          </span>
                        </p>

                        {!employee.review.checked ? (
                          <p className="mt-1 text-sm text-tag-amber-ink">{employee.review.reason}</p>
                        ) : employee.review.disagreements.length === 0 ? (
                          <p className="mt-1 text-sm text-tag-green-ink">
                            Every day matches what the rules imply.
                            {employee.review.weeklyThresholdApplied &&
                              " The weekly threshold was reached and the entered hours already reflect it."}
                          </p>
                        ) : (
                          <ul className="mt-1 flex flex-col gap-1">
                            {employee.review.disagreements.map((day) => (
                              <li key={day.date} className="text-sm text-ink-label">
                                <span className="font-mono text-xs text-ink-muted">{day.date}</span>{" "}
                                entered <span className="text-tag-amber-ink">{splitLabel(day.entered)}</span>,
                                rules imply{" "}
                                <span className="text-tag-blue-ink">
                                  {splitLabel(day.expected as Record<string, number>)}
                                </span>
                                {day.consecutiveDay === 7 && (
                                  <span className="text-ink-muted"> · seventh straight day</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        {employee.review.days.some((d) => d.skipped === "SHIFT_DIFFERENTIAL") && (
                          <p className="mt-1 text-xs text-ink-muted">
                            Days with shift-differential hours are shown but not judged — that premium
                            is for when the shift ran, not how long it was.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-3 text-xs text-ink-muted">
                  A disagreement is not proof the timesheet is wrong. It means the entered pay types
                  and the recorded rules don&apos;t agree, and one of the two needs fixing.
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---------------------------------------------- attachments --- */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Which rules apply to which job</h2>
        {determinations.length === 0 ? (
          <p className="text-sm text-ink-body">
            No wage determinations recorded yet. Upload one on a job first — the determination is what
            says the job is prevailing wage at all.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {determinations.map((determination) => (
              <li
                key={determination.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link href={`/jobs/${determination.jobId}`} className="text-ink">
                    {determination.jobName}
                  </Link>
                  <p className="text-sm text-ink-muted">{determination.jurisdiction}</p>
                </div>
                <DeterminationRuleSetPicker
                  determinationId={determination.id}
                  current={determination.ruleSetId}
                  options={options}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------ rule sets --- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-label">
            {ruleSets.length} rule {ruleSets.length === 1 ? "set" : "sets"}
          </h2>
        </div>
        <div className="mb-4">
          <RuleSetForm />
        </div>

        {ruleSets.length === 0 ? (
          <p className="text-ink-body">
            Nothing recorded. Start with the jurisdiction you work in most — name it, put in the
            thresholds you can cite, and leave the rest blank.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {ruleSets.map((ruleSet) => (
              <RuleSetRow
                key={ruleSet.id}
                ruleSet={ruleSet}
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
