import { describe, expect, it, vi } from "vitest";
import { readReplyClassification } from "@prova/integrations";
import { isStop, ownWords } from "./classify";
import { ALL_TEMPLATE_TEXT, DISCLOSURE, checkBackMonth, draftReply } from "./draft";
import { AUTOSEND_CONFIDENCE, autosendEnabled, decide } from "./policy";
import { sendReply, threadIds } from "./send";
import { replyFields } from "./handle";

vi.mock("@prova/db", () => ({ prisma: {} }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: vi.fn() }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));
vi.mock("@/lib/smartlead/block", () => ({ blockInSmartlead: vi.fn() }));

describe("stop is a regex, not a verdict", () => {
  it.each([
    "Stop.",
    "please stop emailing me",
    "UNSUBSCRIBE",
    "Remove me from your list",
    "take me off this list thanks",
    "Do not contact us again",
    "don't email me",
    "Not interested, please don't follow up",
    "opt out",
  ])("%s → STOP", (body) => {
    expect(isStop(body)).toBe(true);
  });

  it.each(["Stop by the yard Tuesday", "Yeah send me what you need", "slow till spring", "stop in anytime"])(
    "%s → not a stop",
    (body) => expect(isStop(body)).toBe(false),
  );

  it("ignores our own footer quoted beneath the reply", () => {
    const body = "Sure, send it over.\n\nOn Tue, Oct 14, 2026 Cyrus wrote:\n> ... To unsubscribe click here";
    expect(ownWords(body).trim()).toBe("Sure, send it over.");
    expect(isStop(body)).toBe(false);
  });
});

describe("policy thresholds", () => {
  const base = { door: "PAY_APP" as const, autosend: true };
  it("auto-sends only the three safe classes at or above the threshold", () => {
    expect(decide({ ...base, classification: "INTERESTED", confidence: AUTOSEND_CONFIDENCE })).toBe("AUTO_SEND");
    expect(decide({ ...base, classification: "SEND_INFO", confidence: 0.9 })).toBe("AUTO_SEND");
    expect(decide({ ...base, classification: "NOT_NOW", confidence: 0.95 })).toBe("AUTO_SEND");
    expect(decide({ ...base, classification: "INTERESTED", confidence: 0.79 })).toBe("PENDING_REVIEW");
    for (const classification of ["QUESTION", "UNCLEAR", "HOSTILE", "WRONG_PERSON"] as const) {
      expect(decide({ ...base, classification, confidence: 1 })).toBe("PENDING_REVIEW");
    }
  });
  it("never auto-sends an intake when the door is unknown", () => {
    expect(decide({ ...base, door: "UNKNOWN", classification: "INTERESTED", confidence: 1 })).toBe("PENDING_REVIEW");
  });
  it("suppresses STOP and dismisses out-of-office whatever the switch says", () => {
    expect(decide({ ...base, autosend: false, classification: "STOP", confidence: 0 })).toBe("SUPPRESS");
    expect(decide({ ...base, autosend: false, classification: "OUT_OF_OFFICE", confidence: 0 })).toBe("DISMISS");
  });
  it("queues everything while the switch is off, and only the literal true turns it on", () => {
    expect(decide({ ...base, autosend: false, classification: "INTERESTED", confidence: 1 })).toBe("PENDING_REVIEW");
    expect(autosendEnabled({})).toBe(false);
    expect(autosendEnabled({ REPLY_AGENT_AUTOSEND: "false" })).toBe(false);
    expect(autosendEnabled({ REPLY_AGENT_AUTOSEND: "1" })).toBe(false);
    expect(autosendEnabled({ REPLY_AGENT_AUTOSEND: "TRUE" })).toBe(true);
  });
});

describe("drafts", () => {
  const at = { firstName: "Mike", checkBackMonth: "December" };
  it("sends the right intake per door, signed as the assistant", () => {
    const payApp = draftReply({ ...at, door: "PAY_APP", classification: "INTERESTED" });
    expect(payApp.body).toContain("schedule of values");
    expect(payApp.body).toContain("GC portal");
    expect(payApp.body).toContain("end of tomorrow");
    const cpr = draftReply({ ...at, door: "CERTIFIED_PAYROLL", classification: "INTERESTED" });
    expect(cpr.body).toContain("one week of timecards");
    expect(cpr.body).toContain("job name");
    const takeoff = draftReply({ ...at, door: "TAKEOFF", classification: "INTERESTED" });
    expect(takeoff.body).toContain("drawing set as a PDF");
    expect(takeoff.body).toContain("bid due date");
    expect(takeoff.body).toContain("two days");
    for (const draft of [payApp, cpr, takeoff]) {
      expect(draft.body).toMatch(/^Hi Mike,/);
      expect(draft.body!.trimEnd().endsWith(DISCLOSURE)).toBe(true);
    }
  });
  it("names the month on not-now and asks who on wrong-person", () => {
    expect(draftReply({ ...at, door: "UNKNOWN", classification: "NOT_NOW" }).body).toContain("check back in December");
    expect(draftReply({ ...at, door: "UNKNOWN", classification: "WRONG_PERSON" }).body).toContain("who handles this");
    expect(checkBackMonth(new Date("2026-11-15T00:00:00Z"))).toBe("January");
  });
  it("has nothing to send for the classes a person must answer, or an intake with no door", () => {
    for (const classification of ["OUT_OF_OFFICE", "STOP", "HOSTILE", "QUESTION", "UNCLEAR"] as const) {
      expect(draftReply({ ...at, door: "PAY_APP", classification }).body).toBeNull();
    }
    expect(draftReply({ ...at, door: "UNKNOWN", classification: "INTERESTED" }).body).toBeNull();
    expect(draftReply({ ...at, door: "UNKNOWN", classification: "SEND_INFO" }).body).toBeNull();
  });
  it("never says a price, a job date, 'no strings', or the words nobody in the trade uses", () => {
    expect(ALL_TEMPLATE_TEXT.length).toBeGreaterThanOrEqual(7);
    for (const text of ALL_TEMPLATE_TEXT) {
      expect(text).not.toMatch(/\$|\bprice|\bcost|\bfee|per month|\/mo\b/i);
      expect(text).not.toMatch(/no strings/i);
      expect(text).not.toMatch(/A-1-131|eCPR/);
      expect(text).not.toMatch(/\b(monday|tuesday|wednesday|thursday|friday|january|february|march|april|june|july|august|september|october|november|december)\b/i);
      expect(text).not.toMatch(/\b\d{1,2}\/\d{1,2}\b/);
    }
  });
});

