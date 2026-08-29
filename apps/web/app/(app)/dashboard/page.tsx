import Link from "next/link";
import { StatusBadge } from "@prova/ui";
import { JobStatus, Prisma, prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { estimateStage } from "@/lib/estimate-stage";
import { money } from "@/lib/money";

/**
 * Jobs and estimates, in one place.
 *
 * They were two pages, and that was wrong: a job doesn't become an estimate,
 * it *starts* as one. ESTIMATE is the first value of JobStatus. Creating a job
 * and creating an estimate are the same act, so splitting them made the user
 * hold two mental models for one record, and made "where do I go to estimate"
 * a question with no good answer.
 *
 * One list, ordered the way work actually moves: what you're still pricing
 * first, because that's what needs a decision today, then what you've won.
 * Estimate-stage rows carry the next action; nothing else needs one, because
 * a contracted job's next action lives on the job itself.
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
  NEEDS_PRICING: "border-slate-700 bg-slate-800 text-slate-400",
  READY_TO_SEND: "border-blue-700 bg-blue-950 text-blue-300",
  OUT_FOR_SIGNATURE: "border-amber-700 bg-amber-950 text-amber-300",
  SIGNED: "border-emerald-700 bg-emerald-950 text-emerald-300",
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

export default async function JobsPage({
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

  // The totals describe the whole business, not the current filter — a
  // pipeline figure that changed when you clicked a tab would be useless.
  const [jobs, allJobs] = await Promise.all([
    loadJobs(company.id, where),
    loadJobs(company.id, { companyId: company.id }),
  ]);

  const estimating = allJobs.filter((job) => job.status === "ESTIMATE");
  const won = allJobs.filter((job) => job.status === "CONTRACTED" || job.status === "IN_PROGRESS");
  const pipelineValue = estimating.reduce((sum, job) => sum + jobValue(job), 0);
  const wonValue = won.reduce((sum, job) => sum + jobValue(job), 0);

  const grouped = activeStatus
    ? [{ status: activeStatus, rows: jobs }]
    : ALL_STATUSES.map((s) => ({ status: s, rows: jobs.filter((job) => job.status === s) })).filter(
        (group) => group.rows.length > 0,
      );

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-100">Jobs &amp; estimates</h1>
      <p className="mt-1 text-sm text-slate-400">
        Every job starts as an estimate, so they live together. Price it, get it signed, and it
        becomes a contract — the same record the whole way through.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Estimating</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">
            {money(pipelineValue)}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {estimating.length} {estimating.length === 1 ? "job" : "jobs"} priced and not yet won
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Contracted &amp; active</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{money(wonValue)}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {won.length} {won.length === 1 ? "job" : "jobs"} under contract
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/jobs/new"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            New job
          </Link>
          <Link href="/catalog" className="text-sm text-blue-400 hover:text-blue-300 hover:underline">
            Line item catalog
          </Link>
          <Link href="/bids" className="text-sm text-blue-400 hover:text-blue-300 hover:underline">
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
            className="w-52 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Search
          </button>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-800 pb-4">
        {STATUS_FILTERS.map((filter) => {
          const isActive =
            filter.value === "ALL" ? activeStatus === null : activeStatus === filter.value;
          return (
            <Link
              key={filter.value}
              href={filterHref(filter.value, q)}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? "border-blue-500 bg-blue-500/15 text-blue-300"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-100"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {allJobs.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-slate-300">No jobs yet.</p>
          <p className="mt-1 text-sm text-slate-400">
            Start one and you&apos;re estimating —{" "}
            <Link href="/jobs/new" className="text-blue-400 hover:underline">
              create a job
            </Link>{" "}
            to price up your first scope.
          </p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
          {q ? (
            <>
              Nothing matches “{q}”
              {activeStatus ? ` in ${GROUP_HEADING[activeStatus].toLowerCase()}` : ""}.{" "}
              <Link href={filterHref(activeStatus ?? "ALL")} className="text-blue-400 hover:underline">
                Clear the search
              </Link>
              .
            </>
          ) : (
            <>
              Nothing in {GROUP_HEADING[activeStatus as JobStatus].toLowerCase()} right now.{" "}
              <Link href={filterHref("ALL", q)} className="text-blue-400 hover:underline">
                Show all jobs
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {grouped.map((group) => (
            <section key={group.status}>
              {!activeStatus && (
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {GROUP_HEADING[group.status]} · {group.rows.length}
                </h2>
              )}
              <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
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
                            <p className="font-medium text-slate-100">{job.name}</p>
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
                          <p className="text-sm font-medium tabular-nums text-slate-100">
                            {money(jobValue(job))}
                          </p>
                        </div>
                        <p className="mt-0.5 text-sm text-slate-400">{job.contact.name}</p>
                        {stage && <p className="mt-1 text-xs text-slate-500">{stage.detail}</p>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
