import { prisma } from "@prova/db";
import { formatInstant } from "@/lib/render-date";
import type { DocuSignEnvelopeView } from "@/components/DocuSignPanel";
import { docuSignCardState, docuSignSetup, type DocuSignCardState } from "./setup";
import { STATUS_LABEL, type TrackedStatus } from "./envelope-status";
import { integrationEncryptionConfigured } from "@/lib/crypto";

/**
 * What the job page needs to render every DocuSign panel on it, in one read:
 * whether DocuSign is usable here, and this job's envelopes grouped by what
 * they were for. Dates are formatted here, on the server, in the viewer's
 * zone — the panel is a client component and computing dates in it would
 * break hydration (CLAUDE.md, Dates).
 *
 * Scoped to the company as well as the job, although the job was already
 * proved to be this company's, so a mistake at the call site reads nothing.
 */

export type JobDocuSign = {
  state: DocuSignCardState;
  autoUpdates: boolean;
  contractSummary: DocuSignEnvelopeView[];
  byContractDocument: Map<string, DocuSignEnvelopeView[]>;
  byChangeOrder: Map<string, DocuSignEnvelopeView[]>;
};

function recipientsLine(value: unknown): string {
  if (!Array.isArray(value)) return "—";
  return value
    .map((entry) => {
      const r = entry as { name?: unknown; email?: unknown };
      return typeof r.name === "string" && typeof r.email === "string" ? `${r.name} <${r.email}>` : null;
    })
    .filter(Boolean)
    .join(", ");
}

export async function loadJobDocuSign(companyId: string, jobId: string, timeZone: string): Promise<JobDocuSign> {
  const setup = docuSignSetup(process.env);
  const connection = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "DOCUSIGN" } },
    select: { status: true },
  });
  const state = docuSignCardState(setup.configured && integrationEncryptionConfigured(), connection?.status);

  const rows =
    state === "not-set-up"
      ? []
      : await prisma.docuSignEnvelope.findMany({
          where: { companyId, jobId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            subject: true,
            contractDocumentId: true,
            changeOrderId: true,
            status: true,
            documentName: true,
            recipients: true,
            sentAt: true,
            deliveredAt: true,
            completedAt: true,
            declinedAt: true,
            voidedAt: true,
            voidedReason: true,
            signedDocumentUrl: true,
            certificateUrl: true,
          },
        });

  const at = (date: Date) => formatInstant(date, timeZone, "medium");
  const result: JobDocuSign = {
    state,
    autoUpdates: setup.webhooks,
    contractSummary: [],
    byContractDocument: new Map(),
    byChangeOrder: new Map(),
  };

  for (const row of rows) {
    const timeline = [`Sent ${at(row.sentAt)}`];
    if (row.deliveredAt) timeline.push(`Opened ${at(row.deliveredAt)}`);
    if (row.completedAt) timeline.push(`Signed by everyone ${at(row.completedAt)}`);
    if (row.declinedAt) timeline.push(`Declined ${at(row.declinedAt)}`);
    if (row.voidedAt) timeline.push(`Voided ${at(row.voidedAt)}`);
    if (row.status === "VOIDED" && !row.voidedAt) timeline.push("Voided (DocuSign did not report the time)");
    if (row.status === "COMPLETED" && !row.signedDocumentUrl) timeline.push("Signed — the signed copy hasn't been saved here yet. Press Refresh.");

    const view: DocuSignEnvelopeView = {
      id: row.id,
      status: row.status,
      statusLabel: STATUS_LABEL[row.status as TrackedStatus],
      documentName: row.documentName,
      recipients: recipientsLine(row.recipients),
      timeline,
      voidedReason: row.voidedReason,
      signedDocumentUrl: row.signedDocumentUrl,
      certificateUrl: row.certificateUrl,
    };

    if (row.subject === "CONTRACT_SUMMARY") result.contractSummary.push(view);
    const key = row.subject === "CONTRACT_DOCUMENT" ? row.contractDocumentId : row.subject === "CHANGE_ORDER" ? row.changeOrderId : null;
    const map = row.subject === "CONTRACT_DOCUMENT" ? result.byContractDocument : result.byChangeOrder;
    if (key && row.subject !== "CONTRACT_SUMMARY") map.set(key, [...(map.get(key) ?? []), view]);
  }

  return result;
}
