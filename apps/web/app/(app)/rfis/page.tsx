import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { RfiForm } from "@/components/RfiForm";
import { RfiRow } from "@/components/RfiRow";
import { isOpen, isOverdue } from "@/components/rfiLabels";

/** Stored at UTC midnight, rendered in UTC — same rule as the safety log
 * and daily field reports. Local rendering shows the previous day to
 * anyone west of UTC, which only shows up in production. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function RfisPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; show?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { job: jobFilter, show } = await searchParams;
  const showClosed = show === "all";

  const today = new Date().toISOString().slice(0, 10);

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  const rfis = await prisma.rfi.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
      ...(showClosed ? {} : { status: { not: "CLOSED" } }),
    },
    orderBy: [{ jobId: "asc" }, { number: "desc" }],
    include: { job: { select: { name: true } }, askedBy: { select: { name: true } } },
  });

  const rows = rfis.map((rfi) => ({
    id: rfi.id,
    number: rfi.number,
    jobName: rfi.job.name,
    subject: rfi.subject,
    question: rfi.question,
    drawingReference: rfi.drawingReference,
    specSection: rfi.specSection,
    status: rfi.status,
    sentOn: isoDate(rfi.sentOn),
    dueBy: isoDate(rfi.dueBy),
    answeredOn: isoDate(rfi.answeredOn),
    answer: rfi.answer,
    costImpact: rfi.costImpact,
    scheduleImpact: rfi.scheduleImpact,
    askedByName: rfi.askedBy?.name ?? null,
  }));

  const openCount = rows.filter((r) => isOpen(r.status)).length;
  const overdueCount = rows.filter((r) => isOverdue(r, today)).length;

  // Counted from the database rather than from `rows`, unlike the two
  // above. Open and overdue are properties of RFIs still in play, so the
  // default view already holds all of them. Cost/schedule impact is the
  // set you pull when building a change order — a job-lifetime figure —
  // and closing an answered RFI is the normal end state, so counting the
  // visible rows made the tile fall to zero exactly as the work got done.
  const impactCount = await prisma.rfi.count({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
      OR: [{ costImpact: true }, { scheduleImpact: true }],
    },
  });

  const filterHref = (params: { job?: string | null; show?: string | null }) => {
    const next = new URLSearchParams();
    const j = params.job === undefined ? activeJob : params.job;
    const s = params.show === undefined ? (showClosed ? "all" : null) : params.show;
    if (j) next.set("job", j);
    if (s) next.set("show", s);
    const qs = next.toString();
    return qs ? `/rfis?${qs}` : "/rfis";
  };

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">RFIs</h1>
      <p className="mb-6 text-sm text-ink-body">
        Questions to the GC or architect, and what came back. This is evidence before it&apos;s a
        to-do list: an RFI sent on a date and answered three weeks later is the documentation behind a
        delay claim, and &ldquo;we asked and nobody got back to us&rdquo; is worth nothing without the
        dates.
      </p>

      <section className="mb-8">
        <RfiForm jobs={jobs} defaultJobId={activeJob ?? undefined} today={today} />
      </section>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-slate-100">{openCount}</p>
          <p className="text-xs text-slate-500">Awaiting an answer</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${overdueCount > 0 ? "text-red-300" : "text-slate-100"}`}>
            {overdueCount}
          </p>
          <p className="text-xs text-slate-500">Past the date we asked for</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-amber-300">{impactCount}</p>
          <p className="text-xs text-slate-500">Answers with cost or schedule impact</p>
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
          {rows.length} {showClosed ? "total" : "in play"}
        </h2>
        <Link href={filterHref({ show: showClosed ? null : "all" })} className="text-sm text-blue-400">
          {showClosed ? "Hide closed" : "Show closed"}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-400">
          Nothing here yet. Raise one the day the question comes up rather than the day it becomes a
          problem — the gap between those two dates is the whole value of the log.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {rows.map((rfi) => (
            <RfiRow
              key={rfi.id}
              rfi={rfi}
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
