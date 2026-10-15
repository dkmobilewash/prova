import { createHash } from "node:crypto";
import { prisma } from "@prova/db";
import { isUniqueConstraintError } from "@/lib/actions/shared";
import { previewOf } from "@/lib/smartlead-webhook";
import { blockInSmartlead } from "@/lib/smartlead/block";
import { splitName } from "@/lib/smartlead/push";
import { classifyReply } from "./classify";
import { checkBackMonth, draftReply } from "./draft";
import { autosendEnabled, decide } from "./policy";
import { sendReply, threadIds } from "./send";

/**
 * ONE REPLY, END TO END: classify → draft → decide → send or queue.
 *
 * Called by the webhook AFTER the event and the activity are committed, inside
 * a try/catch there, so nothing in here can turn a recorded reply into a
 * vendor retry. A second call for the same event hits the unique `eventId`
 * and returns — the row that exists is the answer.
 *
 * What it writes besides the `OutboundReply` row: on STOP, the lead's
 * suppression flag and the Smartlead block (the same two things the
 * unsubscribe link does); on "text me at <number>", a `ConsentRecord` whose
 * text is the reply itself — a written request to be texted, kept verbatim
 * with its hash, which is what the texting rule in the research asks for.
 */

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** The reply's text, subject and the email it answers, in every spelling seen. */
export function replyFields(payload: Json): { body: string | null; subject: string | null; previous: string | null } {
  const reply = obj(payload.reply);
  const lastReply = obj(payload.lastReply);
  const sent = obj(payload.sent_message);
  const html =
    str(payload.reply_body) ?? str(reply.body) ?? str(lastReply.email_body) ?? str(payload.preview_text);
  return {
    body: previewOf(html, 20000),
    subject: str(payload.subject) ?? str(reply.subject) ?? str(payload.subject_line) ?? str(sent.subject),
    previous: previewOf(str(payload.sent_message_body) ?? str(sent.text) ?? str(sent.html), 8000),
  };
}

export async function handleReply(eventId: string): Promise<void> {
  const event = await prisma.outboundEvent.findUnique({
    where: { id: eventId },
    include: { lead: { select: { id: true, contactName: true, email: true, doNotContact: true } } },
  });
  if (!event?.lead) return;
  const payload = obj(event.payload);
  const fields = replyFields(payload);
  const body = fields.body ?? "";
  const receivedAt = event.occurredAt ?? event.createdAt;

  const verdict = await classifyReply({
    companyId: event.companyId,
    subject: fields.subject,
    body,
    previousOutbound: fields.previous,
  });
  const draft = draftReply({
    door: verdict.door,
    classification: verdict.classification,
    firstName: splitName(event.lead.contactName).first || null,
    checkBackMonth: checkBackMonth(receivedAt),
  });
  const decision = decide({
    classification: verdict.classification,
    confidence: verdict.confidence,
    door: verdict.door,
    autosend: autosendEnabled(process.env),
  });

  let reply;
  try {
    reply = await prisma.outboundReply.create({
      data: {
        companyId: event.companyId,
        leadId: event.lead.id,
        eventId: event.id,
        fromEmail: event.email ?? event.lead.email ?? "",
        subject: fields.subject,
        bodyText: body,
        receivedAt,
        classification: verdict.classification,
        classifiedBy: "model",
        door: verdict.door,
        confidence: verdict.confidence,
        draft: draft.body,
        draftRationale: draft.rationale,
        status: decision === "SUPPRESS" ? "SUPPRESSED" : decision === "DISMISS" ? "DISMISSED" : "PENDING_REVIEW",
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return;
    throw error;
  }

  if (verdict.extracted.wantsText && verdict.extracted.phone) {
    await prisma.consentRecord.create({
      data: {
        companyId: event.companyId,
        leadId: event.lead.id,
        phone: verdict.extracted.phone,
        text: body,
        textHash: createHash("sha256").update(body).digest("hex"),
        textVersion: "email-reply.1",
        checked: true,
        capturedAt: receivedAt,
        source: "email-reply",
      },
    });
  }

  if (decision === "SUPPRESS") {
    await suppressLead({ leadId: event.lead.id, email: event.lead.email, alreadyStopped: event.lead.doNotContact, at: receivedAt, replyId: reply.id });
    return;
  }
  if (decision === "AUTO_SEND") await deliver(reply.id, "agent");
}

/** The STOP outcome, shared with the "Mark stop" button. */
export async function suppressLead(input: {
  leadId: string;
  email: string | null;
  alreadyStopped: boolean;
  at: Date;
  replyId: string;
}): Promise<void> {
  const vendorBlock = input.alreadyStopped ? "already stopped" : await blockInSmartlead(input.email);
  await prisma.$transaction([
    prisma.salesLead.update({
      where: { id: input.leadId },
      data: {
        doNotContact: true,
        doNotContactReason: input.alreadyStopped ? undefined : "replied stop",
        doNotContactAt: input.alreadyStopped ? undefined : input.at,
        outboundStatus: "DEAD",
      },
    }),
    prisma.outboundReply.update({
      where: { id: input.replyId },
      data: { status: "SUPPRESSED", draft: null, draftRationale: `Asked to stop — suppressed; ${vendorBlock}.` },
    }),
  ]);
}

/**
 * Send a reply's draft and record that it went. Shared by the auto-send and
 * the approve button; `by` is `agent` or the approving user's id. A failed
 * send leaves the row PENDING_REVIEW with the reason on it, so a person sees
 * it rather than a log line.
 */
export async function deliver(replyId: string, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const reply = await prisma.outboundReply.findUnique({
    where: { id: replyId },
    select: { id: true, companyId: true, leadId: true, fromEmail: true, draft: true, smartleadMessageId: true, event: { select: { payload: true } } },
  });
  if (!reply) return { ok: false, error: "That reply is gone." };
  const payload = obj(reply.event.payload);
  const apiKey = process.env.SMARTLEAD_API_KEY?.trim();
  const campaignId = str(payload.campaign_id) ?? (typeof payload.campaign_id === "number" ? String(payload.campaign_id) : null) ?? process.env.SMARTLEAD_CAMPAIGN_ID?.trim();
  if (!apiKey || !campaignId) {
    const error = `Not sent: ${!apiKey ? "SMARTLEAD_API_KEY" : "SMARTLEAD_CAMPAIGN_ID"} is not set on this deployment.`;
    await prisma.outboundReply.update({ where: { id: reply.id }, data: { status: "PENDING_REVIEW", draftRationale: error } });
    return { ok: false, error };
  }
  const sent = await sendReply({ reply, ids: threadIds(payload), campaignId, apiKey });
  if (!sent.ok) {
    await prisma.outboundReply.update({ where: { id: reply.id }, data: { status: "PENDING_REVIEW", draftRationale: sent.error } });
    return sent;
  }
  if (sent.alreadySent) return { ok: true };
  const now = new Date();
  await prisma.$transaction([
    prisma.outboundReply.update({
      where: { id: reply.id },
      data: { status: by === "agent" ? "AUTO_SENT" : "APPROVED_SENT", sentAt: now, sentBy: by, smartleadMessageId: sent.messageId },
    }),
    prisma.salesActivity.create({
      data: {
        companyId: reply.companyId,
        leadId: reply.leadId,
        type: "EMAIL",
        occurredOn: now,
        summary: `[REPLY SENT${by === "agent" ? " · assistant" : ""}] ${previewOf(reply.draft) ?? ""}`,
      },
    }),
  ]);
  return { ok: true };
}
