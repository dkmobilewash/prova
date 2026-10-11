import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WHAT A SMARTLEAD WEBHOOK MEANS FOR A LEAD — pure, so the route stays thin
 * and this can be tested without a request.
 *
 * ── THE SHAPE IS NOT ONE SHAPE, AND THIS MODULE SAYS SO RATHER THAN PICKING ──
 *
 * Smartlead's own docs disagree with themselves (read 2026-10-10): the API
 * reference sends `event_type: "EMAIL_REPLY"` with `to_email` and
 * `time_replied`; the core-webhooks page sends `event: "EMAIL_REPLIED"` with
 * `timestamp`; the reply reference adds `sl_lead_email`, `event_timestamp`,
 * `webhook_id` and a `secret_key` in the BODY; the help centre says an
 * `X-Smartlead-Signature` HMAC-SHA256 header and an `X-Request-Id`. Which of
 * these a given account receives is not knowable from the docs. So this reads
 * every spelling it has seen, treats the timestamp as optional, and the route
 * STORES THE RAW BODY on every event — the first real event is what settles
 * the shape, and it must not be lost to a parser that guessed.
 *
 * ── AUTHENTICATION, FAIL CLOSED ──
 *
 * With no secret configured nothing is accepted (503, so the vendor retries
 * once it is set). With one configured, a request is accepted if EITHER the
 * signature header is a valid HMAC-SHA256 of the raw bytes, OR the body's
 * `secret_key` equals the secret — both compared in constant time. Either
 * alone is what Smartlead documents somewhere; requiring both would reject
 * whichever one this account actually sends. A forged request would need the
 * secret in both cases, so "either" is not weaker than "the one they send".
 *
 * ── THE EVENT ID, BECAUSE THE VENDOR RETRIES ANYTHING THAT IS NOT A 200 ──
 *
 * `X-Request-Id` when present; otherwise a hash of the fields the docs say to
 * dedupe on (campaign, email, type, timestamp) plus the raw body, so two
 * genuinely different events never collide and one replayed event always
 * does. It is the `OutboundEvent.vendorEventId` unique key.
 */

export const SMARTLEAD_SOURCE = "smartlead";

/** What the app does about an event, independent of how Smartlead spelled it. */
export type OutboundEffect =
  /** The lead wrote back: status REPLIED, an EMAIL activity with the preview. */
  | { kind: "REPLIED"; preview: string | null; category: string | null }
  /** The address bounced: recorded; the lead's status does not change. */
  | { kind: "BOUNCED"; detail: string | null }
  /** They unsubscribed or were categorised do-not-contact: suppressed everywhere. */
  | { kind: "SUPPRESS"; reason: string }
  /** Sent, opened, clicked, status changes — recorded and nothing else. */
  | { kind: "RECORD" };

export type ParsedSmartleadEvent = {
  type: string;
  email: string | null;
  campaignId: string | null;
  /** The vendor's time for the event, or null when it sent none. */
  occurredAt: Date | null;
  effect: OutboundEffect;
};

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): string | null =>
  typeof v === "number" ? String(v) : typeof v === "string" && v.trim() ? v.trim() : null;

function at(body: Json, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** HTML reply bodies arrive as HTML; the activity wants one readable line. */
export function previewOf(html: string | null, max = 240): string | null {
  if (!html) return null;
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Categories Smartlead's own classifier (or a person) can set that mean "stop". */
const SUPPRESSING_CATEGORIES = /do[\s_-]*not[\s_-]*contact|unsubscribe|wrong[\s_-]*person/i;

export function parseSmartleadEvent(body: Json): ParsedSmartleadEvent {
  const type = (str(at(body, "event_type", "event")) ?? "UNKNOWN").toUpperCase();
  const email =
    str(at(body, "sl_lead_email", "lead_email", "to_email", "email"))?.toLowerCase() ??
    (typeof body.lead_data === "object" && body.lead_data
      ? str((body.lead_data as Json).email)?.toLowerCase() ?? null
      : null);
  const campaignId = num(at(body, "campaign_id"));
  const rawTime = str(at(body, "event_timestamp", "time_replied", "timestamp", "time"));
  const parsedTime = rawTime ? new Date(rawTime) : null;
  const occurredAt = parsedTime && !Number.isNaN(parsedTime.getTime()) ? parsedTime : null;

  const category =
    str(at(body, "category")) ??
    (typeof body.lead_data === "object" && body.lead_data && typeof (body.lead_data as Json).category === "object"
      ? str(((body.lead_data as Json).category as Json).name)
      : null);

  let effect: OutboundEffect;
  if (/^(EMAIL_REPLY|EMAIL_REPLIED|UNTRACKED_REPLIES)$/.test(type)) {
    const html =
      str(at(body, "reply_body", "preview_text")) ??
      (typeof body.lastReply === "object" && body.lastReply ? str((body.lastReply as Json).email_body) : null);
    effect = { kind: "REPLIED", preview: previewOf(html), category };
  } else if (/^EMAIL_BOUNCE/.test(type)) {
    effect = { kind: "BOUNCED", detail: str(at(body, "bounce_reason", "reason", "error")) };
  } else if (/^(LEAD_UNSUBSCRIBED|EMAIL_UNSUBSCRIBED)$/.test(type)) {
    effect = { kind: "SUPPRESS", reason: "unsubscribed" };
  } else if (type === "LEAD_CATEGORY_UPDATED" && category && SUPPRESSING_CATEGORIES.test(category)) {
    effect = { kind: "SUPPRESS", reason: `categorised ${category}` };
  } else if (type === "LEAD_CATEGORY_UPDATED" && category && /interested|meeting/i.test(category)) {
    const html = typeof body.lastReply === "object" && body.lastReply ? str((body.lastReply as Json).email_body) : null;
    effect = { kind: "REPLIED", preview: previewOf(html), category };
  } else {
    effect = { kind: "RECORD" };
  }

  return { type, email, campaignId, occurredAt, effect };
}

/** Constant-time equality over strings of any length (unequal lengths are simply unequal). */
function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifySmartleadRequest(input: {
  secret: string;
  rawBody: string;
  signatureHeader: string | null;
  body: Json;
}): boolean {
  if (input.signatureHeader) {
    const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
    const given = input.signatureHeader.trim().replace(/^sha256=/i, "").toLowerCase();
    if (sameSecret(expected, given)) return true;
  }
  const bodyKey = str(input.body.secret_key);
  return bodyKey !== null && sameSecret(bodyKey, input.secret);
}

/** The unique id this event is recorded under. */
export function smartleadEventId(input: { requestId: string | null; rawBody: string; parsed: ParsedSmartleadEvent }): string {
  if (input.requestId) return `req:${input.requestId.trim()}`;
  const { type, email, campaignId, occurredAt } = input.parsed;
  const digest = createHmac("sha256", "smartlead-event")
    .update([type, email ?? "", campaignId ?? "", occurredAt?.toISOString() ?? "", input.rawBody].join("\n"))
    .digest("hex")
    .slice(0, 32);
  return `body:${digest}`;
}
