import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * COMPOSITION THROUGH `streamAnswer`: four tools in one pass, one answer.
 *
 * The unit tests and the corpus next door prove the guard is not the thing
 * standing in composition's way. They cannot prove any of what would
 * actually break this in production, all of which is wiring and all of
 * which only shows up once MORE THAN ONE tool has run in a turn:
 *
 *   - that all four tools' results reach the model, and the guard checks the
 *     answer against ALL of them rather than against whichever ran last;
 *   - that `toolsUsed` carries every tool, since that is what the panel
 *     reads to decide whether the answer was sourced at all;
 *   - that `citations` and `links` LINE UP with `toolsUsed` when several
 *     ran — one citation per distinct destination, deduped, first label
 *     winning, and never a citation for a tool that did not run;
 *   - that `links` is still capped, because four tools return four times as
 *     many rows to make buttons out of and the cap is what keeps an answer
 *     from becoming the alert page again;
 *   - that a composed answer stating an invented TOTAL is still retracted.
 *     This is the one that matters: composing puts two figures in front of
 *     the model at once, which is precisely the temptation the guard exists
 *     for, and a guard that only ever met single-tool answers had never been
 *     asked this question.
 *
 * Same arrangement as `provenanceStream.test.ts`: the provider loop is a
 * script, so what is asserted is exactly what `streamAnswer` yields.
 */

type Script = {
  /** Tool calls the fake model makes in ONE round, as a real composing turn
   * does — the loop runs a pass's calls under one `Promise.all`. */
  calls?: { name: string; input?: unknown }[];
  answer: string;
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
      if (script.calls?.length) {
        yield { type: "reset" };
        yield { type: "tools", names: script.calls.map((c) => c.name) };
        // Together, under one Promise.all, which is how the real loop runs a
        // pass. Running them in sequence here would hide an executor that is
        // not safe to call concurrently — and concurrency is the whole
        // reason composing is not four times slower.
        await Promise.all(
          script.calls.map((call, index) =>
            options.execute(call.name, call.input ?? {}, {
              toolUseId: `t${index}`,
              toolUseIdsInContext: [],
            }),
          ),
        );
        yield { type: "answering" };
      }
      yield { type: "text", delta: script.answer };
      yield {
        type: "usage",
        usage: { passes: 2, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 },
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

/**
 * Four areas of one job, each from its own tool, exactly as the composed
 * corpus entry `compose-job-rundown` shapes them.
 *
 * TWO TOOLS DELIBERATELY SHARE A CITATION DESTINATION (`open_rfis` and
 * `open_punch_list` both cite the job page), because that is the case the
 * dedupe exists for and a fixture with four distinct hrefs would pass
 * whether or not dedupe worked. Three of them return item links, and
 * between them MORE than the cap, so the cap is exercised rather than
 * assumed.
 */
const RESULTS: Record<string, { data: unknown; summary?: Record<string, number>; citations: { label: string; href: string }[]; links?: { label: string; href: string }[] }> = {
  job_overview: {
    data: { job: "Maple Street", gc: "Turner", contractValue: 412000, billedToDate: 268400, percentComplete: "61.2%" },
    citations: [{ label: "Maple Street", href: "/jobs/maple" }],
    links: [{ label: "Maple Street", href: "/jobs/maple" }],
  },
  receivables: {
    data: [{ invoice: 8, job: "Maple Street", gc: "Turner", outstanding: 86500, daysOverdue: 42 }],
    summary: { outstandingInvoiceCount: 1, overdueInvoiceCount: 1 },
    citations: [{ label: "Cash flow", href: "/cash-flow" }],
    links: [
      { label: "Invoice 8", href: "/jobs/maple/billing/8" },
      { label: "Invoice 8 again", href: "/jobs/maple/billing/8" },
      { label: "AR aging", href: "/cash-flow/aging" },
    ],
  },
  open_rfis: {
    data: [{ rfi: 14, job: "Maple Street", daysPastResponseDate: 6 }],
    summary: { open: 3, pastResponseDate: 1 },
    citations: [{ label: "Maple Street", href: "/jobs/maple" }],
    links: [
      { label: "RFI 14", href: "/jobs/maple/rfis/14" },
      { label: "RFI 15", href: "/jobs/maple/rfis/15" },
      { label: "RFI 16", href: "/jobs/maple/rfis/16" },
      { label: "RFI 17", href: "/jobs/maple/rfis/17" },
    ],
  },
  open_punch_list: {
    data: [{ item: "Patch soffit", job: "Maple Street", overdue: false }],
    summary: { open: 14, overdue: 0 },
    citations: [{ label: "Maple Street", href: "/jobs/maple" }],
  },
};

vi.mock("./handlers", () => ({
  runTool: async (_ctx: unknown, name: string) => RESULTS[name] ?? { data: [], citations: [] },
}));

vi.mock("./attachment", () => ({ attachmentRefOf: () => undefined }));
vi.mock("./attachmentLoad", () => ({
  loadAskAttachment: async () => ({ ok: true, charge: { pages: 0, basis: "pdf" }, block: { kind: "pdf", fileName: "x.pdf", base64: "" } }),
}));

vi.mock("./allowance", () => ({
  claimAskAllowance: async () => ({
    ok: true as const,
    claim: { companyId: "co1", periodStart: new Date("2026-09-01T00:00:00.000Z"), questions: 1, pages: 0 },
    left: { questions: 299, pages: 300 },
  }),
  markAskAllowanceFailure: async () => {},
}));

vi.mock("@prova/db", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  prisma: new Proxy({}, { get() { throw new Error("this test must not touch the database"); } }),
}));

