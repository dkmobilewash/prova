import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guard through `streamAnswer` — the only place it meets a real answer.
 *
 * The unit tests next door prove the rule. They cannot prove any of the
 * things that would actually break this feature in production, all of which
 * live in the wiring: that the tool results the guard is handed are the ones
 * the model was handed, that the text it checks is the assembled answer
 * rather than a stray delta, that a refused answer reaches the browser as a
 * cleared screen and not as a figure with a warning under it, that the
 * refusal is COUNTED so the firing rate can be read, and that the two
 * answer kinds with an invisible source are skipped rather than refused.
 *
 * Same arrangement as `business-scope-stream.test.ts`: the provider loop is
 * replaced by a script, so what is asserted is exactly what `streamAnswer`
 * yields.
 */

type Script = {
  /** Tool calls the fake model makes before answering. */
  calls?: { name: string; input?: unknown }[];
  /** The answer text, streamed as one delta after `answering`. */
  answer: string;
  /** Text streamed BEFORE the first tool round, which goes to the progress
   * slot and is cleared by `answering`. */
  preamble?: string;
  /** Text streamed AFTER the first `answering` and before a SECOND tool
   * round. This is the only text `reset` itself has to clear — the panel
   * has already promoted it out of the progress slot — so it is what makes
   * the reset rule testable rather than incidentally covered. */
  secondThoughts?: string;
  webSearches?: number;
};

let script: Script = { answer: "" };
const usageRows: { outcome: string }[] = [];

vi.mock("@prova/integrations", () => ({
  anthropicIsConfigured: () => true,
  ASK_DEFAULT_MODEL: "test-model",
  RESEARCH_MAX_SEARCHES: 3,
  RESEARCH_FIELD_LABELS: { owner: "Owner" },
  researchProject: vi.fn(),
  streamToolConversation: (options: {
    execute: (name: string, input: unknown, meta: unknown) => Promise<{ content: string }>;
  }) =>
    (async function* () {
      if (script.preamble) yield { type: "text", delta: script.preamble };
      if (script.calls?.length) {
        yield { type: "reset" };
        yield { type: "tools", names: script.calls.map((c) => c.name) };
        for (const call of script.calls) {
          await options.execute(call.name, call.input ?? {}, { toolUseId: "t1", toolUseIdsInContext: [] });
        }
        yield { type: "answering" };
      }
      if (script.secondThoughts) {
        yield { type: "text", delta: script.secondThoughts };
        yield { type: "reset" };
        yield { type: "tools", names: ["receivables"] };
        await options.execute("receivables", {}, { toolUseId: "t2", toolUseIdsInContext: [] });
        yield { type: "answering" };
      }
      yield { type: "text", delta: script.answer };
      yield {
        type: "usage",
        usage: {
          passes: 2,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          webSearches: script.webSearches ?? 0,
        },
      };
      yield { type: "done", toolsCalled: script.calls?.map((c) => c.name) ?? [] };
    })(),
}));

vi.mock("./usage", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  askAllowance: async () => ({ ok: true }),
  recordAskUsage: async (row: { outcome: string }) => {
    usageRows.push(row);
  },
}));

/** The tool result every question in this file reads. Two invoices, one
 * total nowhere in the payload — so an answer that states a sum has done
 * arithmetic, which is the thing being caught. */
vi.mock("./handlers", () => ({
  runTool: async () => ({
    data: [
      { invoice: 5, gc: "Turner", outstanding: 30000, dueOn: "2026-07-31", daysOverdue: 42 },
      { invoice: 7, gc: "Halvorsen", outstanding: 18400, dueOn: "2026-09-08", daysOverdue: 6 },
    ],
    summary: { outstandingInvoiceCount: 2, overdueInvoiceCount: 2 },
    citations: [{ label: "Cash flow", href: "/cash-flow" }],
  }),
}));

/** The person's own document, already verified as theirs. Nothing here
 * fetches a blob; what matters is only that `streamAnswer` saw one. */
vi.mock("./attachment", () => ({
  attachmentRefOf: () => undefined,
  loadAskAttachment: async () => ({
    ok: true,
    block: { kind: "pdf", fileName: "turner-invoice.pdf", base64: "" },
  }),
}));

vi.mock("@prova/db", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  prisma: new Proxy(
    {},
    {
      get() {
        throw new Error("this test must not touch the database");
      },
    },
  ),
}));

import type { CommandContext } from "./commands";
import type { AskRequest, AskStreamEvent } from "./answer";

const { streamAnswer, PROVENANCE_REFUSAL } = await import("./answer");
const { PROVENANCE_OUTCOME } = await import("./usage");

const ctx: CommandContext = {
  companyId: "co1",
  userId: "u1",
  principal: { role: "OWNER", jobFunction: null },
  today: "2026-09-22",
};

async function ask(next: Script, request: AskRequest = { question: "who owes us money right now?" }) {
  script = next;
  usageRows.length = 0;
  const events: AskStreamEvent[] = [];
  for await (const event of streamAnswer(ctx, request)) events.push(event);
  return events;
}

