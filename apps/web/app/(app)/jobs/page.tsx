import Link from "next/link";
import { Card, PageShell, StatusBadge } from "@prova/ui";
import type { JobStatus, Prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { estimateStage } from "@/lib/estimate-stage";
import { can } from "@/lib/permissions";
import { money } from "@/lib/money";
import { jobValue, loadJobs } from "@/lib/jobs-list";

/**
 * Every job: search and stage filters at the TOP, the list under them.
 *
 * It used to be a redirect to /dashboard, where this list sat under the
 * whole home page — the top bar's "Jobs" only scrolled home, and a search
 * reloaded to the top with its answer off-screen (UX test 2026-10-11). Home
 * keeps its job cards and links here for the rest.
 *
 * URL-driven (`?q=&status=`): the search is a plain GET form, so Enter
 * submits it and the result is a link you can share or go Back to.
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
  READY_TO_SEND: "border-transparent bg-tag-brand text-tag-brand-ink",
  OUT_FOR_SIGNATURE: "border-transparent bg-tag-amber text-tag-amber-ink",
  SIGNED: "border-transparent bg-tag-green text-tag-green-ink",
};

function filterHref(status: JobStatus | "ALL", q?: string) {
  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { company, role, jobFunction } = await requireCompanyContext();
  const showsJobMoney = can({ role, jobFunction }, "VIEW_JOB_COSTS");

  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const activeStatus = ALL_STATUSES.includes(params.status as JobStatus) ? (params.status as JobStatus) : null;

  const where: Prisma.JobWhereInput = { companyId: company.id };
  if (activeStatus) where.status = activeStatus;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { contact: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  const jobs = await loadJobs(where);

  const estimating = jobs.filter((job) => job.status === "ESTIMATE");
  const pipelineValue = estimating.reduce((sum, job) => sum + jobValue(job), 0);
  const filtered = Boolean(q || activeStatus);

  const grouped = activeStatus
    ? [{ status: activeStatus, rows: jobs }]
    : ALL_STATUSES.map((s) => ({ status: s, rows: jobs.filter((job) => job.status === s) })).filter(
        (group) => group.rows.length > 0,
      );

  return (
    <PageShell width="working">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-headline text-[32px] font-semibold leading-tight text-ink">Jobs</h1>
          {!filtered && estimating.length > 0 && (
            <p className="text-sm text-ink-muted">
              {showsJobMoney
                ? `${money(pipelineValue)} still being priced across ${estimating.length} ${estimating.length === 1 ? "estimate" : "estimates"}`
                : `${estimating.length} ${estimating.length === 1 ? "estimate" : "estimates"} still being priced`}
            </p>
          )}
        </div>
        <Link
          href="/jobs/new"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-brand-hover mouse:min-h-9"
        >
          + New job
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-3" data-tour="jobs-filters">
        <form action="/jobs" role="search" className="flex flex-wrap items-center gap-2">
          {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search job or client…"
            aria-label="Search jobs by job or client name"
            className="min-h-11 w-full max-w-sm rounded-md border border-line-card bg-surface px-3 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none sm:text-sm mouse:min-h-9"
          />
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-card bg-surface px-3 text-sm font-medium text-ink-label hover:bg-rail-hover mouse:min-h-9"
          >
            Search
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => {
            const isActive = filter.value === "ALL" ? activeStatus === null : activeStatus === filter.value;
            return (
              <Link
                key={filter.value}
                href={filterHref(filter.value, q)}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm transition-colors mouse:min-h-9 ${
                  isActive
                    ? "border-brand bg-tag-brand text-tag-brand-ink"
                    : "border-line-card bg-surface text-ink-body hover:text-ink"
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
      </div>

      {jobs.length === 0 ? (
        <Card className="mt-6 text-sm text-ink-body">
          {q ? (
            <>
              No jobs match “{q}”{activeStatus ? ` in ${GROUP_HEADING[activeStatus].toLowerCase()}` : ""}.{" "}
              <Link href="/jobs" className="text-link hover:underline">
                Clear the search and filters
              </Link>
              .
            </>
          ) : activeStatus ? (
            <>
              Nothing {activeStatus === "ESTIMATE" ? "being estimated" : `marked ${GROUP_HEADING[activeStatus].toLowerCase()}`} right now.{" "}
              <Link href="/jobs" className="text-link hover:underline">
                Show all jobs
              </Link>
              .
            </>
          ) : (
            <>
              No jobs yet.{" "}
              <Link href="/jobs/new" className="text-link hover:underline">
                Start your first job
              </Link>
              .
            </>
          )}
        </Card>
      ) : (
        <div className="mt-6 flex flex-col gap-6" data-tour="jobs-list">
          {grouped.map((group) => (
            <div key={group.status} className="[content-visibility:auto] [contain-intrinsic-size:auto_600px]">
              {!activeStatus && (
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-label">
                  {GROUP_HEADING[group.status]} · {group.rows.length}
                </h2>
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
                    <li key={job.id}>
                      <Link href={`/jobs/${job.id}`} className="block p-4 hover:bg-rail-hover">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 break-words font-medium text-ink">{job.name}</p>
                            <StatusBadge status={job.status} />
                            {stage && (
                              <span className={`rounded-full border px-2 py-0.5 text-xs ${STAGE_TONE[stage.key]}`}>
                                {stage.label}
                              </span>
                            )}
                          </div>
                          {showsJobMoney && (
                            <p className="text-sm font-medium tabular-nums text-ink">{money(jobValue(job))}</p>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-ink-body">{job.contact.name}</p>
                        {stage && <p className="mt-1 text-xs text-ink-body">{stage.detail}</p>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 flex flex-wrap gap-x-4 text-sm">
        <Link href="/catalog" className="inline-flex min-h-11 items-center text-link hover:underline mouse:min-h-7">
          Line item catalog
        </Link>
        <Link href="/bids" className="inline-flex min-h-11 items-center text-link hover:underline mouse:min-h-7">
          Bid history
        </Link>
      </p>
    </PageShell>
  );
}