import type { CommandContext } from "./commands";
import type { AskRequest, AskStreamEvent } from "./answer";

const { streamAnswer, PROVENANCE_REFUSAL } = await import("./answer");

const ctx: CommandContext = {
  companyId: "co1",
  userId: "u1",
  principal: { role: "OWNER", jobFunction: null },
  today: "2026-09-22",
};

/** The four areas of Cyrus's question, called in one round. */
const FOUR = [{ name: "job_overview" }, { name: "receivables" }, { name: "open_rfis" }, { name: "open_punch_list" }];

async function ask(next: Script, request: AskRequest = { question: "how's Maple Street doing?" }) {
  script = next;
  usageRows.length = 0;
  const events: AskStreamEvent[] = [];
  for await (const event of streamAnswer(ctx, request)) events.push(event);
  return events;
}

const types = (events: AskStreamEvent[]) => events.map((event) => event.type);
const doneOf = (events: AskStreamEvent[]) => events.find((event) => event.type === "done");

/** The answer the corpus entry `compose-job-rundown` carries, with every
 * figure from a different one of the four results. */
const COMPOSED_ANSWER = [
  "Turner is 42 days late on the one invoice out.",
  "",
  "• Owed — $86,500.00, 42 days over",
  "• Billed — $268,400.00 of $412,000.00, 61.2% complete",
  "• RFIs — 3 open, 1 past its answer date",
  "• Punch — 14 open",
].join("\n");

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("an answer composed from four tools", () => {
  it("reaches the person, with every figure traced to a different tool", async () => {
    // The point of the fixture: $86,500.00 is only in receivables,
    // $412,000.00 only in job_overview, 3 only in open_rfis' summary, 14
    // only in open_punch_list's. An executor that recorded one tool's text
    // and dropped the rest retracts this answer.
    const events = await ask({ calls: FOUR, answer: COMPOSED_ANSWER });
    expect(types(events)).toContain("done");
    expect(usageRows).toEqual([expect.objectContaining({ outcome: "answered" })]);
  });

  it("names all four in toolsUsed", async () => {
    const events = await ask({ calls: FOUR, answer: COMPOSED_ANSWER });
    expect(doneOf(events)).toMatchObject({
      toolsUsed: ["job_overview", "receivables", "open_rfis", "open_punch_list"],
    });
  });

  it("cites every destination the four tools named, once each", async () => {
    // Three of the four cite the job page. A citation per TOOL would render
    // "Maple Street" three times under one answer; a citation per
    // DESTINATION is what the person can act on.
    const done = doneOf(await ask({ calls: FOUR, answer: COMPOSED_ANSWER }));
    expect(done).toMatchObject({
      citations: [
        { label: "Maple Street", href: "/jobs/maple" },
        { label: "Cash flow", href: "/cash-flow" },
      ],
    });
  });

  it("caps the buttons, because four tools return four times the rows", async () => {
    // Eight links come back across the four tools, one of them a duplicate
    // href. Deduped to seven, capped to six — and the cap runs AFTER the
    // dedupe, so the six are six real destinations rather than five and a
    // repeat.
    const done = doneOf(await ask({ calls: FOUR, answer: COMPOSED_ANSWER })) as { links: { href: string }[] };
    expect(done.links).toHaveLength(6);
    expect(new Set(done.links.map((link) => link.href)).size).toBe(6);
  });

  it("carries no citations at all when no tool ran", async () => {
    // The inverse, and the reason the condition is on `toolsUsed.length`
    // rather than on the citations array: a refusal composed from nothing
    // must not arrive with buttons implying it was sourced.
    const done = doneOf(await ask({ calls: [], answer: "There are no purchase orders here. I can record a material order against a job." }));
    expect(done).toMatchObject({ citations: [], links: [], toolsUsed: [] });
  });
});

describe("a composed answer that totals two tools itself", () => {
  it("is still retracted, with four results open", async () => {
    // $98,900.00 is 86,500 + 12,400 — a sum of two figures the model was
    // handed, which is the arithmetic the prompt forbids and the calculator
    // exists to do instead. Composition puts both numbers on the table at
    // once, so this is the temptation the guard was built for and the case
    // it had never been measured on.
    const events = await ask({
      calls: FOUR,
      answer: "Turner owes $98,900.00 across the two invoices.",
    });
    expect(types(events)).toEqual(expect.arrayContaining(["reset", "error"]));
    expect(types(events)).not.toContain("done");
    const error = events.find((event) => event.type === "error");
    expect(error).toMatchObject({ error: PROVENANCE_REFUSAL });
    // And the figure is not restated in the refusal — the whole point of
    // holding it back.
    expect(JSON.stringify(error)).not.toContain("98,900");
  });
});
