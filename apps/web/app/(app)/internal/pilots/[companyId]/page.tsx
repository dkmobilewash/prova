import Link from "next/link";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { requireCompanyContext } from "@/lib/auth";
import { formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { loadJobAutomation } from "@/lib/takeoff/eventStatsQuery";

export const metadata = { title: "Pilot jobs" };

/**
 * ── ONE PILOT'S JOBS: HOW MUCH WAS AUTOMATIC, ON REAL WORK ──
 *
 * From the takeoff events (`TakeoffEvent`, `lib/takeoff/eventStats.ts`). Gated as
 * /internal/pilots is: Prova's operating company AND its owner; anybody else sees
 * "Not part of your access". The company is one of the customers that page lists,
 * never an operating company. Read-only. Events exist only from the day they began
 * to be recorded, so an older job shows its figures from then on.
 */
function NothingHere() {
  return (
    <PageShell width="reading">
      <PageHeader route="/internal/pilots" title="Not part of your access" />
      <p className="text-sm text-ink-muted">Nothing here for this account.</p>
    </PageShell>
  );
}

const COLUMNS: { key: string; label: string; what: string }[] = [
  { key: "touches", label: "Touches", what: "Presses a person made: each accept, pick, typed height, skip, undo, Set type or Clear type; an Accept all counts once." },
  { key: "auto", label: "Auto-posted", what: "Wall groups the auto-post rule typed with nobody pressing anything." },
  { key: "accepted", label: "Accepted", what: "Wall groups a person accepted in the review queue (Enter or Accept all)." },
  { key: "changed", label: "Changed after", what: "Of the groups accepted or auto-posted, how many were later undone, retyped or cleared: the accuracy signal." },
  { key: "send", label: "Upload → sent", what: "Minutes from the job's first plan set to its first signing link." },
];

export default async function PilotJobsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { company, ...currentUser } = await requireCompanyContext();
  if (!company.isProvaOperator || currentUser.role !== "OWNER") return <NothingHere />;
  const { companyId } = await params;
  const pilot = await prisma.company.findFirst({ where: { id: companyId, isProvaOperator: false }, select: { id: true, name: true } });
  if (!pilot) return <NothingHere />;
  const [rows, timeZone] = await Promise.all([loadJobAutomation(pilot.id), viewerTimeZone()]);
  const cell = "px-3 py-2 text-right tabular-nums";

  return (
    <PageShell width="working">
      <PageHeader route="/internal/pilots" title={`${pilot.name}: jobs`} />
      <p className="mb-4 text-sm text-ink-body">
        <Link href="/internal/pilots" className="text-link hover:underline">
          ← All pilots
        </Link>
        <span className="ml-2">Newest job first. Counted from the takeoff events, which begin on the day they were first recorded.</span>
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted" data-pilot-jobs="empty">
          No jobs yet, apart from any sample.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-card bg-surface">
          <table className="w-full min-w-[760px] text-sm text-ink" data-pilot-jobs="table">
            <thead className="border-b border-line-card text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Job</th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className="px-3 py-2 text-right font-medium" title={column.what}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.jobId} className="border-b border-line-card last:border-0" data-pilot-jobs="row" data-job={row.name}>
                  <td className="px-3 py-2 text-left">
                    <span className="font-medium">{row.name}</span>
                    <span className="block text-xs text-ink-muted">started {formatInstant(row.createdAt, timeZone)}</span>
                  </td>
                  <td className={cell} data-pilot-jobs="touches">{row.touches}</td>
                  <td className={cell} data-pilot-jobs="auto">{row.autoPosted}</td>
                  <td className={cell} data-pilot-jobs="accepted">{row.accepted}</td>
                  <td className={cell} data-pilot-jobs="changed">{row.changedAfterAccept}</td>
                  <td className={cell} data-pilot-jobs="send">{row.minutesToSend === null ? "not sent" : `${row.minutesToSend} min`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="mt-6 grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
        {COLUMNS.map((column) => (
          <div key={column.key}>
            <dt className="inline font-medium text-ink-body">{column.label}: </dt>
            <dd className="inline">{column.what}</dd>
          </div>
        ))}
      </dl>
    </PageShell>
  );
}
