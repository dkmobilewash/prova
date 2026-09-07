import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { viewerTimeZone } from "@/lib/viewerToday";
import { loadJobMedia } from "@/lib/job-media-query";
import { NoAccess } from "@/components/NoAccess";
import { JobMediaCapture } from "@/components/JobMediaCapture";
import { JobMediaCard } from "@/components/JobMediaCard";

/**
 * Every site photo the company has, newest first, filterable by job.
 *
 * The company-wide read. The per-job view lives on `/jobs/[id]` and both
 * render the same card from `loadJobMedia`, so they cannot drift.
 *
 * MANAGE_FIELD, matching `/punch-lists`, `/field-reports`, `/safety` and
 * `/equipment` — the capability the crew on site holds, which is the whole
 * point of a feature used from a phone in a stairwell.
 */
export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company } = context;
  const { job: jobFilter } = await searchParams;

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  const timeZone = await viewerTimeZone();
  const media = await loadJobMedia(
    { companyId: company.id, ...(activeJob ? { jobId: activeJob } : {}), withJobName: true },
    timeZone,
  );

  const filterHref = (jobId: string | null) => (jobId ? `/photos?job=${jobId}` : "/photos");

  // 44px, same as the punch-list filter: this is the first thing somebody
  // on site taps to get to their own job.
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-slate-100">Site photos</h1>
      <p className="mb-6 text-sm text-slate-400">
        What the job actually looked like, on the day. Photos are filed against a job and stay in
        Prova rather than on somebody&apos;s phone.
      </p>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-300">
            There are no jobs yet, and a photo is always filed against one.
          </p>
          <Link
            href="/jobs/new"
            className="mt-3 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500"
          >
            Create a job
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            <Link href={filterHref(null)} className={chip(!activeJob)}>
              All jobs
            </Link>
            {jobs.map((job) => (
              <Link key={job.id} href={filterHref(job.id)} className={chip(activeJob === job.id)}>
                {job.name}
              </Link>
            ))}
          </div>

          {/* Uploading needs a job, so the form only appears once one is
              chosen. On the job page it is always there, because the job is
              the page. */}
          {activeJob ? (
            <div className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <JobMediaCapture jobId={activeJob} />
            </div>
          ) : (
            <p className="mb-8 text-sm text-slate-400">
              Pick a job above to add photos, or open the job itself.
            </p>
          )}

          {media.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm text-slate-300">
                {activeJob ? "No photos on this job yet." : "No photos yet."}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {activeJob
                  ? "Add the first one above — a photo of the existing conditions before you start is the one people wish they had."
                  : "Pick a job above and add the first one."}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {media.map((item) => (
                <JobMediaCard key={item.id} media={item} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
