import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE WEBHOOK STILL ANSWERS 200 WHEN THE REPLY AGENT FALLS OVER. Smartlead
 * retries anything that is not a 200, and a retry of a reply already
 * committed is a duplicate — so the agent runs after the commit and its
 * failure is a log line, never the response.
 */

const tx = {
  outboundEvent: { create: vi.fn(async () => ({ id: "evt-1" })) },
  salesLead: { update: vi.fn(async () => ({})) },
  salesActivity: { create: vi.fn(async () => ({})) },
};
const prisma = {
  company: { findFirst: vi.fn(async () => ({ id: "co-1" })) },
  salesLead: { findFirst: vi.fn(async () => ({ id: "lead-1", doNotContact: false })) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  outboundEvent: {
    findUnique: vi.fn(async () => ({
      id: "evt-1",
      companyId: "co-1",
      email: "mike@sub.com",
      payload: { reply_body: "yeah send me what you need" },
      occurredAt: null,
      createdAt: new Date("2026-10-15T00:00:00Z"),
      lead: { id: "lead-1", contactName: "Mike Diaz", email: "mike@sub.com", doNotContact: false },
    })),
  },
  outboundReply: { create: vi.fn() },
};

vi.mock("@prova/db", () => ({ prisma, Prisma: {} }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: vi.fn(async () => ({ ok: true, model: "m", settings: {} })) }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));
vi.mock("@/lib/smartlead/block", () => ({ blockInSmartlead: vi.fn() }));
const classify = vi.fn();
vi.mock("@prova/integrations", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  classifyOutboundReply: (...args: unknown[]) => classify(...args),
}));

const SECRET = "s3cret";
function signed(body: Record<string, unknown>): Request {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/api/webhooks/outbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-smartlead-signature": createHmac("sha256", SECRET).update(raw).digest("hex"),
      "x-request-id": "req-1",
    },
    body: raw,
  });
}

describe("POST /api/webhooks/outbound with the reply agent behind it", () => {
  beforeEach(() => {
    vi.stubEnv("SMARTLEAD_WEBHOOK_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 200 and keeps the committed reply when the classifier throws", async () => {
    classify.mockRejectedValueOnce(new Error("model down"));
    const { POST } = await import("@/app/api/webhooks/outbound/route");
    const response = await POST(signed({ event_type: "EMAIL_REPLY", to_email: "mike@sub.com", reply_body: "yeah send me what you need" }));
    expect(response.status).toBe(200);
    expect(tx.outboundEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.salesActivity.create).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(prisma.outboundReply.create).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[outbound] reply agent failed", { eventId: "evt-1", error: "Error" });
  });

  it("does not run the agent for an event that is not a reply", async () => {
    classify.mockClear();
    const { POST } = await import("@/app/api/webhooks/outbound/route");
    const response = await POST(signed({ event_type: "EMAIL_SENT", to_email: "mike@sub.com" }));
    expect(response.status).toBe(200);
    expect(classify).not.toHaveBeenCalled();
  });
});
