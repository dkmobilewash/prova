import { Prisma, prisma } from "@prova/db";
import { isUniqueConstraintError } from "@/lib/actions/shared";
import {
  parseSmartleadEvent,
  SMARTLEAD_SOURCE,
  smartleadEventId,
  verifySmartleadRequest,
} from "@/lib/smartlead-webhook";

/** Events from the cold-email sequencer (Smartlead): reply, bounce,
 * unsubscribe, category change.
 *
 * NOT protected by Clerk — see the note in middleware.ts. The vendor has no
 * session; this route authenticates the request itself. FAILS CLOSED: with
 * no secret configured nothing is accepted (503, so the vendor retries once
 * it is set), exactly like /api/messages/webhook.
 *
 * Every accepted event is stored RAW in `OutboundEvent` before anything is
 * derived from it — the vendor's documents disagree on the payload shape
 * (lib/smartlead-webhook.ts), so the first real event is what settles it and
 * must not be lost to a parser that guessed. `vendorEventId` is unique and
 * a duplicate is a 200: the vendor retries anything that is not a 200, and a
 * reply recorded twice is a reply rate that is wrong.
 *
 * The events belong to the OPERATOR company — Prova's own pipeline — because
 * that is whose sequencer this is. A lead is matched by email inside it.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.SMARTLEAD_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Webhook secret not configured", { status: 503 });

  const rawBody = await request.text();
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const signatureHeader = request.headers.get("x-smartlead-signature");
  if (!verifySmartleadRequest({ secret, rawBody, signatureHeader, body })) {
    return new Response("Bad signature", { status: 401 });
  }

  const operator = await prisma.company.findFirst({ where: { isProvaOperator: true }, select: { id: true } });
  if (!operator) {
    // Configuration, not a fault: nothing to attach an event to yet.
    return new Response("No operator company", { status: 503 });
  }

  const parsed = parseSmartleadEvent(body);
  const vendorEventId = smartleadEventId({ requestId: request.headers.get("x-request-id"), rawBody, parsed });

  const lead = parsed.email
    ? await prisma.salesLead.findFirst({
        where: { companyId: operator.id, email: { equals: parsed.email, mode: "insensitive" } },
        select: { id: true, doNotContact: true },
      })
    : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.outboundEvent.create({
        data: {
          companyId: operator.id,
          leadId: lead?.id ?? null,
          source: SMARTLEAD_SOURCE,
          type: parsed.type,
          email: parsed.email,
          vendorEventId,
          payload: body as Prisma.InputJsonObject,
          occurredAt: parsed.occurredAt,
        },
      });
      if (!lead) return;

      const touch = parsed.occurredAt ? { lastOutboundAt: parsed.occurredAt } : {};
      const effect = parsed.effect;
      if (effect.kind === "REPLIED") {
        await tx.salesLead.update({
          where: { id: lead.id },
          data: { ...touch, ...(lead.doNotContact ? {} : { outboundStatus: "REPLIED" }) },
        });
        await tx.salesActivity.create({
          data: {
            companyId: operator.id,
            leadId: lead.id,
            type: "EMAIL",
            // The vendor's time, or the receipt if it sent none — a reply the
            // app cannot date is still a reply somebody has to read today.
            occurredOn: parsed.occurredAt ?? new Date(),
            summary: `[REPLY${effect.category ? ` · ${effect.category}` : ""}] ${effect.preview ?? "(no text)"}`,
          },
        });
      } else if (effect.kind === "SUPPRESS") {
        await tx.salesLead.update({
          where: { id: lead.id },
          data: {
            ...touch,
            doNotContact: true,
            doNotContactReason: lead.doNotContact ? undefined : `${SMARTLEAD_SOURCE}: ${effect.reason}`,
            doNotContactAt: lead.doNotContact ? undefined : (parsed.occurredAt ?? new Date()),
            outboundStatus: "DEAD",
          },
        });
      } else if (effect.kind === "BOUNCED") {
        await tx.salesLead.update({ where: { id: lead.id }, data: touch });
      } else if (parsed.type === "EMAIL_SENT") {
        await tx.salesLead.update({
          where: { id: lead.id },
          data: { ...touch, ...(lead.doNotContact ? {} : { outboundStatus: "SEQUENCED" }) },
        });
      }
    });
  } catch (error) {
    // `code`, not instanceof — that instanceof is false at runtime here (see
    // isUniqueConstraintError), and a guard that never fires would turn every
    // vendor retry into a 500 and another retry.
    if (isUniqueConstraintError(error)) {
      return new Response("Duplicate event", { status: 200 });
    }
    throw error;
  }

  return new Response(lead ? "OK" : "OK (no matching lead)", { status: 200 });
}
