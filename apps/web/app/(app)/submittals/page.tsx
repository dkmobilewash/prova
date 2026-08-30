import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { SubmittalForm } from "@/components/SubmittalForm";
import { SubmittalRow } from "@/components/SubmittalRow";
import { submittalState } from "@/components/submittalLabels";

/** Stored at UTC midnight, rendered in UTC — same rule as RFIs, the
 * safety log and daily field reports. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function SubmittalsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; show?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { job: jobFilter, show } = await searchParams;
  const showApproved = show === "all";

  const today = new Date().toISOString().slice(0, 10);

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  const submittals = await prisma.submittal.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
    },
    orderBy: [{ jobId: "asc" }, { number: "desc" }],
    include: {
      job: { select: { name: true } },
      submittedBy: { select: { name: true } },
      revisions: { orderBy: { revisionNumber: "asc" } },
    },
  });

  const allRows = submittals.map((submittal) => ({
    id: submittal.id,
    number: submittal.number,
    jobName: submittal.job.name,
    title: submittal.title,
    description: submittal.description,
    specSection: submittal.specSection,
    drawingReference: submittal.drawingReference,
    submittedByName: submittal.submittedBy?.name ?? null,
    revisions: submittal.revisions.map((rev) => ({
      revisionNumber: rev.revisionNumber,
      sentOn: isoDate(rev.sentOn) as string,
      dueBack: isoDate(rev.dueBack),
      returnedOn: isoDate(rev.returnedOn),
      outcome: rev.outcome,
      responseNotes: rev.responseNotes,
    })),
  }));

  // Approval is the normal end state, so approved packages leave the
  // default view — but they stay one click away, because "which revision
  // was approved" is exactly what someone checks before building.
  const rows = showApproved
    ? allRows
    : allRows.filter((row) => submittalState(row.revisions) !== "APPROVED");

  const withGcCount = allRows.filter((r) => submittalState(r.revisions) === "WITH_GC").length;
  const reviseCount = allRows.filter((r) => submittalState(r.revisions) === "REVISE").length;
  // Counted from all rows for this filter, not the visible ones — the
  // default view hides exactly this set, and a tile that falls to zero
  // because the things it counts are hidden is the bug the RFI impact
  // tile had.
  const approvedCount = allRows.filter((r) => submittalState(r.revisions) === "APPROVED").length;

  const filterHref = (params: { job?: string | null; show?: string | null }) => {
    const next = new URLSearchParams();
    const j = params.job === undefined ? activeJob : params.job;
    const s = params.show === undefined ? (showApproved ? "all" : null) : params.show;
    if (j) next.set("job", j);
    if (s) next.set("show", s);
    const qs = next.toString();
    return qs ? `/submittals?${qs}` : "/submittals";
  };

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Submittals</h1>
      <p className="mb-6 text-sm text-slate-400">
        Shop drawings and product data sent for approval, and what came back. The one question this
        page answers is &ldquo;which revision is it legal to build from?&rdquo; — work built from a
        superseded or unapproved drawing is rework, and &ldquo;the GC sat on it for five weeks&rdquo;
        is worth nothing in a delay claim without the dates.
      </p>

      <section className="mb-8">
        <SubmittalForm jobs={jobs} defaultJobId={activeJob ?? undefined} />
      </section>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-slate-100">{withGcCount}</p>
          <p className="text-xs text-slate-500">With the GC</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${reviseCount > 0 ? "text-amber-300" : "text-slate-100"}`}>
            {reviseCount}
          </p>
          <p className="text-xs text-slate-500">Back in our court to resubmit</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-green-300">{approvedCount}</p>
          <p className="text-xs text-slate-500">Approved</p>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href={filterHref({ job: null })} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobs.map((j) => (
            <Link key={j.id} href={filterHref({ job: j.id })} className={chip(activeJob === j.id)}>
              {j.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">
          {rows.length} {showApproved ? "total" : "in play"}
        </h2>
        <Link href={filterHref({ show: showApproved ? null : "all" })} className="text-sm text-blue-400">
          {showApproved ? "Hide approved" : "Show approved"}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-400">
          Nothing here yet. Log a package the day it goes out — the gap between the date you sent it
          and the date it came back is the whole value of the record.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {rows.map((submittal) => (
            <SubmittalRow
              key={submittal.id}
              submittal={submittal}
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
