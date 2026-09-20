import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BidWizardSteps } from "@/components/BidWizardSteps";
import { money } from "@/lib/money";
import { bidWizardTotal, hasLeftWizard } from "@/lib/bid-wizard";

/**
 * Step 3 of the bid-creation stepper — see `BidWizardSteps`. A summary and
 * a landing point, not another form: there is nothing left this step needs
 * to collect that steps 1 and 2 didn't already save as it was typed, so
 * "Finish" is a plain link rather than a submit — nothing here to lose on
 * a failed save, because there is no save.
 *
 * Pricing, craft/phase tagging, forecasting, contracting the job — every
 * one of those stays on `/jobs/[id]`, the management page. This step's
 * only job is to say what's on the bid so far and hand off to it.
 */
export default async function NewJobReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { company, ...currentUser } = await requireCompanyContext();
  const principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      contact: { select: { name: true, email: true } },
      lineItems: { where: { isDeleted: false }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!job || job.companyId !== company.id) notFound();
  if (hasLeftWizard(job.status)) redirect(`/jobs/${job.id}`);

  const showsJobMoney = can(principal, "VIEW_JOB_COSTS");
  const priced = job.lineItems.filter((item) => item.unitPrice !== null);
  const total = bidWizardTotal(
    job.lineItems.map((item) => ({
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
    })),
  );

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <BidWizardSteps current={3} jobId={job.id} />
      <h1 className="mb-1 text-xl font-semibold text-ink">Review</h1>
      <p className="mb-6 text-sm text-ink-body">One more look before you open it in full.</p>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-line-card bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink-label">Job &amp; GC</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-body">Job</dt>
            <dd className="text-ink">{job.name}</dd>
            <dt className="text-ink-body">GC</dt>
            <dd className="text-ink">
              {job.contact.name}
              {job.contact.email ? ` — ${job.contact.email}` : ""}
            </dd>
            {job.scope && (
              <>
                <dt className="text-ink-body">Scope</dt>
                <dd className="text-ink">{job.scope}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="rounded-lg border border-line-card bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink-label">Work on this bid</h2>
          {job.lineItems.length === 0 ? (
            <p className="mt-2 text-sm text-ink-body">
              Nothing added yet.{" "}
              <Link href={`/jobs/new/${job.id}/items`} className="text-link hover:underline">
                Go back and add some →
              </Link>
            </p>
          ) : (
            <>
              <ul className="mt-2 flex flex-col divide-y divide-line-row">
                {job.lineItems.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-ink">{item.description}</span>
                    <span className="shrink-0 tabular-nums text-ink-body">
                      {item.quantity.toString()} {item.unit ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
              {showsJobMoney && (
                <p className="mt-3 text-sm text-ink-label">
                  {priced.length} of {job.lineItems.length} line{job.lineItems.length === 1 ? "" : "s"} priced ·{" "}
                  <span className="font-semibold">{money(total)}</span> so far
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line-card pt-6">
        <Link href={`/jobs/new/${job.id}/items`} className="text-sm text-link hover:underline">
          ← Add more work
        </Link>
        <Link
          href={`/jobs/${job.id}`}
          className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Finish — open the job →
        </Link>
      </div>
    </div>
  );
}
