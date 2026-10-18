import { Prisma, prisma } from "@prova/db";
import { unsubscribeTokenFor } from "@/lib/outbound-token";
import { SMARTLEAD_SOURCE } from "@/lib/smartlead-webhook";
import { pushLeads, selectPushable, toSmartleadLead, type OutboundConfig, type PushExclusions } from "./push";

export { outboundConfig, type OutboundConfig } from "./push";

/**
 * THE PUSH, WITH A DATABASE — shared by the 7am cron and the owner's button,
 * so the two cannot disagree about who is pushable or how much is too much.
 *
 * ── FAILS CLOSED ON FOUR SETTINGS, NOT TWO ──
 *
 * `SMARTLEAD_API_KEY` and `SMARTLEAD_CAMPAIGN_ID` are the obvious ones. The
 * other two are why nothing is sent rather than something wrong:
 * `OUTBOUND_TOKEN_SECRET` signs the unsubscribe link and `NOTIFY_BASE_URL` is
 * the origin it is built on. A cold email without a working opt-out is a
 * CAN-SPAM violation on every send, so a lead whose link cannot be built is
 * never pushed. `NOTIFY_BASE_URL` is reused rather than a new variable, for the
 * reason it exists: a run with no person behind it has no request to take a
 * host from, and a link to the wrong deployment is worse than no email.
 *
 * ── THE CAP IS A ROLLING 24 HOURS ACROSS BOTH CALLERS ──
 *
 * `OUTBOUND_DAILY_CAP` (default 50) is the warm-up limit, and sending past it
 * is how a domain gets burned. It counts the PUSHED events already written in
 * the last 24 hours, so pressing the button after the cron ran does not double
 * the day. Rolling rather than a calendar day: nobody's midnight is involved,
 * so no zone can be wrong.
 *
 * ── A RE-RUN CANNOT DOUBLE-PUSH ──
 *
 * Only `NEW` leads are selected, and the batch that went is marked `QUEUED` in
 * the same transaction as its events. The events' `vendorEventId` is
 * `push:<leadId>:<campaignId>`, unique, and written with `skipDuplicates` —
 * ON CONFLICT DO NOTHING — rather than caught: a caught P2002 inside a batch
 * transaction rolls back the whole batch, including the status writes for
 * every other lead in it, which is the one outcome that WOULD double-push.
 * The status update is also conditioned on still being NEW and not
 * suppressed, so a lead that unsubscribed mid-run keeps its DEAD.
 */

export const PUSHED = "PUSHED";

export type PushReport = {
  /** Leads the vendor accepted a request for (sum of batch sizes). */
  sent: number;
  /** What the vendor said it added / skipped — null when it did not say. */
  added: number | null;
  skipped: number | null;
  /** Room left under the cap when the run started. */
  room: number;
  dailyCap: number;
  excluded: PushExclusions;
  /** A sentence, or null. Batches before it were sent AND recorded. */
  error: string | null;
};

const sum = (xs: (number | null)[]) =>
  xs.some((x) => x !== null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null;

export async function runOutboundPush(input: {
  companyId: string;
  config: Extract<OutboundConfig, { ok: true }>;
  /** A caller's own ceiling, under the cap — never above it. */
  limit?: number;
  fetch?: typeof fetch;
}): Promise<PushReport> {
  const { companyId, config } = input;
  const now = new Date();

  const pushedRecently = await prisma.outboundEvent.count({
    where: {
      companyId,
      source: SMARTLEAD_SOURCE,
      type: PUSHED,
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
  });
  const room = Math.max(0, config.dailyCap - pushedRecently);
  const limit = Math.min(room, input.limit ?? room);

  const leads = await prisma.salesLead.findMany({
    where: { companyId },
    // Oldest first: the lead that has waited longest goes first.
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      companyName: true,
      contactName: true,
      email: true,
      phone: true,
      city: true,
      licenceNumber: true,
      doNotContact: true,
      outboundStatus: true,
    },
  });
  const { pushable, excluded } = selectPushable(leads, { limit });

  const outcome = await pushLeads(
    { apiKey: config.apiKey, fetch: input.fetch },
    config.campaignId,
    pushable,
    (lead) =>
      toSmartleadLead(lead, {
        unsubscribeUrl: `${config.baseUrl}/unsubscribe/${unsubscribeTokenFor(lead.id, config.tokenSecret)}`,
      }),
  );

  for (const batch of outcome.batches) {
    const ids = batch.leads.map((lead) => lead.id);
    await prisma.$transaction(async (tx) => {
      await tx.salesLead.updateMany({
        where: { id: { in: ids }, companyId, outboundStatus: "NEW", doNotContact: false },
        data: { outboundStatus: "QUEUED", lastOutboundAt: now },
      });
      await tx.outboundEvent.createMany({
        data: batch.leads.map((lead) => ({
          companyId,
          leadId: lead.id,
          source: SMARTLEAD_SOURCE,
          type: PUSHED,
          email: lead.email!.trim().toLowerCase(),
          vendorEventId: `push:${lead.id}:${config.campaignId}`,
          payload: {
            campaignId: config.campaignId,
            email: lead.email!.trim(),
            batchSize: batch.leads.length,
            counts: batch.counts,
            response: batch.response,
          } as Prisma.InputJsonObject,
          occurredAt: now,
        })),
        skipDuplicates: true,
      });
    });
  }

  return {
    sent: outcome.batches.reduce((a, b) => a + b.leads.length, 0),
    added: sum(outcome.batches.map((b) => b.counts.added)),
    skipped: sum(outcome.batches.map((b) => b.counts.skipped)),
    room,
    dailyCap: config.dailyCap,
    excluded,
    error: outcome.error,
  };
}
