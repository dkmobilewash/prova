import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The attachment and the research, through `streamAnswer` — the one place
 * the pieces meet. The provider loop is replaced by a capture, so what is
 * asserted is what `streamAnswer` would hand the model, and what it refuses
 * to hand it.
 */

type Captured = { attachment?: unknown; context?: string; question: string; webSearch?: boolean };
let captured: Captured | null = null;
const research = vi.fn();
const recordAskUsage = vi.fn(async () => {});

vi.mock("@prova/integrations", () => ({
  anthropicIsConfigured: () => true,
  ASK_DEFAULT_MODEL: "test-model",
  RESEARCH_MAX_SEARCHES: 3,
  RESEARCH_FIELD_LABELS: { owner: "Owner" },
  researchProject: (...args: unknown[]) => research(...args),
  streamToolConversation: (options: Captured) => {
    captured = options;
    return (async function* () {
      yield { type: "text", delta: "Oct 10." };
      yield { type: "usage", usage: { passes: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      yield { type: "done", toolsCalled: [] };
    })();
  },
}));

vi.mock("./usage", () => ({
  askAllowance: async () => ({ ok: true }),
  recordAskUsage: (...args: unknown[]) => recordAskUsage(...(args as [])),
}));

const ENV_TOKEN = "vercel_blob_rw_abc123_secret";
const OURS = "https://abc123.public.blob.vercel-storage.com";

import type { CommandContext } from "./commands";

const owner: CommandContext = { companyId: "co1", userId: "u1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-18" };

async function run(request: Parameters<typeof import("./answer").streamAnswer>[1], ctx = owner) {
  const { streamAnswer } = await import("./answer");
  const events: { type: string; error?: string }[] = [];
  for await (const event of streamAnswer(ctx, request)) events.push(event as { type: string });
  return events;
}

beforeEach(() => {
  captured = null;
  research.mockReset();
  recordAskUsage.mockClear();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", ENV_TOKEN);
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
});

describe("an attached file", () => {
  it("from another company is refused before the model runs, and is never fetched", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const events = await run({
      question: "what's the bid date on this?",
      attachment: { url: `${OURS}/document-intake/co2/ask-bid.pdf`, name: "bid.pdf", contentType: "application/pdf", size: 100 },
    });
    expect(events).toEqual([{ type: "error", error: "That file isn't one of your company's. Attach it again." }]);
    expect(captured).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("is refused for someone whose job function has no document intake", async () => {
    const events = await run(
      {
        question: "what's in this?",
        attachment: { url: `${OURS}/document-intake/co1/ask-bid.pdf`, name: "bid.pdf", contentType: "application/pdf", size: 100 },
      },
      { ...owner, principal: { role: "MEMBER", jobFunction: "ACCOUNTING" } },
    );
    expect(events).toEqual([
      { type: "error", error: "Attaching files uses document intake, which isn't part of your job function." },
    ]);
    expect(captured).toBeNull();
  });

  it("from this company reaches the model, with the rule about files", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } }));
    const events = await run({
      question: "what's the bid date on this?",
      attachment: { url: `${OURS}/document-intake/co1/ask-bid.pdf`, name: "bid.pdf", contentType: "application/pdf", size: 8 },
    });
    expect(events.map((event) => event.type)).toContain("done");
    expect(captured?.attachment).toEqual({ kind: "pdf", fileName: "bid.pdf", base64: Buffer.from("%PDF-1.4").toString("base64") });
    expect(captured?.context).toContain("THE ATTACHED FILE");
    fetchSpy.mockRestore();
  });

  it("is absent from the request, and so is the rule, when nothing is attached", async () => {
    await run({ question: "what's overdue?" });
    expect(captured?.attachment).toBeUndefined();
    expect(captured?.context ?? "").not.toContain("THE ATTACHED FILE");
  });
});

describe("web search", () => {
  it("is offered on every question — the flag streamAnswer hands the provider loop", async () => {
    // askWebSearchTool's own max_uses clamp is packages/integrations'
    // (webSearch.test.ts, imported directly since this file mocks the
    // whole package); what belongs to answer.ts is that it turns the
    // option ON at all, which is what this pins.
    await run({ question: "what OSHA form do we file for a recordable injury?" });
    expect(captured?.webSearch).toBe(true);
  });
});
