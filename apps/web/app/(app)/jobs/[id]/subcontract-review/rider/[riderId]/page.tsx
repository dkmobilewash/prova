import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { NotLegalAdvice } from "@/components/NotLegalAdvice";
import { PrintButton } from "@/components/PrintButton";
import { riderBlocks } from "@/lib/subcontract-review/rider";

/**
 * A subcontract rider, as it will read on paper — the print preview of the
 * text `renderRiderPdf` files when the rider is attached, rendered from the
 * same `riderBlocks` so the two cannot disagree about structure.
 *
 * The not-legal-advice line is on the SCREEN and hidden on paper: this is the
 * document the GC receives and signs, and a disclaimer printed on it would be
 * a sentence addressed to the wrong reader. The review and the summary — which
 * are ours — carry it printed.
 */
export default async function SubcontractRiderPage({ params }: { params: Promise<{ id: string; riderId: string }> }) {
  const { id, riderId } = await params;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;

  const rider = await prisma.subcontractRider.findFirst({
    where: { id: riderId, jobId: id, job: { companyId: context.company.id } },
    select: { title: true, body: true, status: true, attachedContractDocument: { select: { versionNumber: true } } },
  });
  if (!rider) notFound();

  return (
    <PageShell width="reading" className="print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/jobs/${id}/subcontract-review`} className="text-sm text-link hover:underline">
          ← Back to the review
        </Link>
        <PrintButton />
      </div>
      <div className="mb-6 print:hidden">
        <NotLegalAdvice />
        <p className="mt-2 text-sm text-ink-muted">
          {rider.status === "ATTACHED"
            ? `Attached as contract version ${rider.attachedContractDocument?.versionNumber ?? "?"}. This is the text that was filed.`
            : "Draft — edit it on the review page. This is how it will read when attached."}
        </p>
      </div>

      <article data-subcontract-review="rider-document">
        <h1 className="mb-4 text-xl font-semibold text-ink">{rider.title}</h1>
        {riderBlocks(rider.body).map((block, index) =>
          block.kind === "heading" ? (
            <h2 key={index} className="mb-1 mt-4 text-base font-semibold text-ink">
              {block.text}
            </h2>
          ) : block.kind === "item" ? (
            <p key={index} className="mb-1 pl-4 text-sm text-ink-body before:mr-2 before:content-['•']">
              {block.text}
            </p>
          ) : block.kind === "paragraph" ? (
            <p key={index} className="mb-2 text-sm text-ink-body">
              {block.text}
            </p>
          ) : (
            <div key={index} className="h-2" />
          ),
        )}
      </article>
    </PageShell>
  );
}
