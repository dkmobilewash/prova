"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { DISCLOSURE } from "@/lib/replies/draft";
import { deliver, suppressLead } from "@/lib/replies/handle";
import { actionOk, ownerRefusal, type ActionResult } from "./shared";

/**
 * THE THREE BUTTONS ON /sales/replies, operator-owner only like everything
 * on /sales. Each takes a PENDING_REVIEW row and nothing else: a reply that
 * already went, or was already dismissed, is refused with a sentence rather
 * than sent twice.
 *
 * The approved draft is whatever the person left in the textarea, with the
 * disclosure line put back if they cut it — the agent wrote the first
 * version, and the study's rule is that a machine-written message says so.
 */

type Pending = {
  id: string;
  leadId: string;
  receivedAt: Date;
  lead: { email: string | null; doNotContact: boolean };
};
type Found = { refusal: Extract<ActionResult, { ok: false }> } | { refusal?: undefined; reply: Pending; userId: string };

async function pendingReply(id: string): Promise<Found> {
  const { company, ...user } = await requireCompanyContext();
  if (!company.isProvaOperator) return { refusal: { ok: false, error: "Not found" } };
  const refusal = ownerRefusal(user, "Only the account owner can answer replies");
  if (refusal) return { refusal };
  const reply = await prisma.outboundReply.findFirst({
    where: { id, companyId: company.id },
    select: { id: true, status: true, leadId: true, receivedAt: true, lead: { select: { email: true, doNotContact: true } } },
  });
  if (!reply) return { refusal: { ok: false, error: "That reply is gone." } };
  if (reply.status !== "PENDING_REVIEW") {
    return { refusal: { ok: false, error: `Already ${reply.status.toLowerCase().replace("_", " ")} — nothing to do.` } };
  }
  return { reply, userId: user.id };
}

export async function approveReply(id: string, draft: string): Promise<ActionResult> {
  const found = await pendingReply(id);
  if (found.refusal) return found.refusal;
  const text = draft.trim();
  if (!text) return { ok: false, error: "The draft is empty — write something or dismiss it." };
  const withDisclosure = text.includes(DISCLOSURE) ? text : `${text}\n${DISCLOSURE}`;
  await prisma.outboundReply.update({ where: { id }, data: { draft: withDisclosure } });
  const sent = await deliver(id, found.userId);
  revalidatePath("/sales/replies");
  return sent.ok ? actionOk : sent;
}

export async function dismissReply(id: string): Promise<ActionResult> {
  const found = await pendingReply(id);
  if (found.refusal) return found.refusal;
  await prisma.outboundReply.update({ where: { id }, data: { status: "DISMISSED", draft: null, draftRationale: "Dismissed by hand." } });
  revalidatePath("/sales/replies");
  return actionOk;
}

/** The person read it as a stop the regex and the model missed. */
export async function markReplyStop(id: string): Promise<ActionResult> {
  const found = await pendingReply(id);
  if (found.refusal) return found.refusal;
  await prisma.outboundReply.update({
    where: { id },
    data: { classification: "STOP", classifiedBy: "person", confidence: 1 },
  });
  await suppressLead({
    leadId: found.reply.leadId,
    email: found.reply.lead.email,
    alreadyStopped: found.reply.lead.doNotContact,
    at: found.reply.receivedAt,
    replyId: id,
  });
  revalidatePath("/sales/replies");
  revalidatePath("/sales");
  return actionOk;
}
