import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { BackchargeForm } from "@/components/BackchargeForm";
import { BackchargeRow } from "@/components/BackchargeRow";
import { isResponseOverdue, summarizeBackcharges } from "@/lib/backcharges";
import { money } from "@/lib/money";

/** Stored at UTC midnight, rendered in UTC — same rule as the RFI log and
 * the safety log. Rendering locally shows the previous day to anyone west
 * of UTC, which only ever shows up in production. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function BackchargesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; show?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { job: jobFilter, show } = await searchParams;
  const showResolved = show === "all";

  const today = new Date().toISOString().slice(0, 10);

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  const activeJob = jobFilter && jobs.some((j) => j.id === jobFilter) ? jobFilter : null;

  const backcharges = await prisma.backcharge.findMany({
    where: {
      companyId: company.id,
      ...(activeJob ? { jobId: activeJob } : {}),
      ...(showResolved ? {} : { status: { in: ["RECEIVED", "DISPUTED"] } }),
    },
    orderBy: [{ jobId: "asc" }, { number: "desc" }],
    include: { job: { select: { name: true } }, loggedByUser: { select: { name: true } } },
  });

  const rows = backcharges.map((bc) => ({
    id: bc.id,
    number: bc.number,
    jobName: bc.job.name,
    gcReference: bc.gcReference,
    category: bc.category as string,
    description: bc.description,
    claimedAmount: Number(bc.claimedAmount).toFixed(2),
    issuedOn: isoDate(bc.issuedOn),
    receivedOn: isoDate(bc.receivedOn),
    respondByDate: isoDate(bc.respondByDate),
    status: bc.status as string,
    disputedOn: isoDate(bc.disputedOn),
    disputeReason: bc.disputeReason,
    resolvedOn: isoDate(bc.resolvedOn),
    resolvedAmount: bc.resolvedAmount != null ? Number(bc.resolvedAmount) : null,
    resolutionNote: bc.resolutionNote,
    loggedByName: bc.loggedByUser?.name ?? null,
  }));

  // Summed from every backcharge on the job filter, not from the visible
  // rows. The default view hides resolved ones, and a "cost us this much"
  // figure that falls to zero the moment the work of resolving them is
  // done is the same defect the RFI page's impact tile was built to avoid.
  const allForSummary = await prisma.backcharge.findMany({
    where: { companyId: company.id, ...(activeJob ? { jobId: activeJob } : {}) },
    select: { status: true, claimedAmount: true, resolvedAmount: true },
  });
  const summary = summarizeBackcharges(
    allForSummary.map((bc) => ({
      status: bc.status as string,
      claimedAmount: Number(bc.claimedAmount),
      resolvedAmount: bc.resolvedAmount != null ? Number(bc.resolvedAmount) : null,
    })),
  );

  const overdueCount = rows.filter((r) => isResponseOverdue(r, today)).length;

  const filterHref = (params: { job?: string | null; show?: string | null }) => {
    const next = new URLSearchParams();
    const j = params.job === undefined ? activeJob : params.job;
    const s = params.show === undefined ? (showResolved ? "all" : null) : params.show;
    if (j) next.set("job", j);
    if (s) next.set("show", s);
    const qs = next.toString();
    return qs ? `/backcharges?${qs}` : "/backcharges";
  };

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Backcharges</h1>
      <p className="mb-6 text-sm text-slate-400">
        Money the GC is taking off what they owe us — cleanup, damage to another trade, our scope
        finished by somebody else. A change order is us asking for more; this is the same
        conversation running the other way, and until now the only record of one was an unexplained
        short-pay months later. Log it the day it arrives: the deadline to object in writing is
        usually short, and an objection is worth nothing without the date it went out.
      </p>

      <section className="mb-8">
        <BackchargeForm jobs={jobs} defaultJobId={activeJob ?? undefined} />
      </section>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="font-mono text-xl font-semibold text-slate-100">{money(summary.openClaimed)}</p>
          <p className="text-xs text-slate-500">
            Claimed and unresolved ({summary.openCount})
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${overdueCount > 0 ? "text-red-300" : "text-slate-100"}`}>
            {overdueCount}
          </p>
          <p className="text-xs text-slate-500">Past the deadline to object</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="font-mono text-xl font-semibold text-slate-100">{money(summary.concededTotal)}</p>
          <p className="text-xs text-slate-500">
            What resolved ones cost us
            {summary.unknownConcededCount > 0 && (
              <span className="text-amber-300">
                {" "}
                · {summary.unknownConcededCount} settled with no figure recorded, not counted
              </span>
            )}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="font-mono text-xl font-semibold text-green-300">{money(summary.avoidedTotal)}</p>
          <p className="text-xs text-slate-500">Argued off or withdrawn</p>
        </div>
      </div>

      <p className="mb-4 text-xs text-slate-500">
        These figures are a log of what the GC has charged us, not a deduction from any pay
        application — nothing here changes an invoice, a contract value or a WIP number. Netting an
        accepted backcharge against billing is real work that hasn&apos;t been built.
      </p>

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
          {rows.length} {showResolved ? "total" : "unresolved"}
        </h2>
        <Link href={filterHref({ show: showResolved ? null : "all" })} className="text-sm text-blue-400">
          {showResolved ? "Hide resolved" : "Show resolved"}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-400">
          {showResolved
            ? "No backcharges logged. That is worth being sure of rather than assuming — a deduction sheet stapled to a pay application is still a backcharge."
            : "Nothing unresolved. Switch to “Show resolved” for the ones already closed out."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {rows.map((bc) => (
            <BackchargeRow
              key={bc.id}
              backcharge={bc}
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
