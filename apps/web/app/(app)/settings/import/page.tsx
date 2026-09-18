import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { SpreadsheetImport } from "@/components/SpreadsheetImport";
import { MyCoiImport } from "@/components/MyCoiImport";
import { toIsoDate } from "@/lib/compliance-expiry";

/**
 * Bringing a contractor's existing clients, jobs and crew in from a
 * spreadsheet — the other half of /settings/export.
 *
 * Owner-only, the same guard as the export page, and for the mirror-image
 * reason: that page hands the whole company's records out, this one writes
 * them in bulk. The confirm actions (lib/actions/spreadsheetImport.ts)
 * check the owner again and the capability of what each one creates,
 * because a page guard stops a page rendering and does nothing about the
 * action behind it.
 *
 * What already exists is read here and handed to each import as PROPS, so
 * the preview can say "already here" before anything is written. They are
 * props and never copied into component state: after a confirm the action
 * revalidates this path, the page re-renders with the new rows, and the
 * same file pasted again previews as "already here" — which is the proof,
 * on screen, that a second confirm would create nothing.
 */

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const context = await requireCompanyContext();
  const { company } = context;

  if (context.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-xl font-semibold text-ink">Import from a spreadsheet</h1>
        <p className="text-sm text-ink-body">
          Only the account owner can import records. Adding a whole spreadsheet of clients, jobs
          or crew at once is a different thing from adding one on its own page.
        </p>
      </div>
    );
  }

  const [contacts, jobs, crew, certificates, vendors] = await Promise.all([
    prisma.contact.findMany({ where: { companyId: company.id }, select: { name: true, accountType: true } }),
    prisma.job.findMany({
      where: { companyId: company.id },
      select: { name: true, contact: { select: { name: true } } },
    }),
    prisma.crewMember.findMany({
      where: { companyId: company.id },
      select: { legalFirstName: true, legalMiddleName: true, legalLastName: true, employeeNumber: true },
    }),
    // For the myCOI import's "already here": the same three facts the
    // confirm compares, read the same way.
    prisma.complianceDocument.findMany({
      where: { companyId: company.id, type: "CERTIFICATE_OF_INSURANCE" },
      select: { partyName: true, coverageType: true, expiresAt: true },
    }),
    prisma.vendor.findMany({ where: { companyId: company.id }, select: { name: true } }),
  ]);
  const contactNames = contacts.map((contact) => contact.name);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink" data-tour="import-intro">
        Import from a spreadsheet
      </h1>
      <p className="mb-2 text-sm text-ink-body">
        Bring in the clients, jobs and crew you already keep in Excel, Google Sheets or a
        QuickBooks export, instead of adding them one at a time.
      </p>
      <p className="mb-2 text-sm text-ink-body" data-tour="import-jobber">
        Use Jobber?{" "}
        <Link href="/settings/integrations#jobber" className="text-link hover:text-link-hover">
          Connect it instead
        </Link>{" "}
        — your clients, jobs and open quotes come straight across, with no spreadsheet in between.
      </p>
      <p className="mb-2 text-sm text-ink-body" data-tour="import-quickbooks">
        Use QuickBooks Online?{" "}
        <Link href="/settings#quickbooks-import" className="text-link hover:text-link-hover">
          Import from QuickBooks
        </Link>{" "}
        — your customers, vendors and products and services come straight across. It only reads
        QuickBooks.
      </p>
      <p className="mb-6 text-sm text-ink-body">
        Nothing is saved until you press Confirm. First you see what will be added, what is
        already in C Stream (matched by name, so importing the same file twice adds nothing the
        second time), and any rows that have a problem, with the line number. Up to 500 rows at a
        time. Clients first is easiest, but a jobs file can add its own clients too.
      </p>

      <div className="mb-8 flex flex-col gap-6">
        <div data-tour="import-clients">
          <SpreadsheetImport kind="clients" existingContactNames={contactNames} />
        </div>
        <div data-tour="import-jobs">
          <SpreadsheetImport
            kind="jobs"
            existingContactNames={contactNames}
            existingJobs={jobs.map((job) => ({ name: job.name, clientName: job.contact.name }))}
          />
        </div>
        <div data-tour="import-crew">
          <SpreadsheetImport kind="crew" existingCrew={crew} />
        </div>
        {/* The myCOI card on Settings → Integrations links here. */}
        <div id="mycoi" className="scroll-mt-6" data-tour="import-mycoi">
          <MyCoiImport
            existing={certificates.map((row) => ({
              partyName: row.partyName,
              coverageType: row.coverageType,
              expiresOn: toIsoDate(row.expiresAt),
            }))}
            known={{
              vendors: vendors.map((vendor) => vendor.name),
              subsAndSuppliers: contacts
                .filter((contact) => contact.accountType === "SUBCONTRACTOR" || contact.accountType === "VENDOR")
                .map((contact) => contact.name),
            }}
          />
        </div>
      </div>

      <p className="text-sm text-ink-body">
        <Link href="/settings" className="text-link hover:text-link-hover">
          Back to settings
        </Link>
      </p>
    </div>
  );
}
