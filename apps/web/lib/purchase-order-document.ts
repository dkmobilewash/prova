import { party } from "@/lib/billing/g702";
import type { PurchaseOrderDocument } from "@/lib/purchase-order-pdf";
import { formatCalendarDate } from "@/lib/render-date";

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

type Po = {
  number: number;
  status: PurchaseOrderDocument["status"];
  issuedOn: Date | null;
  vendor: { name: string; contactName: string | null; phone: string | null; email: string | null };
  lines: { description: string; quantity: unknown; unit: string | null; unitPrice: unknown }[];
};

/** One document for the download and the email, so they cannot differ. */
export function purchaseOrderDocument(
  po: Po,
  job: { name: string; siteAddress: string | null; projectLocation: string | null; contractNumber: string | null },
  company: Company,
): PurchaseOrderDocument {
  return {
    number: po.number,
    status: po.status,
    issuedOn: po.issuedOn ? formatCalendarDate(po.issuedOn) : null,
    from: party(
      company.dbaName ? `${company.name} (dba ${company.dbaName})` : company.name,
      company.hqAddressLine1,
      company.hqAddressLine2,
      [company.hqCity, company.hqState, company.hqZip].filter(Boolean).join(" ") || null,
      company.phone,
    ),
    vendor: party(po.vendor.name, po.vendor.contactName, po.vendor.phone, po.vendor.email),
    jobName: job.name,
    shipTo: job.siteAddress ?? job.projectLocation ?? null,
    contractNumber: job.contractNumber,
    lines: po.lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unit: line.unit,
      unitPrice: Number(line.unitPrice),
    })),
  };
}
