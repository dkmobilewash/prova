import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { ComplianceUploadForm } from "@/components/ComplianceUploadForm";
import { ComplianceDocumentRow } from "@/components/ComplianceDocumentRow";
import { RenewalAlerts } from "@/components/RenewalAlerts";
import { renewalSourcesForCompany } from "@/lib/renewals";
import { renewalAlerts } from "@/lib/compliance-expiry";
import { serverToday } from "@/lib/serverToday";
import { viewerToday } from "@/lib/viewerToday";
import { toJobOption } from "@/components/jobLabels";
import { ExperienceModRates } from "@/components/ExperienceModRates";
import { loadExperienceModRates } from "@/lib/emr-query";
import { emrStanding } from "@/lib/emr";
import { supersededCoiIds } from "@/lib/coi-standing";

export default async function CompliancePage() {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company, ...currentUser } = context;

  const [documents, jobs, renewalSources, modRates] = await Promise.all([
    prisma.complianceDocument.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      include: { job: true },
    }),
    // The GC's name, for the picker: issue #65 — seven jobs sharing one
    // placeholder name made every picker seven identical rows.
    prisma.job.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      include: { contact: { select: { name: true } } },
    }),
    renewalSourcesForCompany(company.id),
    loadExperienceModRates(company.id),
  ]);

  // ONE today for the renewal rows. They decide "Expired" against the same
  // day the alerts above are computed from -- two answers for the same fact
  // is worse than either being wrong (settings/page.tsx:66).
  const today = serverToday();
  const renewals = renewalAlerts(renewalSources, today);
  // Which COI rows a renewal of the same line has replaced — the same
  // derivation the alerts above use (lib/renewals.ts), so a row can never
  // read "Expired" here while the alerts treat it as renewed.
  const superseded = supersededCoiIds(documents.filter((doc) => doc.type === "CERTIFICATE_OF_INSURANCE"));

  // A SECOND today, for a DIFFERENT fact, and deliberately so. Which mod rate
  // is in force is decided by the exact day, and on New Year's Eve evening in
  // the US the UTC day is already next year -- so serverToday() would show
  // next year's rate on a prequal form filled in that evening. The renewal
  // horizons above are 30/60-day windows where a day either way is noise.
  // Found in review; see lib/emr.ts. Derived, never stored.
  const modRateStanding = emrStanding(modRates, await viewerToday());

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Compliance</h1>
      <p className="mb-6 text-sm text-ink-body">
        Lien waivers, certificates of insurance, your experience modification rate, certified payroll, and union
        fringe/benefit filings. Upload a
        scanned document and Claude reads it into the fields below — review and fix anything before it&apos;s final.
      </p>

      {/* Above the upload form deliberately: this is the only part of the
          page that is time-sensitive, and it covers licences, policies and
          bonds that live on /settings and were never visible together. */}
      <div className="mb-8" data-tour="compliance-renewals">
        <RenewalAlerts
          renewals={renewals}
          // Sources, not alerts. `renewalAlerts` drops everything current,
          // so its length cannot tell "nothing on file" from "all current"
          // — and the panel said the second for both.
          trackedCount={renewalSources.length}
          heading="Expiring and expired"
        />
      </div>

      {/* The EMR lives here rather than on /safety, deliberately: it is an
          insurance figure issued by a rating bureau, asked for on the same
          prequalification forms as the certificates below. On /safety it
          would sit beside the OSHA log and read as something derived from
          it — which is exactly the number this app refuses to produce. */}
      <ExperienceModRates standing={modRateStanding} canDelete={currentUser.role === "OWNER"} />

      <section className="mb-8 rounded-lg border border-line-card bg-surface p-4" data-tour="compliance-upload">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Upload a document</h2>
        <ComplianceUploadForm companyId={company.id} jobs={jobs.map(toJobOption)} />
        {currentUser.role === "OWNER" && (
          <p className="mt-3 text-xs text-ink-body" data-tour="compliance-mycoi">
            Track your subs&apos; insurance in myCOI?{" "}
            <Link href="/settings/import#mycoi" className="text-link hover:text-link-hover">
              Import a myCOI export
            </Link>{" "}
            instead of uploading certificates one at a time.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Documents</h2>
        {documents.length === 0 ? (
          <p className="text-ink-body" data-tour="compliance-empty">No compliance documents yet.</p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="compliance-documents">
            {documents.map((doc) => (
              <ComplianceDocumentRow
                key={doc.id}
                canDelete={currentUser.role === "OWNER"}
                todayIso={today}
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
                  coverageType: doc.coverageType,
                  superseded: superseded.has(doc.id),
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
