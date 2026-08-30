import { describe, expect, it } from "vitest";
import {
  type MessageData,
  type MessageEventData,
  arrived,
  channelLabel,
  deliveryRate,
  messageState,
  needsAttention,
  newestFirst,
  recipient,
  stale,
  stateLabel,
} from "@/components/messageLabels";

let seq = 0;
function ev(type: string, occurredAt: string, detail: string | null = null): MessageEventData {
  return { id: `e${++seq}`, type, occurredAt, detail };
}

function msg(events: MessageEventData[], sentAt = "2026-08-28"): MessageData {
  return {
    id: `m${++seq}`,
    channel: "EMAIL",
    toAddress: "super@gc.example",
    toName: null,
    subject: "RFI 4",
    fromAddress: "office@cyrusdrywall.com",
    sentAt,
    events,
  };
}

describe("messageState", () => {
  it("is UNKNOWN when the provider has said nothing", () => {
    expect(messageState([])).toBe("UNKNOWN");
  });

  it("is IN_FLIGHT on queued or sent", () => {
    expect(messageState([ev("QUEUED", "2026-08-28T10:00:00Z")])).toBe("IN_FLIGHT");
    expect(messageState([ev("SENT", "2026-08-28T10:00:01Z")])).toBe("IN_FLIGHT");
  });

  it("is DELIVERED once the far end accepts it", () => {
    expect(
      messageState([ev("SENT", "2026-08-28T10:00:00Z"), ev("DELIVERED", "2026-08-28T10:00:04Z")]),
    ).toBe("DELIVERED");
  });

  it("follows the newest event, not array order", () => {
    const delivered = ev("DELIVERED", "2026-08-28T10:00:04Z");
    const sent = ev("SENT", "2026-08-28T10:00:00Z");
    expect(messageState([delivered, sent])).toBe("DELIVERED");
    expect(messageState([sent, delivered])).toBe("DELIVERED");
  });

  it("reports a bounce that arrives after a send", () => {
    expect(
      messageState([ev("SENT", "2026-08-28T10:00:00Z"), ev("BOUNCED", "2026-08-28T10:00:09Z", "550 no such user")]),
    ).toBe("BOUNCED");
  });

  // A complaint after a delivery is the sequence that matters most for the
  // sending domain, and it must not be hidden by the earlier success.
  it("reports a complaint that lands after a delivery", () => {
    expect(
      messageState([
        ev("SENT", "2026-08-28T10:00:00Z"),
        ev("DELIVERED", "2026-08-28T10:00:04Z"),
        ev("COMPLAINED", "2026-08-29T08:00:00Z"),
      ]),
    ).toBe("COMPLAINED");
  });

  // OPENED must never become the state. If it could, a later open would
  // overwrite a bounce — a message can be opened by one recipient and have
  // bounced for another.
  it("never lets an open overwrite a bounce", () => {
    expect(
      messageState([
        ev("SENT", "2026-08-28T10:00:00Z"),
        ev("BOUNCED", "2026-08-28T10:00:09Z", "550"),
        ev("OPENED", "2026-08-28T11:00:00Z"),
      ]),
    ).toBe("BOUNCED");
  });

  it("never lets an open alone imply delivery", () => {
    expect(messageState([ev("OPENED", "2026-08-28T11:00:00Z")])).toBe("UNKNOWN");
  });

  it("is FAILED when it never reached the provider", () => {
    expect(messageState([ev("FAILED", "2026-08-28T10:00:00Z", "no API key configured")])).toBe("FAILED");
  });

  it("labels every state", () => {
    expect(stateLabel("UNKNOWN")).toBe("No word back yet");
    expect(stateLabel("IN_FLIGHT")).toBe("Handed over, not confirmed");
    expect(stateLabel("DELIVERED")).toBe("Delivered");
    expect(stateLabel("BOUNCED")).toBe("Bounced");
    expect(stateLabel("COMPLAINED")).toBe("Marked as spam");
    expect(stateLabel("FAILED")).toBe("Never sent");
  });
});

describe("newestFirst", () => {
  it("does not mutate its input", () => {
    const input = [ev("SENT", "2026-08-28T10:00:00Z"), ev("DELIVERED", "2026-08-28T10:00:04Z")];
    const before = input.map((e) => e.id);
    newestFirst(input);
    expect(input.map((e) => e.id)).toEqual(before);
  });

  // Two events can genuinely share a timestamp. Without a tiebreak the sort
  // is unstable and the derived status can flicker between renders.
  it("is stable when two events share a timestamp", () => {
    const a = ev("SENT", "2026-08-28T10:00:00Z");
    const b = ev("DELIVERED", "2026-08-28T10:00:00Z");
    const one = newestFirst([a, b]).map((e) => e.id);
    const two = newestFirst([b, a]).map((e) => e.id);
    expect(one).toEqual(two);
  });
});

