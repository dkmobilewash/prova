import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The allowance THROUGH `streamAnswer` — the half a unit test of the ledger
 * cannot reach.
 *
 * What is actually at stake here is ORDER. The old bound was recorded after
 * the model had answered, and every bug in this area is the same shape: the
 * money is spent and then the accounting is attempted. So the assertion
 * that matters most in this file is not "the cap refused" — it is that the
 * claim was made BEFORE `streamToolConversation` was called, and that a
 * refused claim means the loop never ran at all.
 *
 * Everything is recorded into one ordered list rather than asserted per
 * mock, because "both happened" is exactly the weaker claim that would have
 * passed against the old code.
 */

type Captured = { attachment?: unknown; question: string };
let captured: Captured | null = null;
/** Every interesting thing that happened, in the order it happened. */
let order: string[] = [];

/** The two results a claim can have. Written out rather than inferred from
 * the happy path, so a test can stub the refusal without fighting the type. */
type Claimed =
  | {
      ok: true;
      claim: { companyId: string; periodStart: Date; questions: number; pages: number };
      left: { questions: number; pages: number };
    }
  | { ok: false; error: string };

const claimAskAllowance = vi.fn(async (): Promise<Claimed> => {
  order.push("claim");
  return {
    ok: true,
    claim: { companyId: "co1", periodStart: new Date("2026-09-01T00:00:00.000Z"), questions: 1, pages: 0 },
    left: { questions: 299, pages: 300 },
  };
});
const markAskAllowanceFailure = vi.fn(async () => {
  order.push("mark");
});
const askAllowance = vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
  order.push("courtesy");
  return { ok: true };
});

