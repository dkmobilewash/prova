import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { ComplianceUploadForm } from "@/components/ComplianceUploadForm";
import { ComplianceDocumentRow } from "@/components/ComplianceDocumentRow";
import { RenewalAlerts } from "@/components/RenewalAlerts";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { renewalAlerts } from "@/lib/compliance-expiry";
import { serverToday } from "@/lib/serverToday";

export default async function CompliancePage() {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company, ...currentUser } = context;

  const [documents, jobs, renewalSources] = await Promise.all([
    prisma.complianceDocument.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      include: { job: true },
    }),
    prisma.job.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" } }),
    renewalSourcesForCompany(company.id),
  ]);

  const renewals = renewalAlerts(renewalSources, serverToday());

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Compliance</h1>
      <p className="mb-6 text-sm text-slate-400">
        Lien waivers, certificates of insurance, certified payroll, and union fringe/benefit filings. Upload a
        scanned document and Claude reads it into the fields below — review and fix anything before it&apos;s final.
      </p>

      {/* Above the upload form deliberately: this is the only part of the
          page that is time-sensitive, and it covers licences, policies and
          bonds that live on /settings and were never visible together. */}
      <div className="mb-8">
        <RenewalAlerts renewals={renewals} heading="Expiring and expired" />
      </div>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Upload a document</h2>
        <ComplianceUploadForm jobs={jobs.map((job) => ({ id: job.id, name: job.name }))} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Documents</h2>
        {documents.length === 0 ? (
          <p className="text-slate-400">No compliance documents yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {documents.map((doc) => (
              <ComplianceDocumentRow
                key={doc.id}
                canDelete={currentUser.role === "OWNER"}
                doc={{
                  id: doc.id,
                  type: doc.type,
                  partyName: doc.partyName,
                  status: doc.status,
                  amount: doc.amount != null ? doc.amount.toString() : null,
                  periodStart: doc.periodStart,
                  periodEnd: doc.periodEnd,
                  effectiveDate: doc.effectiveDate,
                  expiresAt: doc.expiresAt,
                  notes: doc.notes,
                  fileUrl: doc.fileUrl,
                  fileName: doc.fileName,
                  aiExtracted: doc.aiExtracted,
                  jobName: doc.job?.name ?? null,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
