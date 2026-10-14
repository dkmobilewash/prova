import Link from "next/link";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { BackchargeForm } from "@/components/BackchargeForm";
import { EmptyState } from "@/components/EmptyState";
import { BackchargeRow } from "@/components/BackchargeRow";
import { isResponseOverdue, summarizeBackcharges } from "@/lib/backcharges";
import { StatusLine } from "@/components/StatusLine";
import { HintedText } from "@/components/HintedText";
import { backchargesStatus } from "@/lib/status-sentences";
import { money } from "@/lib/money";
import { jobPickerLabel, toJobOption } from "@/components/jobLabels";
import { viewerToday } from "@/lib/viewerToday";

export const metadata = { title: "Backcharges" };

/** Stored at UTC midnight, rendered in UTC — same rule as the RFI log and
 * the safety log. Rendering locally shows the previous day to anyone west
 * of UTC, which only ever shows up in production. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function BackchargesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; show?: string; new?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_BILLING");
  if (!allowed) return <NoAccess capability="MANAGE_BILLING" />;
  const { company, ...currentUser } = context;
  const { job: jobFilter, show, new: startNew } = await searchParams;
  const showResolved = show === "all";

  const today = await viewerToday();

  // status + contact, not just the name: issue #65 — fifteen jobs, seven of
  // them called "Smith kitchen remodel", and this picker showed seven
  // identical rows. See components/jobLabels.ts.
  const jobs = (
    await prisma.job.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, contact: { select: { name: true } } },
    })
  ).map(toJobOption);
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

  // Whether this company has EVER logged one, not whether the current
  // filter shows any — the teaching empty state is for the first, and a
  // filter that happens to match nothing keeps its plain line.
  const everLogged = await prisma.backcharge.count({ where: { companyId: company.id } });

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
    `inline-flex min-h-11 items-center rounded-md border px-3 text-sm mouse:min-h-8 ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-rail-hover"
    }`;

  return (
    <PageShell width="working">
      <PageHeader
        route="/backcharges"
        subtitle="Log what the GC takes off your pay the day it arrives, so you can object before the deadline."
      />

      <section className="mb-8" data-tour="backcharges-log">
        <BackchargeForm jobs={jobs} defaultJobId={activeJob ?? undefined} startOpen={startNew === "1"} />
      </section>

      {/* The four tiles became one sentence and the disclaimer a hint
          (density audit #29). Same figures, same expressions: `summary`
          and `overdueCount` are computed above exactly as before. */}
      <div className="mb-4" data-tour="backcharges-totals">
        <StatusLine
          report={backchargesStatus({
            openCount: summary.openCount,
            openClaimed: money(summary.openClaimed),
            overdue: overdueCount,
            conceded: money(summary.concededTotal),
            avoided: money(summary.avoidedTotal),
            unknownConceded: summary.unknownConcededCount,
          })}
        />
        <p className="-mt-2 text-xs text-ink-muted">
          <HintedText
            label="A record, not a deduction"
            hint="These figures are a log of what the GC has charged us, not a deduction from any pay application — nothing here changes an invoice, a contract value or a WIP number. An accepted backcharge is not netted against billing automatically; if the GC deducts it, adjust the invoice yourself."
          />
        </p>
      </div>

      {jobs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" data-tour="backcharges-job-filter">
          <Link href={filterHref({ job: null })} className={chip(!activeJob)}>
            All jobs
          </Link>
          {jobs.map((j) => (
            <Link key={j.id} href={filterHref({ job: j.id })} className={chip(activeJob === j.id)}>
              {jobPickerLabel(j)}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-label">
          {rows.length} {showResolved ? "total" : "unresolved"}
        </h2>
        <Link href={filterHref({ show: showResolved ? null : "all" })} className="text-sm text-link">
          {showResolved ? "Hide resolved" : "Show resolved"}
        </Link>
      </div>

      {rows.length === 0 && everLogged === 0 ? (
        <EmptyState
          data-tour="backcharges-empty"
          title="No backcharges yet"
          purpose={
            <p>
              Money someone takes off what they owe you — a builder charging you for cleanup, a
              repair to another trade&apos;s work, a punch item they finished themselves. Log it
              the day it arrives, with the amount and the date, so you can dispute it in writing
              before the deadline instead of finding a short payment months later.
            </p>
          }
          actions={
            jobs.length === 0
              ? [{ label: "Create a job", href: "/jobs/new" }]
              : [{ label: "Log a backcharge", opens: "backcharges-log" }]
          }
          example={{
            rows: [
              { title: "#2 Site cleanup, week of Sep 1", tag: "Disputed", detail: "Oak Ave addition · objection sent Sep 5", meta: "$450.00" },
              { title: "#1 Drywall damage by another trade", tag: "Accepted", detail: "Oak Ave addition · taken off pay app 2", meta: "$180.00" },
            ],
          }}
        />
      ) : rows.length === 0 ? (
        <p className="text-ink-body">
          {showResolved
            ? "No backcharges logged. That is worth being sure of rather than assuming — a deduction sheet stapled to a pay application is still a backcharge."
            : "Nothing unresolved. Switch to “Show resolved” for the ones already closed out."}
        </p>
      ) : (
        <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface" data-tour="backcharges-list">
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
    </PageShell>
  );
}
