import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BidWizardSteps } from "@/components/BidWizardSteps";
import { BidWizardLineItems } from "@/components/BidWizardLineItems";
import { money } from "@/lib/money";
import { bidWizardTotal, hasLeftWizard } from "@/lib/bid-wizard";

/**
 * Step 2 of the bid-creation stepper — see `BidWizardSteps` for the shape.
 * This is deliberately its own route under `/jobs/new`, not a section on
 * `/jobs/[id]`: it is the CREATION shape (linear, one purpose per screen),
 * the job page is the MANAGEMENT shape, and the two stay separate pages on
 * purpose so this branch never has to touch `jobs/[id]/page.tsx`.
 */
export default async function NewJobItemsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { company, ...currentUser } = await requireCompanyContext();
  const principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      contact: { select: { name: true } },
      lineItems: { where: { isDeleted: false }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!job || job.companyId !== company.id) notFound();
  // A job that has left ESTIMATE has already left the wizard too, whether
  // that was through the review step's "Mark contracted" or straight off
  // the job page. Sending it back to a step for adding pre-contract line
  // items would be a stale link, not a real state to render.
  if (hasLeftWizard(job.status)) redirect(`/jobs/${job.id}`);

  // Same gate the job page itself uses for its "Line items (estimate)"
  // section (`showsJobMoney` there) — a job function without VIEW_JOB_COSTS
  // sees this bid's existence and scope, never its prices.
  const showsJobMoney = can(principal, "VIEW_JOB_COSTS");

  const catalogEntries = showsJobMoney
    ? await prisma.lineItemCatalogEntry.findMany({
        where: { companyId: company.id },
        orderBy: { description: "asc" },
        select: { id: true, description: true, unit: true },
      })
    : [];

  const lineItems = job.lineItems.map((item) => ({
    id: item.id,
    description: item.description,
    quantity: item.quantity.toString(),
    unit: item.unit,
    unitPrice: item.unitPrice?.toString() ?? null,
  }));

  const total = bidWizardTotal(
    job.lineItems.map((item) => ({
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
    })),
  );

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <BidWizardSteps current={2} jobId={job.id} />
      <h1 className="mb-1 text-xl font-semibold text-ink">Add work</h1>
      <p className="mb-6 text-sm text-ink-body">
        {job.name} · {job.contact.name}
      </p>

      {!showsJobMoney ? (
        <p className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body">
          You don&apos;t have access to price this estimate.{" "}
          <Link href={`/jobs/new/${job.id}/review`} className="text-link hover:underline">
            Skip to review →
          </Link>
        </p>
      ) : (
        <BidWizardLineItems jobId={job.id} lineItems={lineItems} catalogEntries={catalogEntries} />
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line-card pt-6">
        <p className="text-sm text-ink-body">
          {job.lineItems.length === 0
            ? "No line items yet — you can still continue and add them later."
            : `${job.lineItems.length} line item${job.lineItems.length === 1 ? "" : "s"}` +
              (showsJobMoney ? ` · ${money(total)} so far` : "")}
        </p>
        <Link
          href={`/jobs/new/${job.id}/review`}
          className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Continue →
        </Link>
      </div>
    </div>
  );
}
