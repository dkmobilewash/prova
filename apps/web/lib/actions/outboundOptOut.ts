"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { leadIdFromToken } from "@/lib/outbound-token";
import { blockInSmartlead } from "@/lib/smartlead/block";

/**
 * THE UNSUBSCRIBE LINK'S ONE BUTTON. Public — no session, by design (CAN-SPAM:
 * the opt-out must need nothing but a click). The signed token is the whole of
 * the authority, and it can do exactly one thing: stop email to its own lead.
 *
 * Returns nothing, deliberately, rather than an ActionResult: it is a plain
 * `<form action>` on a page with no client component, and the page reads the
 * RESULT back from the lead itself (`doNotContact`) rather than from a return
 * value — derived, never a flag passed along. A bad token does nothing; the
 * page already says the link is not valid.
 *
 * ALSO TELLS SMARTLEAD (`lib/smartlead/block.ts`), because our flag does not
 * stop a sequence that is already running there. Whatever it answered is
 * stored on the event, so a failed block is visible rather than assumed.
 */
export async function unsubscribeByToken(token: string): Promise<void> {
  const leadId = leadIdFromToken(token);
  if (!leadId) return;
  const lead = await prisma.salesLead.findUnique({
    where: { id: leadId },
    select: { id: true, companyId: true, email: true, doNotContact: true },
  });
  // Already stopped (by this link, a reply, a call) — a second click changes nothing.
  if (!lead || lead.doNotContact) return;

  const vendorBlock = await blockInSmartlead(lead.email);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.salesLead.updateMany({
      where: { id: lead.id, doNotContact: false },
      data: {
        doNotContact: true,
        doNotContactReason: "unsubscribed via link",
        doNotContactAt: now,
        outboundStatus: "DEAD",
      },
    });
    // A double-click races here; the loser records nothing.
    if (count === 0) return;
    await tx.outboundEvent.create({
      data: {
        companyId: lead.companyId,
        leadId: lead.id,
        source: "unsubscribe-page",
        type: "UNSUBSCRIBED",
        email: lead.email?.trim().toLowerCase() ?? null,
        vendorEventId: `unsub:${lead.id}:${now.getTime()}`,
        payload: { vendorBlock },
        occurredAt: now,
      },
    });
  });
  revalidatePath(`/unsubscribe/${token}`);
}