const types = (events: AskStreamEvent[]) => events.map((event) => event.type);

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("an answer whose figures are all in the rows", () => {
  it("reaches the person, with its citations", async () => {
    const events = await ask({
      calls: [{ name: "receivables" }],
      answer: "2 invoices are past due — $30,000.00 from Turner, 42 days, and $18,400.00 from Halvorsen.",
    });
    expect(types(events)).toContain("done");
    const done = events.find((event) => event.type === "done");
    expect(done).toMatchObject({ citations: [{ label: "Cash flow", href: "/cash-flow" }] });
    expect(usageRows).toEqual([expect.objectContaining({ outcome: "answered" })]);
  });

  it("is judged on the assembled answer, not on the preamble answering threw away", async () => {
    // The preamble carries a figure that is in NO tool result. If the guard
    // were checking every delta rather than what the panel shows, this
    // answer would be refused for a sentence nobody ever reads.
    const events = await ask({
      preamble: "Let me pull the $99,999.00 question up…",
      calls: [{ name: "receivables" }],
      answer: "$30,000.00 from Turner.",
    });
    expect(types(events)).toContain("done");
  });

  it("is judged on the assembled answer, not on a half-written one RESET threw away", async () => {
    // The harder half, and the one the case above cannot reach. Text after
    // the first `answering` is no longer provisional — the panel has it in
    // the answer slot — so `reset` is the only thing that clears it. Stop
    // honouring reset and the $99,999.00 here becomes part of the answer
    // the guard reads, and this goes red.
    const events = await ask({
      calls: [{ name: "receivables" }],
      secondThoughts: "Actually, $99,999.00 — let me check the other side.",
      answer: "$30,000.00 from Turner.",
    });
    expect(types(events)).toContain("done");
  });
});

describe("an answer with a figure no tool returned", () => {
  it("is retracted: the screen is cleared and the figure is not restated", async () => {
    // $48,400 is 30,000 + 18,400. Neither the rows nor the summary carry
    // it, so the model added up — the arithmetic the prompt forbids.
    const events = await ask({
      calls: [{ name: "receivables" }],
      answer: "Turner and Halvorsen owe $48,400.00 between them.",
    });

    // `reset` then `error`, and no `done`. AskPanel clears the answer on
    // either, so nothing of the figure survives on screen.
    expect(types(events).slice(-2)).toEqual(["reset", "error"]);
    expect(types(events)).not.toContain("done");
    const error = events.at(-1);
    expect(error).toEqual({ type: "error", error: PROVENANCE_REFUSAL });
    // The refusal must not repeat what it is refusing to show.
    expect(PROVENANCE_REFUSAL).not.toContain("48,400");
  });

  it("is counted, so the firing rate can be read off the settings page", async () => {
    await ask({ calls: [{ name: "receivables" }], answer: "They owe $48,400.00." });
    expect(usageRows).toEqual([expect.objectContaining({ outcome: PROVENANCE_OUTCOME })]);
  });

  it("logs the question and the figure, and never the answer", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await ask({ calls: [{ name: "receivables" }], answer: "They owe $48,400.00 in total." });
    const [message, detail] = logged.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(message).toContain("held back");
    expect(detail.question).toBe("who owes us money right now?");
    expect(String(detail.unaccounted)).toContain("48,400.00");
    expect(detail.companyId).toBe("co1");
    expect(JSON.stringify(detail)).not.toContain("in total");
  });

  it("catches it on an answer that called no tool at all", async () => {
    const events = await ask({ answer: "You're owed $12,400.00." });
    expect(types(events).slice(-2)).toEqual(["reset", "error"]);
  });
});

describe("the two answer kinds whose source this process cannot see", () => {
  it("does not check an answer that used web search", async () => {
    // A server-side search runs inside the model's own response and never
    // reaches `execute`, so its figures are in no tool text. Guarding these
    // would refuse every legitimate public-fact answer — a code section
    // number, a form number, a fee.
    const events = await ask({
      answer: "IBC 2021 section 721 puts that assembly at 2 hours — found on the web, check before you rely on it.",
      webSearches: 1,
    });
    expect(types(events)).toContain("done");
  });

  it("does not check an answer about a file the person attached", async () => {
    // The figures are in their own PDF, which this code cannot read as
    // text. Refusing these would break the one feature whose whole job is
    // to answer from a document.
    const events = await ask(
      { answer: "The invoice totals $63,911.40, due 2026-10-15." },
      {
        question: "what's the total on this?",
        attachment: { url: "https://x.blob.vercel-storage.com/a.pdf", name: "turner-invoice.pdf", contentType: "application/pdf", size: 1024 },
      },
    );
    expect(types(events)).toContain("done");
  });

  it("checks the same answer when nothing was attached", async () => {
    // The control for the attachment case, for the same reason as below.
    const events = await ask({ answer: "The invoice totals $63,911.40, due 2026-10-15." });
    expect(types(events)).not.toContain("done");
  });

  it("checks the same answer when no search was spent", async () => {
    // The control. Without it the case above proves only that the guard is
    // off, not that the web-search condition is what turns it off.
    const events = await ask({
      answer: "IBC 2021 section 721 puts that assembly at 2 hours — found on the web, check before you rely on it.",
      webSearches: 0,
    });
    expect(types(events)).not.toContain("done");
  });
});
