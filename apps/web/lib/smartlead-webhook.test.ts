import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseSmartleadEvent,
  previewOf,
  smartleadEventId,
  verifySmartleadRequest,
} from "./smartlead-webhook";

/** Every address and name here is invented. The three payload spellings are
 * the three Smartlead's own documents give, so a parser that only knew one
 * would fail two of these. */

const SECRET = "test-secret-not-real";

describe("reading an event in each of the spellings the vendor documents", () => {
  it("reads the API-reference reply shape", () => {
    const parsed = parseSmartleadEvent({
      event_type: "EMAIL_REPLY",
      to_email: "Owner@BakerDrywall.example",
      campaign_id: 123,
      time_replied: "2026-10-10T14:05:00Z",
      reply_body: "<div>Sure, <b>send it</b> over.<br/>Thanks</div>",
    });
    expect(parsed.type).toBe("EMAIL_REPLY");
    expect(parsed.email).toBe("owner@bakerdrywall.example");
    expect(parsed.campaignId).toBe("123");
    expect(parsed.occurredAt?.toISOString()).toBe("2026-10-10T14:05:00.000Z");
    expect(parsed.effect).toEqual({ kind: "REPLIED", preview: "Sure, send it over. Thanks", category: null });
  });

  it("reads the core-webhooks shape with `event` and `timestamp`", () => {
    const parsed = parseSmartleadEvent({
      event: "EMAIL_REPLIED",
      email: "office@summitacoustics.example",
      campaign_id: "7",
      timestamp: "2026-10-10T15:00:00Z",
      preview_text: "Who is this?",
    });
    expect(parsed.type).toBe("EMAIL_REPLIED");
    expect(parsed.effect.kind).toBe("REPLIED");
    expect(parsed.email).toBe("office@summitacoustics.example");
  });

  it("reads the reply-reference shape with sl_lead_email and event_timestamp", () => {
    const parsed = parseSmartleadEvent({
      event_type: "EMAIL_REPLY",
      sl_lead_email: "luis@mendozaplaster.example",
      event_timestamp: "2026-10-10T16:00:00Z",
      campaign_id: 9,
      secret_key: "x",
    });
    expect(parsed.email).toBe("luis@mendozaplaster.example");
    expect(parsed.occurredAt).not.toBeNull();
  });

  it("treats an unsubscribe as suppression even with no timestamp", () => {
    const parsed = parseSmartleadEvent({
      event_type: "LEAD_UNSUBSCRIBED",
      lead_email: "owner@bakerdrywall.example",
      campaign_id: 123,
    });
    expect(parsed.occurredAt).toBeNull();
    expect(parsed.effect).toEqual({ kind: "SUPPRESS", reason: "unsubscribed" });
  });

  it("reads a category change: do-not-contact suppresses, interested is a reply, anything else is recorded", () => {
    const base = { event_type: "LEAD_CATEGORY_UPDATED", lead_email: "a@b.example", campaign_id: 1 };
    expect(parseSmartleadEvent({ ...base, category: "Do Not Contact" }).effect).toEqual({
      kind: "SUPPRESS",
      reason: "categorised Do Not Contact",
    });
    expect(parseSmartleadEvent({ ...base, lead_data: { email: "a@b.example", category: { name: "Interested" } }, lastReply: { email_body: "<p>yes call me</p>" } }).effect).toEqual({
      kind: "REPLIED",
      preview: "yes call me",
      category: "Interested",
    });
    expect(parseSmartleadEvent({ ...base, category: "Out Of Office" }).effect).toEqual({ kind: "RECORD" });
  });

  it("records what it does not understand rather than guessing", () => {
    const parsed = parseSmartleadEvent({ event_type: "EMAIL_OPEN", to_email: "a@b.example" });
    expect(parsed.effect).toEqual({ kind: "RECORD" });
    expect(parseSmartleadEvent({}).type).toBe("UNKNOWN");
    expect(parseSmartleadEvent({ event_type: "EMAIL_REPLY", time_replied: "not a date" }).occurredAt).toBeNull();
  });
});

describe("the preview line", () => {
  it("strips tags and entities and caps the length", () => {
    expect(previewOf("<p>A &amp; B</p>")).toBe("A & B");
    expect(previewOf("<style>p{}</style>  ")).toBeNull();
    expect(previewOf("x".repeat(300))!.length).toBe(240);
  });
});

describe("authentication, fail closed", () => {
  const rawBody = JSON.stringify({ event_type: "EMAIL_REPLY", secret_key: "wrong" });
  const body = JSON.parse(rawBody);

  it("accepts a valid HMAC header", () => {
    const sig = createHmac("sha256", SECRET).update(rawBody).digest("hex");
    expect(verifySmartleadRequest({ secret: SECRET, rawBody, signatureHeader: `sha256=${sig}`, body })).toBe(true);
    expect(verifySmartleadRequest({ secret: SECRET, rawBody, signatureHeader: sig.toUpperCase(), body })).toBe(true);
  });

  it("accepts the body secret when it matches, and nothing when nothing matches", () => {
    const good = JSON.stringify({ event_type: "EMAIL_REPLY", secret_key: SECRET });
    expect(verifySmartleadRequest({ secret: SECRET, rawBody: good, signatureHeader: null, body: JSON.parse(good) })).toBe(true);
    expect(verifySmartleadRequest({ secret: SECRET, rawBody, signatureHeader: null, body })).toBe(false);
    expect(verifySmartleadRequest({ secret: SECRET, rawBody, signatureHeader: "deadbeef", body })).toBe(false);
  });
});

describe("the event id the retry defence rests on", () => {
  const parsed = parseSmartleadEvent({ event_type: "EMAIL_REPLY", to_email: "a@b.example", campaign_id: 1, time_replied: "2026-10-10T14:05:00Z" });

  it("prefers the vendor's request id", () => {
    expect(smartleadEventId({ requestId: "abc-123", rawBody: "{}", parsed })).toBe("req:abc-123");
  });

  it("is stable for the same body and different for a different one", () => {
    const a = smartleadEventId({ requestId: null, rawBody: '{"x":1}', parsed });
    const b = smartleadEventId({ requestId: null, rawBody: '{"x":1}', parsed });
    const c = smartleadEventId({ requestId: null, rawBody: '{"x":2}', parsed });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("body:")).toBe(true);
  });
});