describe("sending", () => {
  const reply = { id: "r1", fromEmail: "mike@sub.com", draft: "Hi Mike,\nsend it.\n" + DISCLOSURE, smartleadMessageId: null };
  const ids = { emailStatsId: "stats-9", messageId: "<m1@mail>" };
  const okFetch = () =>
    vi.fn(async () => new Response(JSON.stringify({ ok: true, message_id: "sl-77" }), { status: 200 }));

  it("posts to the reply-to-thread endpoint and returns the vendor's id", async () => {
    const fetchImpl = okFetch();
    const sent = await sendReply({ reply, ids, campaignId: "4121112", apiKey: "k", fetchImpl });
    expect(sent).toEqual({ ok: true, messageId: "sl-77", alreadySent: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/campaigns/4121112/reply-email-thread?api_key=k");
    const body = JSON.parse(String(init.body));
    expect(body.email_stats_id).toBe("stats-9");
    expect(body.reply_message_id).toBe("<m1@mail>");
    expect(body.to_email).toBe("mike@sub.com");
    expect(body.email_body).toContain(DISCLOSURE);
  });

  it("is idempotent: a reply that already carries a message id is never posted again", async () => {
    const fetchImpl = okFetch();
    const sent = await sendReply({ reply: { ...reply, smartleadMessageId: "sl-77" }, ids, campaignId: "1", apiKey: "k", fetchImpl });
    expect(sent).toEqual({ ok: true, messageId: "sl-77", alreadySent: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to guess a thread id, and reports a vendor refusal as a sentence", async () => {
    const fetchImpl = okFetch();
    const none = await sendReply({ reply, ids: { emailStatsId: null, messageId: null }, campaignId: "1", apiKey: "k", fetchImpl });
    expect(none).toEqual({ ok: false, error: expect.stringContaining("No thread id") });
    expect(fetchImpl).not.toHaveBeenCalled();
    const refused = vi.fn(async () => new Response(JSON.stringify({ success: false, message: "bad stats id" }), { status: 400 }));
    const bad = await sendReply({ reply, ids, campaignId: "1", apiKey: "k", fetchImpl: refused });
    expect(bad).toEqual({ ok: false, error: 'Smartlead answered 400 ("bad stats id"). Nothing was sent.' });
  });

  it("reads every documented spelling of the thread ids and the reply text", () => {
    expect(threadIds({ stats_id: 12, reply: { message_id: "<a>" } })).toEqual({ emailStatsId: "12", messageId: "<a>" });
    expect(threadIds({ email_stats_id: "e", reply_message_id: "<b>" })).toEqual({ emailStatsId: "e", messageId: "<b>" });
    expect(threadIds({})).toEqual({ emailStatsId: null, messageId: null });
    expect(replyFields({ reply_body: "<p>Send it &amp; thanks</p>", subject: "Re: pay app" })).toEqual({
      body: "Send it & thanks",
      subject: "Re: pay app",
      previous: null,
    });
    expect(replyFields({ reply: { body: "ok", subject: "s" }, sent_message: { text: "our email" } })).toMatchObject({
      body: "ok",
      subject: "s",
      previous: "our email",
    });
  });
});

describe("reading the model", () => {
  it("throws on no tool call rather than filing UNCLEAR with a confidence it never gave", () => {
    expect(() => readReplyClassification([{ type: "text", text: "Looks interested", citations: null }])).toThrow(/no classification/);
  });
  it("clamps and defaults what the tool call carries", () => {
    const out = readReplyClassification([
      { type: "tool_use", id: "t", name: "classify_reply", input: { classification: "INTERESTED", door: "BOGUS", confidence: 7, wantsText: true, phone: " 555-0100 " } },
    ]);
    expect(out).toEqual({ classification: "INTERESTED", door: "UNKNOWN", confidence: 1, extracted: { wantsText: true, phone: "555-0100" } });
  });
});
