import { g702Document, party, type G702Document } from "@/lib/billing/g702";
import { loadPayApplication } from "@/lib/pay-application-query";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";

type View = NonNullable<Awaited<ReturnType<typeof loadPayApplication>>>;

type Company = {
  name: string;
  dbaName: string | null;
  hqAddressLine1: string | null;
  hqAddressLine2: string | null;
  hqCity: string | null;
  hqState: string | null;
  hqZip: string | null;
  phone: string | null;
};

/** One object for the screen, the download and the email, so what is on screen
 * and what goes out cannot differ. */
export function payApplicationDocument(view: View, company: Company, timeZone: string): G702Document {
  const { job, invoice, lineItems: lineItemResults, summary } = view;
  return g702Document({
    header: {
      project: job.name,
      projectLocation: job.projectLocation ?? job.siteAddress ?? null,
      to: party(job.contact.name, job.contact.address),
      from: party(
        company.dbaName ? `${company.name} (dba ${company.dbaName})` : company.name,
        company.hqAddressLine1,
        company.hqAddressLine2,
        [company.hqCity, company.hqState, company.hqZip].filter(Boolean).join(" ").replace(/^(\S.*) (\S+) (\S+)$/, "$1, $2 $3") || null,
        company.phone,
      ),
      contractFor: job.scope ?? null,
      applicationNumber: invoice.number,
      applicationDate: formatInstant(invoice.issuedAt, timeZone),
      periodTo: invoice.periodTo ? formatCalendarDate(invoice.periodTo) : null,
      contractDate: view.contractDate ? formatCalendarDate(view.contractDate) : null,
      projectNumber: job.contractNumber ?? null,
    },
    lineItems: lineItemResults,
    summary,
    netChangeByChangeOrders: view.netChangeByChangeOrders,
  });
}
