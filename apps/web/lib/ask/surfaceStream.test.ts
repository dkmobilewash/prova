import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Bid surface through `streamAnswer` — where the narrowing has to hold
 * against a model that does not do as it was told.
 *
 * `surface.test.ts` proves the OFFERED list is narrowed. That is not enough on
 * its own: a model can call a tool name it was never offered (it has read every
 * command's name in other conversations' prompts, and an injected sentence can
 * suggest one), and a chip answer carries a command name back from the
 * browser. Both are executed by name. So this file drives the two execution
 * paths with the forbidden names and requires a refusal — and, as the control,
 * the same calls WITHOUT the surface reaching the command's resolve.
 *
 * The provider loop is a capture (business-scope-stream.test.ts's arrangement)
 * and the capture keeps the `execute` callback, so a tool call can be made by
 * hand exactly as the loop would make it.
 */

type Execute = (name: string, input: unknown, meta: { toolUseId: string; toolUseIdsInContext: string[] }) => Promise<{ content: string }>;
type Captured = { context?: string; tools?: { name: string }[]; execute: Execute };
let captured: Captured | null = null;

vi.mock("@prova/integrations", () => ({
  anthropicIsConfigured: () => true,
  ASK_DEFAULT_MODEL: "test-model",
  RESEARCH_MAX_SEARCHES: 3,
  RESEARCH_FIELD_LABELS: { owner: "Owner" },
  researchProject: vi.fn(),
  streamToolConversation: (options: Captured) => {
    captured = options;
    return (async function* () {
      yield { type: "text", delta: "ok" };
      yield { type: "done", toolsCalled: [] };
    })();
  },
}));

vi.mock("./usage", () => ({ askAllowance: async () => ({ ok: true }), recordAskUsage: async () => {} }));
vi.mock("./allowance", () => ({
  claimAskAllowance: async () => ({
    ok: true,
    claim: { companyId: "co1", periodStart: new Date("2026-10-01T00:00:00.000Z"), questions: 1, pages: 0 },
    left: { questions: 299, pages: 300 },
  }),
  markAskAllowanceFailure: async () => {},
}));
const recordProposal = vi.fn(async () => ({ id: "p1", expiresAt: new Date("2026-10-27T12:00:00.000Z") }));
vi.mock("./proposals", () => ({ recordProposal: (...a: unknown[]) => recordProposal(...(a as [])) }));

const JOB = "cmtx3b4x20007d0pe9ebyh1m4";
const pageJob = vi.fn(async (_companyId: string, path: string | undefined) =>
  path && path.includes(JOB) ? { id: JOB, name: "Riverside Clinic" } : null,
);
vi.mock("./page-context-query", () => ({ resolvePageJob: (c: string, p: string | undefined) => pageJob(c, p) }));

vi.mock("@prova/db", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  prisma: new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "companyAiSettings") return { findUnique: async () => null };
        throw new Error("this test must not touch the database");
      },
    },
  ),
}));

import type { CommandContext } from "./commands";
const { streamAnswer } = await import("./answer");
const { commandNamed } = await import("./commands");

const ctx: CommandContext = {
  companyId: "co1",
  userId: "u1",
  principal: { role: "OWNER", jobFunction: null },
  today: "2026-10-27",
};
const META = { toolUseId: "tu_1", toolUseIdsInContext: [] };

async function ask(request: Parameters<typeof streamAnswer>[1]) {
  captured = null;
  const events: { type: string; error?: string }[] = [];
  for await (const event of streamAnswer(ctx, request)) events.push(event as { type: string; error?: string });
  return { events, handed: captured as Captured | null };
}

// Every command's resolve is replaced by a spy that asks for more — so
// reaching a resolve is observable and no database or proposal row is needed.
const resolves = new Map<string, ReturnType<typeof vi.fn>>();
for (const name of ["draft_invoice", "send_email", "add_catalog_line", "draft_estimate_lines"] as const) {
  const spy = vi.fn(async () => ({ kind: "need" as const, missing: "something" }));
  resolves.set(name, spy);
  (commandNamed(name) as { resolve: unknown }).resolve = spy;
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  for (const spy of resolves.values()) spy.mockClear();
  pageJob.mockClear();
});

describe("the offered list and the context on Bid", () => {
  it("offers only the Bid commands, and tells the model where it is", async () => {
    const { handed } = await ask({ question: "what's the bid so far?", surface: "bid", pagePath: `/bid/estimates/${JOB}` });
    const offered = (handed?.tools ?? []).map((t) => t.name);
    expect(offered).toContain("add_catalog_line");
    expect(offered).toContain("draft_estimate_lines");
    for (const forbidden of ["draft_invoice", "send_email", "raise_rfi", "create_estimate_job", "log_time_entry"]) {
      expect(offered, forbidden).not.toContain(forbidden);
    }
    expect(handed?.context).toContain("C Stream Bid");
    // The page hint resolved the Bid path to this job.
    expect(handed?.context).toContain('"Riverside Clinic"');
  });

  it("the CRM's offer is unchanged — the same question with no surface offers them all", async () => {
    const { handed } = await ask({ question: "what's overdue?" });
    const offered = (handed?.tools ?? []).map((t) => t.name);
    for (const name of ["draft_invoice", "send_email", "raise_rfi", "create_estimate_job", "add_catalog_line"]) {
      expect(offered, name).toContain(name);
    }
    expect(handed?.context ?? "").not.toContain("C Stream Bid");
  });
});

