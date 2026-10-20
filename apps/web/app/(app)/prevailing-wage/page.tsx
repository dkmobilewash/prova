import Link from "next/link";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
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
import { formatHours } from "@/lib/render-hours";
import { reviewIsClean, weeklyUnresolvedSentence } from "@/lib/prevailing-wage";
import { viewerToday } from "@/lib/viewerToday";
import { determinationStanding, determinationStandingLine } from "@/lib/determination-standing";
import { DeterminationStandingLine } from "@/components/DeterminationStandingLine";
import { Disclosure } from "@/components/Disclosure";
import { PageTabs } from "@/components/PageTabs";

// The week check is the page's job; the rules and the job → rule-set mapping
// are setup you visit once in a while (density audit #22).
const TABS = [
  { href: "/prevailing-wage", label: "Check a week" },
  { href: "/prevailing-wage?tab=setup", label: "Rules & jobs" },
] as const;

export const metadata = { title: "Prevailing wage" };

export default async function PrevailingWagePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; week?: string; tab?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company, ...currentUser } = context;

  const { job: jobParam, week: weekParam, tab } = await searchParams;
  const onSetup = tab === "setup";
  const today = await viewerToday();

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
    <PageShell width="working">
      <PageHeader
        route="/prevailing-wage"
        subtitle="A jurisdiction's overtime, double-time and reporting rules, applied to the hours your crews actually logged."
      />
      <Disclosure variant="plain" summary="How these rules work · rules, never rates" className="mb-4">
        <p className="text-xs text-ink-muted">
          <span className="text-ink-body">These are rules, never rates.</span> There is no
          prevailing-wage dataset in this app and nothing here is seeded: every threshold is one you
          enter from the awarding body&apos;s own documents, with the citation next to it. A blank
          threshold means nobody has looked it up, and a week is then reported as{" "}
          <span className="text-ink-body">unchecked</span> rather than measured against a number we
          invented. Nothing here rewrites a time entry — it reports where what was entered and what
          the rules imply disagree, and a person decides which is wrong.
        </p>
      </Disclosure>
      <PageTabs tabs={TABS} label="Prevailing wage sections" />

      {/* --------------------------------------------------- review --- */}
      {!onSetup && (
      <section className="mb-10" data-tour="pw-check-week">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Check a week against the rules</h2>

        {weeks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-card bg-surface/50 p-5 text-sm text-ink-body">
            <p>
              No hours logged on a job that carries a wage determination. Only those jobs are
              checked — certified payroll isn&apos;t required on private work, and offering to
              review every week would bury the ones that matter.
            </p>
            {/* Two things have to be true before a week can appear here, so
                the way out is two links rather than one: the job needs a
                determination on it, and somebody needs to have logged hours.
                Naming only the first would send a reader who has already
                done it round in a circle. */}
            <p className="mt-3">
              <Link href="/jobs" className="text-link hover:underline">
                Open the job
              </Link>{" "}
              and add its determination under Compliance, then log the crew&apos;s hours under
              Crew &amp; time.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {weeks.slice(0, 12).map((week) => {
                const active = selected?.jobId === week.jobId && selected?.weekStart === week.weekStart;
                return (
                  <Link
                    key={`${week.jobId}-${week.weekStart}`}
                    href={`/prevailing-wage?job=${week.jobId}&week=${week.weekStart}`}
                    className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm mouse:min-h-8 ${
                      active
                        ? "border-brand text-link"
                        : "border-line-card text-ink-label hover:bg-rail-hover"
                    }`}
                  >
                    {week.jobName} · week of {week.weekStart}
                  </Link>
                );
              })}
            </div>

            {review && (
              <div className="rounded-xl border border-line-card bg-surface p-4">
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
                  <ul>
                    {review.employees.map((employee) => (
                      // One line per worker — name, hours, verdict — opening
                      // to the days (density audit #22).
                      <li key={employee.employeeUserId}>
                        <Disclosure
                          variant="row"
                          summary={
                            <span className="text-sm font-medium text-ink-label">
                              {employee.employeeName}
                              <span className="ml-2 font-normal text-ink-muted">
                                {formatHours(employee.review.totalHours)} hrs
                              </span>
                              <span data-pw-verdict className="ml-2 font-normal">
                                {weekVerdict(employee.review)}
                              </span>
                            </span>
                          }
                        >

                        {/* The green sentence is gated on `reviewIsClean`,
                            NOT on `disagreements.length === 0`. A week whose
                            overtime lands on shift-differential hours has no
                            disagreements to list and is not clean — it used
                            to print "Every day matches" over a DOL
                            back-wage finding. See WeekReview.weeklyUnresolved. */}
                        {!employee.review.checked ? (
                          <p className="mt-1 text-sm text-tag-amber-ink">{employee.review.reason}</p>
                        ) : (
                          <>
                            {employee.review.weeklyUnresolved.length > 0 && (
                              <p className="mt-1 text-sm text-tag-amber-ink">
                                {weeklyUnresolvedSentence(employee.review)}
                              </p>
                            )}
                            {reviewIsClean(employee.review) && (
                              <p className="mt-1 text-sm text-tag-green-ink">
                                Every day matches what the rules imply.
                                {employee.review.weeklyThresholdApplied &&
                                  " The weekly threshold was reached and the entered hours already reflect it."}
                              </p>
                            )}
                            {employee.review.disagreements.length > 0 && (
                              <ul className="mt-1 flex flex-col gap-1">
                                {employee.review.disagreements.map((day) => (
                                  <li key={day.date} className="text-sm text-ink-label">
                                    <span className="font-mono text-xs text-ink-muted">{day.date}</span>{" "}
                                    entered <span className="text-tag-amber-ink">{splitLabel(day.entered)}</span>,
                                    rules imply{" "}
                                    <span className="text-tag-brand-ink">
                                      {splitLabel(day.expected as Record<string, number>)}
                                    </span>
                                    {day.consecutiveDay === 7 && (
                                      <span className="text-ink-muted"> · seventh straight day</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}

                        {employee.review.days.some((d) => d.skipped === "SHIFT_DIFFERENTIAL") && (
                          <p className="mt-1 text-xs text-ink-muted">
                            Days with shift-differential hours are shown but not judged — that premium
                            is for when the shift ran, not how long it was.
                          </p>
                        )}
                        </Disclosure>
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
      )}

      {onSetup && (
      <>
      {/* ---------------------------------------------- attachments --- */}
      <section className="mb-10" data-tour="pw-which-job">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Which rules apply to which job</h2>
        {determinations.length === 0 ? (
          // This sentence NAMED the way out and then did not give it —
          // "Upload one on a job first" with nothing to press. A reader who
          // does not already know that a determination is attached from the
          // job's Compliance tab has been told what to do and not where.
          <p className="text-sm text-ink-body">
            No wage determinations recorded yet — the determination is what says the job is
            prevailing wage at all.{" "}
            <Link href="/jobs" className="text-link hover:underline">
              Open the job
            </Link>{" "}
            and add it under Compliance.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface">
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
                  {/* The same sentence the job's Compliance tab shows, so a
                      stale determination is visible from the compliance side
                      too. Derived here from the entered dates against the
                      viewer's day; the dates themselves are entered on the
                      job's Compliance tab. */}
                  <DeterminationStandingLine
                    className="mt-1"
                    line={determinationStandingLine(
                      determinationStanding(determination.facts, determination.job, today),
                    )}
                  />
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
        <div className="mb-4" data-tour="pw-record-rules">
          <RuleSetForm />
        </div>

        {ruleSets.length === 0 ? (
          <p className="text-ink-body">
            Nothing recorded. Start with the jurisdiction you work in most — name it, put in the
            thresholds you can cite, and leave the rest blank.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface" data-tour="pw-rule-sets">
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
      </>
      )}
    </PageShell>
  );
}

/** The closed row's verdict. Wording only — `reviewIsClean` decides "matches",
 * exactly as the green sentence inside does. */
function weekVerdict(review: Parameters<typeof reviewIsClean>[0]) {
  if (!review.checked) return <span className="text-tag-amber-ink">unchecked</span>;
  if (reviewIsClean(review)) return <span className="text-tag-green-ink">matches</span>;
  const n = review.disagreements.length;
  if (n > 0) return <span className="text-tag-amber-ink">{n} {n === 1 ? "day disagrees" : "days disagree"}</span>;
  return <span className="text-tag-amber-ink">weekly hours unresolved</span>;
}
