import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { DrawingSetForm } from "@/components/DrawingSetForm";
import { DrawingSetRow } from "@/components/DrawingSetRow";
import { setState, unreceivedRevisions } from "@/components/drawingLabels";

/** Stored at UTC midnight, rendered in UTC — same rule as every other
 * dated record in this app. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function DrawingsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_JOBS");
  if (!allowed) return <NoAccess capability="MANAGE_JOBS" />;
  const { company, ...currentUser } = context;
  const { job: jobFilter } = await searchParams;

  const today = new Date().toISOString().slice(0, 10);

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  const sets = await prisma.drawingSet.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
    },
    orderBy: [{ jobId: "asc" }, { name: "asc" }],
    include: {
      job: { select: { name: true } },
      revisions: { orderBy: { issuedOn: "desc" } },
    },
  });

  const rows = sets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    jobName: set.job.name,
    revisions: set.revisions.map((rev) => ({
      id: rev.id,
      label: rev.label,
      issuedOn: isoDate(rev.issuedOn) as string,
      receivedOn: isoDate(rev.receivedOn),
      description: rev.description,
      fileUrl: rev.fileUrl,
      fileName: rev.fileName,
    })),
  }));

  const behindCount = rows.filter((r) => setState(r.revisions) === "BEHIND").length;
  const inHandCount = rows.filter((r) => setState(r.revisions) === "CURRENT_IN_HAND").length;
  // Counted across every set, not per set — "how many issues are we missing
  // in total" is the number someone chases the GC with.
  const missingIssues = rows.reduce((n, r) => n + unreceivedRevisions(r.revisions).length, 0);

  const filterHref = (job: string | null) => (job ? `/drawings?job=${job}` : "/drawings");

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Drawings</h1>
      <p className="mb-6 text-sm text-slate-400">
        Which revision of each set is current, and whether it&apos;s actually in the trailer. A
        revision that has been issued supersedes the one before it whether or not it has reached you
        — so an issue you haven&apos;t received means the crew is building from paper that is already
        out of date, and that rework is nobody else&apos;s to pay for once you&apos;ve signed for the
        set.
      </p>

      <section className="mb-8">
        <DrawingSetForm jobs={jobs} defaultJobId={activeJob ?? undefined} />
      </section>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${behindCount > 0 ? "text-red-300" : "text-slate-100"}`}>
            {behindCount}
          </p>
          <p className="text-xs text-slate-500">Sets whose newest issue isn&apos;t here</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${missingIssues > 0 ? "text-amber-300" : "text-slate-100"}`}>
            {missingIssues}
          </p>
          <p className="text-xs text-slate-500">Issues never received</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-green-300">{inHandCount}</p>
          <p className="text-xs text-slate-500">Sets current in hand</p>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href={filterHref(null)} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobs.map((j) => (
            <Link key={j.id} href={filterHref(j.id)} className={chip(activeJob === j.id)}>
              {j.name}
            </Link>
          ))}
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold text-slate-300">
        {rows.length} {rows.length === 1 ? "set" : "sets"}
      </h2>

      {rows.length === 0 ? (
        <p className="text-slate-400">
          No drawing sets yet. Add one per discipline the job issues separately — the log of which
          revision governed on which date is what answers &ldquo;why did the crew build it that
          way.&rdquo;
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {rows.map((set) => (
            <DrawingSetRow
              key={set.id}
              set={set}
              today={today}
              showJob={!activeJob}
              canDelete={currentUser.role === "OWNER"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
