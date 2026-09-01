import Link from "next/link";
import { Card, StatusBadge } from "@prova/ui";
import { JobStatus, Prisma, prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { estimateStage } from "@/lib/estimate-stage";
import { money } from "@/lib/money";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { renewalAlerts, renewalTiming } from "@/lib/compliance-expiry";
import { serverToday } from "@/lib/serverToday";
import { loadTodayDashboard } from "@/lib/today-dashboard";
import { AskPanel } from "@/components/AskPanel";
import {
  ReceivablesDetailPanel,
  ReceivablesList,
  ReceivablesProvider,
} from "@/components/ReceivablesPanel";

/**
 * Today.
 *
 * This page used to be a searchable table of jobs and nothing else. Every
 * number an owner needs on a Monday morning — what is overdue, what is
 * about to lapse, which job is drifting past its budget, what retainage is
 * due back this month — already existed in the data model, and none of it
 * appeared unless someone went looking for it on the right sub-page.
 *
 * So the table is still here, at the bottom, unchanged in function. What
 * is new is everything above it: the same figures, asked on load.
 *
 * Every number is derived on read — from Invoice, Payment, CostEntry and
 * JobLineItem, through lib/wip.ts, lib/retainage.ts and
 * lib/gc-reliability.ts. Nothing here is stored or cached, per
 * ARCHITECTURE.md: a saved "over budget" flag is wrong the moment a cost
 * entry lands, and a stale number on the screen someone trusts first is
 * worse than no number.
 */

const STATUS_FILTERS: { value: JobStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ESTIMATE", label: "Estimating" },
  { value: "CONTRACTED", label: "Contracted" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETE", label: "Complete" },
];

const ALL_STATUSES: JobStatus[] = ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"];

const GROUP_HEADING: Record<JobStatus, string> = {
  ESTIMATE: "Estimating",
  CONTRACTED: "Contracted",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

const STAGE_TONE: Record<string, string> = {
  NEEDS_PRICING: "border-line-card bg-tag-slate text-tag-slate-ink",
  READY_TO_SEND: "border-transparent bg-tag-blue text-tag-blue-ink",
  OUT_FOR_SIGNATURE: "border-transparent bg-tag-amber text-tag-amber-ink",
  SIGNED: "border-transparent bg-tag-green text-tag-green-ink",
};

const HEALTH_TONE: Record<string, string> = {
  over: "text-tag-rose-ink",
  watch: "text-tag-amber-ink",
  fine: "text-ink-body",
  unknown: "text-ink-body",
};

type JobRow = Awaited<ReturnType<typeof loadJobs>>[number];

async function loadJobs(companyId: string, where: Prisma.JobWhereInput) {
  return prisma.job.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      contact: true,
      lineItems: { where: { isDeleted: false } },
      signatureRequests: { select: { status: true } },
    },
  });
}

function jobValue(job: JobRow) {
  return job.lineItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice ?? 0),
    0,
  );
}