describe("arrived / needsAttention", () => {
  it("arrived only on delivery", () => {
    expect(arrived([ev("DELIVERED", "2026-08-28T10:00:04Z")])).toBe(true);
    expect(arrived([ev("SENT", "2026-08-28T10:00:00Z")])).toBe(false);
    expect(arrived([])).toBe(false);
  });

  it("flags bounced, failed and complained", () => {
    expect(needsAttention([ev("BOUNCED", "2026-08-28T10:00:09Z")])).toBe(true);
    expect(needsAttention([ev("FAILED", "2026-08-28T10:00:00Z")])).toBe(true);
    expect(needsAttention([ev("COMPLAINED", "2026-08-29T08:00:00Z")])).toBe(true);
  });

  // Silence is not itself a failure — see `stale` for when it becomes one.
  it("does not flag silence or success", () => {
    expect(needsAttention([])).toBe(false);
    expect(needsAttention([ev("DELIVERED", "2026-08-28T10:00:04Z")])).toBe(false);
    expect(needsAttention([ev("SENT", "2026-08-28T10:00:00Z")])).toBe(false);
  });
});

describe("stale", () => {
  const TODAY = "2026-08-30";

  it("is stale when unconfirmed for a day or more", () => {
    expect(stale(msg([], "2026-08-28"), TODAY)).toBe(true);
    expect(stale(msg([ev("SENT", "2026-08-28T10:00:00Z")], "2026-08-28"), TODAY)).toBe(true);
  });

  it("is not stale on the same day", () => {
    expect(stale(msg([], TODAY), TODAY)).toBe(false);
  });

  it("is never stale once the provider has decided", () => {
    expect(stale(msg([ev("DELIVERED", "2026-08-28T10:00:04Z")], "2026-08-28"), TODAY)).toBe(false);
    expect(stale(msg([ev("BOUNCED", "2026-08-28T10:00:09Z")], "2026-08-28"), TODAY)).toBe(false);
  });
});

describe("deliveryRate", () => {
  it("is null when nothing has been decided", () => {
    expect(deliveryRate([])).toBeNull();
    expect(deliveryRate([msg([]), msg([ev("SENT", "2026-08-28T10:00:00Z")])])).toBeNull();
  });

  it("counts delivered over decided", () => {
    const rate = deliveryRate([
      msg([ev("DELIVERED", "2026-08-28T10:00:04Z")]),
      msg([ev("DELIVERED", "2026-08-28T10:00:05Z")]),
      msg([ev("DELIVERED", "2026-08-28T10:00:06Z")]),
      msg([ev("BOUNCED", "2026-08-28T10:00:09Z")]),
    ]);
    expect(rate).toBe(75);
  });

  // A provider outage leaves many messages unconfirmed. If those counted
  // against the rate, the number would collapse for a reason that has
  // nothing to do with deliverability.
  it("ignores unconfirmed messages rather than counting them as failures", () => {
    const rate = deliveryRate([
      msg([ev("DELIVERED", "2026-08-28T10:00:04Z")]),
      msg([]),
      msg([]),
      msg([]),
    ]);
    expect(rate).toBe(100);
  });

  it("counts complaints and failures against the rate", () => {
    expect(
      deliveryRate([
        msg([ev("DELIVERED", "2026-08-28T10:00:04Z")]),
        msg([ev("COMPLAINED", "2026-08-29T08:00:00Z")]),
      ]),
    ).toBe(50);
    expect(
      deliveryRate([
        msg([ev("DELIVERED", "2026-08-28T10:00:04Z")]),
        msg([ev("FAILED", "2026-08-28T10:00:00Z")]),
      ]),
    ).toBe(50);
  });
});

describe("presentation helpers", () => {
  it("names the channel in plain language", () => {
    expect(channelLabel("EMAIL")).toBe("Email");
    expect(channelLabel("SMS")).toBe("Text");
  });

  it("writes the recipient as a person would", () => {
    const withName = { ...msg([]), toName: "Dana Reyes", toAddress: "dana@gc.example" };
    expect(recipient(withName)).toBe("Dana Reyes <dana@gc.example>");
    expect(recipient(msg([]))).toBe("super@gc.example");
  });
});