/** What the fake model loop yields. Swapped per test. */
let loopEvents: () => AsyncGenerator<Record<string, unknown>> = async function* () {
  yield { type: "text", delta: "Yes." };
  yield { type: "usage", usage: { passes: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  yield { type: "done", toolsCalled: [] };
};

vi.mock("@prova/integrations", () => ({
  anthropicIsConfigured: () => true,
  ASK_DEFAULT_MODEL: "test-model",
  RESEARCH_MAX_SEARCHES: 3,
  RESEARCH_FIELD_LABELS: {},
  researchProject: vi.fn(),
  streamToolConversation: (options: Captured) => {
    captured = options;
    order.push("model");
    return loopEvents();
  },
}));

vi.mock("./usage", () => ({
  askAllowance: (...args: unknown[]) => askAllowance(...(args as [])),
  recordAskUsage: vi.fn(async () => {}),
  MIGRATE_COMMAND: "pnpm --filter @prova/db run migrate:deploy",
}));

vi.mock("./allowance", () => ({
  claimAskAllowance: (...args: unknown[]) => claimAskAllowance(...(args as [])),
  markAskAllowanceFailure: (...args: unknown[]) => markAskAllowanceFailure(...(args as [])),
}));

const ENV_TOKEN = "vercel_blob_rw_abc123_secret";
const OURS = "https://abc123.public.blob.vercel-storage.com";

import type { CommandContext } from "./commands";

const owner: CommandContext = {
  companyId: "co1",
  userId: "u1",
  principal: { role: "OWNER", jobFunction: null },
  today: "2026-09-22",
};

async function run(request: Parameters<typeof import("./answer").streamAnswer>[1]) {
  const { streamAnswer } = await import("./answer");
  const events: { type: string; error?: string }[] = [];
  for await (const event of streamAnswer(owner, request)) events.push(event as { type: string });
  return events;
}

/** A real PDF with a countable page tree, served from "our" store. */
function pdfOf(pages: number): Buffer {
  return Buffer.from(
    ["%PDF-1.4", `2 0 obj << /Type /Pages /Count ${pages} >> endobj`]
      .concat(Array.from({ length: pages }, () => "<< /Type /Page /MediaBox [0 0 612 792] >>"))
      .join("\n"),
    "latin1",
  );
}

beforeEach(() => {
  captured = null;
  order = [];
  claimAskAllowance.mockClear();
  markAskAllowanceFailure.mockClear();
  askAllowance.mockClear();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", ENV_TOKEN);
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  loopEvents = async function* () {
    yield { type: "text", delta: "Yes." };
    yield {
      type: "usage",
      usage: { passes: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
    yield { type: "done", toolsCalled: [] };
  };
});

describe("the unit is claimed before the money is spent", () => {
  it("claims, and only then calls the model", async () => {
    await run({ question: "How much retainage is held?" });
    // The whole change, in one assertion. `["model", "claim"]` is what the
    // old code did and is the defect; anything that records usage after the
    // answer streams cannot bound a paid cap.
    expect(order).toEqual(["courtesy", "claim", "model"]);
    expect(claimAskAllowance).toHaveBeenCalledWith("co1", { questions: 1, pages: 0 });
  });

  it("never calls the model at all when the claim is refused", async () => {
    claimAskAllowance.mockImplementationOnce(async () => {
      order.push("claim");
      return {
        ok: false,
        error: "That wasn't sent — your company has used 300 of its 300 assistant questions for this month.",
      };
    });
    const events = await run({ question: "anything" });
    expect(order).toEqual(["courtesy", "claim"]);
    expect(events).toEqual([
      {
        type: "error",
        error: "That wasn't sent — your company has used 300 of its 300 assistant questions for this month.",
      },
    ]);
    // The stop is a RETURNED stream event, never a throw. Production
    // redacts a thrown Server Action message to a digest, and a paying
    // customer hitting the cap would get a dead button instead of the
    // sentence that tells them what to do.
    expect(captured).toBeNull();
  });

  it("still lets the rolling courtesy limit refuse first, unchanged", async () => {
    askAllowance.mockImplementationOnce(async () => {
      order.push("courtesy");
      return { ok: false, error: "Give it a few minutes." };
    });
    const events = await run({ question: "anything" });
    // Nothing claimed: a question the courtesy bound turned away never
    // touched the paid allowance, which is the right way round.
    expect(order).toEqual(["courtesy"]);
    expect(claimAskAllowance).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "error", error: "Give it a few minutes." }]);
  });
});

describe("a document charges its real page count", () => {
  it("claims one question plus the PDF's own pages", async () => {
    const pdf = pdfOf(23);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pdf as unknown as BodyInit, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    await run({
      question: "What's in this?",
      attachment: {
        url: `${OURS}/document-intake/co1/ask-bid.pdf`,
        name: "bid.pdf",
        contentType: "application/pdf",
        size: pdf.length,
      },
    });
    // 23, not 1. A flat one-per-document is the defect this whole page
    // unit exists for: a 23-page bid package is tens of times the cost of
    // a question and would have been charged the same as "what time is it".
    expect(claimAskAllowance).toHaveBeenCalledWith("co1", { questions: 1, pages: 23 });
    // And the file still reached the model — the charge is not instead of
    // the answer.
    expect(captured?.attachment).toBeTruthy();
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it("claims nothing extra for a question with no file", async () => {
    await run({ question: "plain question" });
    expect(claimAskAllowance).toHaveBeenCalledWith("co1", { questions: 1, pages: 0 });
  });

  it("claims nothing at all when the file is refused", async () => {
    // Another company's folder. Refused before a byte is fetched, and it
    // must not cost the person a question either.
    const events = await run({
      question: "What's in this?",
      attachment: {
        url: `${OURS}/document-intake/other-co/ask-bid.pdf`,
        name: "bid.pdf",
        contentType: "application/pdf",
        size: 100,
      },
    });
    expect(claimAskAllowance).not.toHaveBeenCalled();
    expect(events[0].type).toBe("error");
  });
});

describe("a call that fails after its unit was claimed", () => {
  it("MARKS the claim — it is not handed back", async () => {
    loopEvents = async function* () {
      yield {
        type: "usage",
        usage: { passes: 1, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
      yield { type: "error", reason: "api" };
    };
    const events = await run({ question: "anything" });
    expect(order).toEqual(["courtesy", "claim", "model", "mark"]);
    expect(markAskAllowanceFailure).toHaveBeenCalledWith({
      companyId: "co1",
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      questions: 1,
      pages: 0,
    });
    expect(events.at(-1)?.type).toBe("error");
  });

  it("marks a claim whose loop THREW rather than reporting an error event", async () => {
    loopEvents = async function* () {
      yield { type: "text", delta: "part of an answer" };
      throw new Error("the database went away mid-question");
    };
    await expect(run({ question: "anything" })).rejects.toThrow("went away");
    expect(markAskAllowanceFailure).toHaveBeenCalledTimes(1);
  });

  it("does NOT mark a question that answered", async () => {
    await run({ question: "anything" });
    expect(markAskAllowanceFailure).not.toHaveBeenCalled();
    expect(order).toEqual(["courtesy", "claim", "model"]);
  });
});