function filterHref(status: JobStatus | "ALL", q?: string) {
  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { company } = await requireCompanyContext();
  const { q, status } = await searchParams;

  const activeStatus = ALL_STATUSES.includes(status as JobStatus) ? (status as JobStatus) : null;

  const where: Prisma.JobWhereInput = { companyId: company.id };
  if (activeStatus) where.status = activeStatus;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { contact: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const now = new Date();

  const [jobs, allJobs, renewalSources, today] = await Promise.all([
    loadJobs(company.id, where),
    loadJobs(company.id, { companyId: company.id }),
    renewalSourcesForCompany(company.id),
    loadTodayDashboard(company.id, now),
  ]);

  const renewals = renewalAlerts(renewalSources, serverToday());
  const expiringSoon = renewals.filter(
    (renewal) => renewal.urgency === "EXPIRED" || renewal.urgency === "DUE_SOON",
  );

  const estimating = allJobs.filter((job) => job.status === "ESTIMATE");
  const pipelineValue = estimating.reduce((sum, job) => sum + jobValue(job), 0);

  const grouped = activeStatus
    ? [{ status: activeStatus, rows: jobs }]
    : ALL_STATUSES.map((s) => ({ status: s, rows: jobs.filter((job) => job.status === s) })).filter(
        (group) => group.rows.length > 0,
      );

  return (
    <ReceivablesProvider rows={today.receivables}>
      {/* The panel is a sibling of this column, not a child of it — that is
          what lets it push rather than cover. */}
      {/* The one light surface in the app so far. Scoped here rather than
          applied to the body, because the pages that have not been
          converted put tables and buttons directly on the page background
          and render unreadable on a light one. */}
      <div className="flex min-h-full bg-canvas">
        <div className="min-w-0 flex-1 px-6 py-8">
          <div className="mx-auto max-w-5xl">
            <h1 className="text-xl font-semibold text-ink">Today</h1>
            <p className="mt-1 text-sm text-ink-body">
              What needs a decision, before you go looking for it.
            </p>

            {/* Above the tiles on purpose. The tiles answer the four
                questions we guessed at; this answers the one they actually
                have. */}
            <div className="mt-6">
              <AskPanel />
            </div>

            {/* ------------------------------------ needs attention --- */}
            <section className="mt-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-label">
                Needs attention
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  accent="rose"
                  label="Overdue invoices"
                  value={money(today.overdueTotal)}
                  detail={
                    today.overdue.length === 0
                      ? "Nothing past its due date."
                      : `${today.overdue.length} ${today.overdue.length === 1 ? "invoice" : "invoices"} past due`
                  }
                />
                <StatCard
                  accent="amber"
                  label="Documents expiring"
                  value={String(expiringSoon.length)}
                  detail={
                    expiringSoon.length === 0
                      ? "Certificates and licences are current."
                      : "Expired or due within 30 days"
                  }
                  href="/compliance"
                />
                <StatCard
                  accent="violet"
                  label="Jobs over budget"
                  value={String(today.jobsOverBudget)}
                  detail={
                    today.jobsOverBudget === 0
                      ? "No active job is forecast past its contract value."
                      : "Forecast cost above contract value"
                  }
                />
                <StatCard
                  accent="teal"
                  label="Retainage held"
                  value={money(today.retainageHeldPastCompletion)}
                  detail="Withheld and not yet released"
                />
              </div>
            </section>

            {/* -------------------------------- today in the field ---- */}
            <section className="mt-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-label">
                Today in the field
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <h3 className="text-sm font-semibold text-ink">Crews today</h3>
                  {today.crews.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-body">
                      No jobs are in progress right now.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-line-row">
                      {today.crews.map((crew) => (
                        <li key={crew.jobId} className="py-2.5">
                          <Link href={`/jobs/${crew.jobId}`} className="block">
                            <p className="text-sm font-medium text-ink">{crew.name}</p>
                            <p className="text-xs text-ink-body">{crew.gcName}</p>
                            <p className="mt-0.5 text-xs text-ink-body">
                              {crew.crew.length === 0
                                ? "Nobody assigned yet"
                                : crew.crew.join(", ")}
                            </p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card>
                  <h3 className="text-sm font-semibold text-ink">Compliance</h3>
                  {expiringSoon.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-body">
                      Nothing expiring. Certificates, licences, policies and bonds are current.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-line-row">
                      {expiringSoon.slice(0, 6).map((renewal) => (
                        <li key={`${renewal.kind}-${renewal.id}`} className="py-2.5">
                          <p className="text-sm font-medium text-ink">
                            {renewal.title}
                            {renewal.detail && (
                              <span className="font-normal text-ink-body"> — {renewal.detail}</span>
                            )}
                          </p>
                          <p
                            className={`text-xs ${
                              renewal.urgency === "EXPIRED"
                                ? "text-tag-rose-ink"
                                : "text-tag-amber-ink"
                            }`}
                          >
                            {renewalTiming(renewal)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </section>

            {/* ------------------------------------------------ money -- */}
            <section className="mt-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-label">
                Money
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <h3 className="text-sm font-semibold text-ink">Accounts receivable</h3>
                  <p className="mb-2 text-xs text-ink-body">
                    Outstanding invoices, longest overdue first. Open one for the detail.
                  </p>
                  <ReceivablesList />
                </Card>

                <Card>
                  <h3 className="text-sm font-semibold text-ink">How your GCs pay</h3>
                  {today.gcReliability.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-body">
                      No invoices raised yet, so there is nothing to judge.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-line-row">
                      {today.gcReliability.slice(0, 6).map((row) => (
                        <li key={row.contactId} className="flex items-baseline justify-between gap-3 py-2.5">
                          <Link href={`/contacts/${row.contactId}`} className="min-w-0">
                            <span className="block truncate text-sm font-medium text-ink">
                              {row.name}
                            </span>
                            <span className="block text-xs text-ink-body">
                              {row.reliability.averageDaysToPay === null
                                ? "Nothing paid in full yet"
                                : `Pays in ${Math.round(row.reliability.averageDaysToPay)} days on average`}
                            </span>
                          </Link>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-medium tabular-nums text-ink">
                              {row.reliability.onTimeRate === null
                                ? "—"
                                : `${Math.round(row.reliability.onTimeRate * 100)}%`}
                            </span>
                            <span className="block text-xs text-ink-body">on time</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </section>

            {/* ------------------------------------------- job health -- */}
            <section className="mt-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-label">
                Job health
              </h2>
              <Card>
                {today.jobHealth.length === 0 ? (
                  <p className="text-sm text-ink-body">No active jobs.</p>
                ) : (
                  <ul className="divide-y divide-line-row">
                    {today.jobHealth.map((row) => (
                      <li key={row.jobId} className="py-2.5">
                        <Link href={`/jobs/${row.jobId}`} className="block">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm font-medium text-ink">{row.name}</p>
                            <p className="text-xs text-ink-body">{row.gcName}</p>
                          </div>
                          <p className={`mt-0.5 text-sm ${HEALTH_TONE[row.tone]}`}>{row.sentence}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* --------------------------------------- browse all jobs - */}
            <section className="mt-10 border-t border-line-card pt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Browse all jobs</h2>
                <p className="text-xs text-ink-body">
                  {money(pipelineValue)} still being priced across {estimating.length}{" "}
                  {estimating.length === 1 ? "estimate" : "estimates"}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/jobs/new"
                    className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    New job
                  </Link>
                  <Link href="/catalog" className="text-sm text-brand hover:underline">
                    Line item catalog
                  </Link>
                  <Link href="/bids" className="text-sm text-brand hover:underline">
                    Bid history
                  </Link>
                </div>

                <form className="flex flex-wrap items-center gap-2">
                  {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
                  <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="Search job or client"
                    className="w-52 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-line-card bg-surface px-3 py-2 text-sm font-medium text-ink-label hover:bg-tag-slate"
                  >
                    Search
                  </button>
                </form>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-b border-line-card pb-4">
                {STATUS_FILTERS.map((filter) => {
                  const isActive =
                    filter.value === "ALL" ? activeStatus === null : activeStatus === filter.value;
                  return (
                    <Link
                      key={filter.value}
                      href={filterHref(filter.value, q)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "border-brand bg-tag-blue text-tag-blue-ink"
                          : "border-line-card bg-surface text-ink-body hover:text-ink"
                      }`}
                    >
                      {filter.label}
                    </Link>
                  );
                })}
              </div>

              {allJobs.length === 0 ? (
                <Card className="mt-6">
                  <p className="text-ink-label">No jobs yet.</p>
                  <p className="mt-1 text-sm text-ink-body">
                    Start one and you&apos;re estimating —{" "}
                    <Link href="/jobs/new" className="text-brand hover:underline">
                      create a job
                    </Link>{" "}
                    to price up your first scope.
                  </p>
                </Card>
              ) : jobs.length === 0 ? (
                <Card className="mt-6 text-sm text-ink-body">
                  {q ? (
                    <>
                      Nothing matches “{q}”
                      {activeStatus ? ` in ${GROUP_HEADING[activeStatus].toLowerCase()}` : ""}.{" "}
                      <Link
                        href={filterHref(activeStatus ?? "ALL")}
                        className="text-brand hover:underline"
                      >
                        Clear the search
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      Nothing {GROUP_HEADING[activeStatus as JobStatus].toLowerCase() === "estimating" ? "being estimated" : `marked ${GROUP_HEADING[activeStatus as JobStatus].toLowerCase()}`} right now.{" "}
                      <Link href={filterHref("ALL", q)} className="text-brand hover:underline">
                        Show all jobs
                      </Link>
                      .
                    </>
                  )}
                </Card>
              ) : (
                <div className="mt-6 flex flex-col gap-6">
                  {grouped.map((group) => (
                    <div key={group.status}>
                      {!activeStatus && (
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-label">
                          {GROUP_HEADING[group.status]} · {group.rows.length}
                        </h3>
                      )}
                      <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                        {group.rows.map((job) => {
                          const stage =
                            job.status === "ESTIMATE"
                              ? estimateStage(
                                  job.lineItems.length,
                                  job.signatureRequests.map((request) => request.status),
                                )
                              : null;
                          return (
                            <li key={job.id} className="p-4">
                              <Link href={`/jobs/${job.id}`} className="block">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium text-ink">{job.name}</p>
                                    <StatusBadge status={job.status} />
                                    {stage && (
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-xs ${
                                          STAGE_TONE[stage.key]
                                        }`}
                                      >
                                        {stage.label}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm font-medium tabular-nums text-ink">
                                    {money(jobValue(job))}
                                  </p>
                                </div>
                                <p className="mt-0.5 text-sm text-ink-body">{job.contact.name}</p>
                                {stage && (
                                  <p className="mt-1 text-xs text-ink-body">{stage.detail}</p>
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <ReceivablesDetailPanel />
      </div>
    </ReceivablesProvider>
  );
}

/** A summary tile. The accent bar is what separates these from the plain
 * cards below — a bar on everything would mark nothing. */
function StatCard({
  accent,
  label,
  value,
  detail,
  href,
}: {
  accent: "rose" | "amber" | "violet" | "teal";
  label: string;
  value: string;
  detail: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-label">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-body">{detail}</p>
    </>
  );

  return (
    <Card accent={accent} className="p-4">
      {href ? (
        <Link href={href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}