describe("a model that calls a command it was not offered", () => {
  it("is refused on Bid, and the command's resolve never runs", async () => {
    const { handed } = await ask({ question: "bill them", surface: "bid", pagePath: `/bid/estimates/${JOB}` });
    const outcome = await handed!.execute("draft_invoice", { jobName: "Riverside" }, META);
    expect(JSON.parse(outcome.content).unavailable).toMatch(/isn't something I can do from here/);
    expect(resolves.get("draft_invoice")).not.toHaveBeenCalled();
    const handoff = await handed!.execute("send_email", { to: "x" }, META);
    expect(JSON.parse(handoff.content).unavailable).toMatch(/from here/);
    expect(resolves.get("send_email")).not.toHaveBeenCalled();
    expect(recordProposal).not.toHaveBeenCalled();
  });

  it("does not use up the one-command slot, so an allowed command after it still runs", async () => {
    const { handed } = await ask({ question: "bill them and add a line", surface: "bid", pagePath: `/bid/estimates/${JOB}` });
    await handed!.execute("draft_invoice", {}, META);
    await handed!.execute("add_catalog_line", { item: "5/8 Type X", quantity: "200" }, META);
    expect(resolves.get("add_catalog_line")).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: the same call in the CRM reaches the command (the refusal above is the surface, not something else)", async () => {
    const { handed } = await ask({ question: "bill them" });
    await handed!.execute("draft_invoice", { jobName: "Riverside" }, META);
    expect(resolves.get("draft_invoice")).toHaveBeenCalledTimes(1);
  });
});

describe("a chip answer naming a command the surface does not offer", () => {
  const chip = (surface?: "bid") => ({
    question: "bill them",
    surface,
    continuation: { command: "draft_invoice", partialInput: { jobName: "Riverside" }, answers: { jobId: JOB } },
  });

  it("is refused on Bid before any resolve", async () => {
    const { events } = await ask(chip("bid"));
    expect(events).toEqual([{ type: "error", error: expect.stringMatching(/from here/) }]);
    expect(resolves.get("draft_invoice")).not.toHaveBeenCalled();
  });

  it("CONTROL: reaches the resolve without the surface", async () => {
    await ask(chip());
    expect(resolves.get("draft_invoice")).toHaveBeenCalledTimes(1);
  });
});

describe("the job on screen is the default on Bid", () => {
  it("an allowed command with no job named gets the page's job id", async () => {
    const { handed } = await ask({ question: "add 200 sf of type x", surface: "bid", pagePath: `/bid/estimates/${JOB}/estimate` });
    await handed!.execute("add_catalog_line", { item: "5/8 Type X", quantity: "200" }, META);
    const input = resolves.get("add_catalog_line")!.mock.calls[0]![1] as Record<string, string>;
    expect(input).toEqual({ item: "5/8 Type X", quantity: "200", jobId: JOB });
  });

  it("a job the person NAMED still wins — no id is injected", async () => {
    const { handed } = await ask({ question: "add 200 sf to Cedar Park", surface: "bid", pagePath: `/bid/estimates/${JOB}` });
    await handed!.execute("add_catalog_line", { jobName: "Cedar Park", item: "5/8 Type X", quantity: "200" }, META);
    const input = resolves.get("add_catalog_line")!.mock.calls[0]![1] as Record<string, string>;
    expect(input.jobId).toBeUndefined();
    expect(input.jobName).toBe("Cedar Park");
  });

  it("the model cannot supply a jobId itself — the schema drops it, and only the page's survives", async () => {
    const { handed } = await ask({ question: "add", surface: "bid", pagePath: `/bid/estimates/${JOB}` });
    await handed!.execute("add_catalog_line", { jobId: "someone_elses_job_id_xx", item: "x", quantity: "1" }, META);
    const input = resolves.get("add_catalog_line")!.mock.calls[0]![1] as Record<string, string>;
    expect(input.jobId).toBe(JOB);
  });

  it("no page job (a forged or foreign path) injects nothing", async () => {
    const { handed } = await ask({ question: "add", surface: "bid", pagePath: "/bid/estimates/aaaaaaaaaaaaaaaaaaaa" });
    await handed!.execute("add_catalog_line", { item: "x", quantity: "1" }, META);
    const input = resolves.get("add_catalog_line")!.mock.calls[0]![1] as Record<string, string>;
    expect(input.jobId).toBeUndefined();
  });

  it("the CRM does not inject — its behaviour is unchanged", async () => {
    const { handed } = await ask({ question: "add", pagePath: `/jobs/${JOB}` });
    await handed!.execute("add_catalog_line", { item: "x", quantity: "1" }, META);
    const input = resolves.get("add_catalog_line")!.mock.calls[0]![1] as Record<string, string>;
    expect(input.jobId).toBeUndefined();
  });
});
