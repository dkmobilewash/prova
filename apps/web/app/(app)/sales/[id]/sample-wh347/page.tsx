import Link from "next/link";
import { PageShell } from "@prova/ui";
import { notFound } from "next/navigation";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { buildSampleWh347, SAMPLE_PROJECT_FALLBACK } from "@/lib/sample-wh347";
import { Wh347SheetBody } from "@/components/landing/CertifiedPayrollPanel";
import { PrintButton } from "@/components/PrintButton";

/**
 * A SAMPLE WH-347 WITH THE PROSPECT'S NAME ON IT — the thing the caller
 * offers, the voicemail mentions and the follow-up email attaches.
 *
 * It is `buildWh347` on an illustrative crew (see `lib/sample-wh347.ts`),
 * stamped SAMPLE on the sheet and said again in words above it, with the
 * one thing a prospect should not be able to miss: the rates are not a
 * determination, and this is not a filing. Their real one comes from a week
 * of their real timecards.
 */
export default async function SampleWh347Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { company, ...currentUser } = await requireCompanyContext();
  if (!company.isProvaOperator) notFound();
  if (currentUser.role !== "OWNER") {
    return (
      <PageShell width="reading">
        <h1 className="mb-2 text-xl font-semibold text-ink">Owner only</h1>
        <p className="text-sm text-ink-body">The sales CRM is restricted to the account owner.</p>
      </PageShell>
    );
  }

  const lead = await prisma.salesLead.findUnique({
    where: { id },
    select: { id: true, companyId: true, companyName: true, city: true, listedOnProject: true, listedByGc: true },
  });
  if (!lead || lead.companyId !== company.id) notFound();

  const form = buildSampleWh347({
    contractorName: lead.companyName,
    city: lead.city,
    projectName: lead.listedOnProject,
  });
  const projectKnown = Boolean(lead.listedOnProject?.trim());

  return (
    // A document: `reading`, like the filing page this is a facsimile of.
    <PageShell width="reading">
      <p className="print:hidden mb-2 text-xs text-ink-muted">
        <Link href={`/sales/${lead.id}`} className="hover:underline">← {lead.companyName}</Link>
      </p>
      <div className="print:hidden mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Sample WH-347 for {lead.companyName}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-body">
            Built by the same code that builds a real one, on an illustrative three-person crew with
            illustrative wage and fringe rates — not a prevailing-wage determination, and not a filing.
            {projectKnown
              ? ` The project is the one ${lead.listedByGc ? `${lead.listedByGc} ` : ""}listed them on.`
              : ` No public listing named a project for this firm, so it reads "${SAMPLE_PROJECT_FALLBACK}".`}{" "}
            Their real one comes from one week of their real timecards.
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="[container-type:inline-size]">
        <Wh347SheetBody form={form} stamp="Sample — illustrative crew and rates, not a filing" />
      </div>

      <p className="print:hidden mt-3 text-xs text-ink-muted">
        {form.blocking.length > 0
          ? "The form reports itself as not fileable, which is correct for a sample: " +
            "page 2's statement of compliance is deliberately absent."
          : "Note: this sample is reporting itself fileable, which it must not; check lib/sample-wh347.ts."}
      </p>
    </PageShell>
  );
}
