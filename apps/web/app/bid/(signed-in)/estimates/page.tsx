import Link from "next/link";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { loadJobs } from "@/lib/jobs-list";
import { bidTotalOf } from "@/lib/estimating/recap-state";
import { money } from "@/lib/money";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Estimates" };

/**
 * C Stream Bid — estimates: steps 2-4 of the chain (the plan takeoff, the
 * estimate and bid recap, the proposal), one row per job still being priced.
 *
 * An estimate is a `Job` at ESTIMATE status (ARCHITECTURE.md: Job/JobLineItem
 * is one unified object), which is what keeps "same account" true — an
 * estimate the company wins later is the CRM job, with every line. The CRM has
 * no estimate list of its own (`/estimating` redirects to
 * `/jobs?status=ESTIMATE`); this is the same read (`loadJobs`) filtered the same
 * way, with the bid total from `bidTotalOf` — the one sum the CRM header and
 * the recap use — rather than `jobValue`, a second sum of the same lines.
 *
 * No `PageHeader` (its breadcrumb is `Home → /dashboard`), no `EmptyState`
 * (its Ask action pushes `/ask`), no `NoAccess` (its button is `/dashboard`):
 * each is a door into the CRM, which `bidLinkCensus.test.ts` would fail.
 */
export default async function BidEstimatesPage() {
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const jobs = await loadJobs({ companyId: context.company.id, status: "ESTIMATE" });
  const pipeline = jobs.reduce((sum, job) => sum + bidTotalOf(job.lineItems), 0);

  return (
    <PageShell width="working">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-headline text-3xl font-semibold text-ink">Estimates</h1>
          <p className="text-sm text-ink-body">
            {jobs.length === 0
              ? "The jobs you are pricing — measure the drawing, price the lines, set your markup, send the proposal."
              : `${money(pipeline)} still being priced across ${jobs.length} ${jobs.length === 1 ? "estimate" : "estimates"}.`}
          </p>
        </div>
        <Link
          href="/bid/estimates/new"
          data-bid="start-estimate"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-brand-hover"
        >
          Start an estimate
        </Link>
      </div>

      {jobs.length === 0 ? (
        <div className="flex max-w-prose flex-col gap-3 rounded-lg border border-line-card bg-surface p-5" data-bid="no-estimates">
          <h2 className="text-lg font-semibold text-ink">No estimates yet</h2>
          <p className="text-sm text-ink-body">
            An estimate is one job you are pricing for one GC. Start one, upload its drawing set, and the walls, the
            lines and the proposal all hang off it — the same numbers from the drawings to the page you send.
          </p>
          <p className="text-sm text-ink-body">
            Set up your{" "}
            <Link href="/bid/wall-types" className="text-link hover:underline">
              wall types
            </Link>{" "}
            and{" "}
            <Link href="/bid/price-book" className="text-link hover:underline">
              price book
            </Link>{" "}
            once and every estimate prices from them.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-bid="estimates-list">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/bid/estimates/${job.id}`} className="block p-4 hover:bg-rail-hover">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0 break-words font-medium text-ink">{job.name}</p>
                  <p className="text-sm font-medium tabular-nums text-ink">{money(bidTotalOf(job.lineItems))}</p>
                </div>
                <p className="mt-0.5 text-sm text-ink-body">
                  {job.contact.name} · {job.lineItems.length} {job.lineItems.length === 1 ? "line" : "lines"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
