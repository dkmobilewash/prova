import crypto from "node:crypto";
import { prisma } from "@prova/db";
import { mapResendEventType } from "@prova/integrations";

/** Delivery events from the email provider.
 *
 * NOT protected by Clerk — see the note in middleware.ts. The provider is a
 * third party with no session; this route authenticates the request itself
 * by verifying the signature below.
 *
 * FAILS CLOSED. With no webhook secret configured, every event is rejected.
 * An unverified delivery event is worse than no event at all: the whole
 * value of this log is that a "delivered" in it means something, and
 * anything that can be forged by anyone who knows the URL means nothing.
 */

export const runtime = "nodejs";

type ResendWebhookBody = {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; bounce?: { message?: string }; reason?: string };
};

/** Svix-style signature check, which is what Resend uses.
 *
 * Compares with a timing-safe equality — a plain === on a signature leaks
 * how much of it was right, one byte at a time. */
function verify(secret: string, id: string, timestamp: string, body: string, header: string): boolean {
  const base = `${secret.startsWith("whsec_") ? secret.slice(6) : secret}`;
  let key: Buffer;
  try {
    key = Buffer.from(base, "base64");
  } catch {
    return false;
  }

  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");

  // The header carries a space-separated list of versioned signatures, so a
  // provider can rotate keys without a flag day. Any one matching is enough.
  for (const part of header.split(" ")) {
    const value = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // 503 rather than 500: this is a configuration state, not a fault, and
    // the provider should retry once it's set up.
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return new Response("Missing signature headers", { status: 400 });
  }

  // Read the raw body once — verification is over the exact bytes signed,
  // so it cannot be re-serialised from parsed JSON.
  const raw = await request.text();

  // Reject anything older than five minutes so a captured request can't be
  // replayed indefinitely.
  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds) || Math.abs(Date.now() / 1000 - sentAtSeconds) > 300) {
    return new Response("Stale or invalid timestamp", { status: 400 });
  }

  if (!verify(secret, id, timestamp, raw, signature)) {
    return new Response("Bad signature", { status: 401 });
  }

  let body: ResendWebhookBody;
  try {
    body = JSON.parse(raw) as ResendWebhookBody;
  } catch {
    return new Response("Malformed body", { status: 400 });
  }

  const type = body.type ? mapResendEventType(body.type) : null;
  const providerMessageId = body.data?.email_id;
  if (!type || !providerMessageId) {
    // 200 on purpose. An event we don't model is not an error, and a
    // non-2xx makes the provider retry it forever.
    return new Response("Ignored", { status: 200 });
  }

  const message = await prisma.outboundMessage.findUnique({
    where: { providerMessageId },
    select: { id: true },
  });
  if (!message) {
    // Also 200. A message we have no record of is not something the
    // provider can fix by retrying.
    return new Response("Unknown message", { status: 200 });
  }

  // The provider's own timestamp, not ours — a webhook delayed an hour must
  // not make a prompt delivery read as a slow one.
  const occurredAt = body.created_at ? new Date(body.created_at) : new Date();

  try {
    await prisma.outboundMessageEvent.create({
      data: {
        messageId: message.id,
        type,
        occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
        detail: body.data?.bounce?.message ?? body.data?.reason ?? null,
        // Providers retry on any non-2xx. The unique constraint on this is
        // what stops a replayed bounce being counted twice and quietly
        // halving the delivery rate.
        providerEventId: id,
      },
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") {
      return new Response("Already recorded", { status: 200 });
    }
    throw err;
  }

  return new Response("Recorded", { status: 200 });
}
