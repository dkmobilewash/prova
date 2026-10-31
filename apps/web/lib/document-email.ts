// What a document email says, and what a person typed on the send form. Pure.
// Plain words only: these drafts promise nothing, because the person sending is
// the one making any claim, and they can rewrite it before it goes.

import type { MessageEventData } from "@/components/messageLabels";
import { messageState, stateLabel } from "@/components/messageLabels";

export type DocumentEmailDraft = { toAddress: string; toName: string; subject: string; body: string };

export function purchaseOrderEmail(input: {
  company: string;
  jobName: string;
  number: number;
  total: string;
  fileName: string;
  vendorName: string;
  vendorEmail: string | null;
}): DocumentEmailDraft {
  return {
    toAddress: input.vendorEmail ?? "",
    toName: input.vendorName,
    subject: `Purchase order ${input.number} from ${input.company}: ${input.jobName}`,
    body:
      `Attached is purchase order ${input.number} for ${input.jobName}, total ${input.total}.\n\n` +
      `Attached file: ${input.fileName}\n\nReply to this email with any questions.\n\n${input.company}`,
  };
}

export function payApplicationEmail(input: {
  company: string;
  jobName: string;
  number: number;
  periodTo: string | null;
  paymentDue: string;
  fileName: string;
  contactName: string;
  contactEmail: string | null;
}): DocumentEmailDraft {
  const period = input.periodTo ? `, for the period to ${input.periodTo}` : "";
  return {
    toAddress: input.contactEmail ?? "",
    toName: input.contactName,
    subject: `Application for payment #${input.number} from ${input.company}: ${input.jobName}`,
    body:
      `Attached is application for payment #${input.number} for ${input.jobName}${period}. ` +
      `Current payment due: ${input.paymentDue}.\n\n` +
      `Attached file: ${input.fileName}\n\nReply to this email with any questions.\n\n${input.company}`,
  };
}

/** Accepts only a real calendar day. It is required, because the form always
 * carries one. */
export function sentOnFromForm(raw: unknown): Date | null {
  const text = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const day = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text ? null : day;
}

export type SendRow = {
  id: string;
  toAddress: string;
  sentOn: string;
  /** Delivered, Bounced and so on, always derived from the provider's events. */
  status: string;
  /** Bounced, failed or marked as spam: somebody has to act. */
  needsAction: boolean;
  detail: string | null;
};

export function sendRow(row: { id: string; sentOn: string; toAddress: string; events: MessageEventData[] }): SendRow {
  const state = messageState(row.events);
  const needsAction = state === "BOUNCED" || state === "FAILED" || state === "COMPLAINED";
  const failure = row.events.find((event) => event.detail && ["BOUNCED", "FAILED", "COMPLAINED"].includes(event.type));
  return {
    id: row.id,
    toAddress: row.toAddress,
    sentOn: row.sentOn,
    status: stateLabel(state),
    needsAction,
    detail: needsAction ? (failure?.detail ?? null) : null,
  };
}
