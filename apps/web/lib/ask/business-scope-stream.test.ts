import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The business scope through `streamAnswer` — the one place the paragraph
 * meets the rest of the request.
 *
 * The provider loop is replaced by a capture, the same arrangement
 * attachmentStream.test.ts uses, so what is asserted is exactly what
 * `streamAnswer` would hand the model: the context string and the tool
 * list. Unit-testing the paragraph alone cannot see either of the two
 * things that would actually break this feature — the context not being
 * joined in at all, and the tool list narrowing to match the answers.
 */

type Captured = { context?: string; tools?: { name: string }[]; question: string };
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
      yield { type: "text", delta: "Nothing overdue." };
      yield { type: "usage", usage: { passes: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      yield { type: "done", toolsCalled: [] };
    })();
  },
}));

vi.mock("./usage", () => ({
  askAllowance: async () => ({ ok: true }),
  recordAskUsage: async () => {},
}));

/**
 * No database, and that is about the clock as much as about isolation.
 *
 * Importing the real client instantiates Prisma and opens a connection to
 * whatever `DATABASE_URL` names — a Neon endpoint that may be asleep. It
 * cost this file a 5-second timeout on a run where the code was perfectly
 * correct, which is a test that reports the wrong thing about the diff.
 *
 * Nothing here needs a row: no `pagePath` means `resolvePageJob` returns
 * before it queries, no tool is executed because the provider loop is a
 * capture, and no proposal is recorded. So the client is replaced by a
 * marker that would throw if any of that stopped being true, rather than
 * by a stub that would quietly answer.
 */
vi.mock("@prova/db", async (importOriginal) => ({
  // Everything else stays real — modules under test build `Prisma.Decimal`
  // constants at import time. Only the client is replaced.
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
import { UNANSWERED_SCOPE, type BusinessScopeAnswers } from "@/lib/businessScope";

/** Imported once, at module scope, rather than inside each test: `answer.ts`
 * pulls in the whole tool and command registry, and charging that transform
 * to the first test's 5-second budget is how this file first went red on a
 * diff that was correct. */
const { streamAnswer } = await import("./answer");

const base: CommandContext = {
  companyId: "co1",
  userId: "u1",
  principal: { role: "OWNER", jobFunction: null },
  today: "2026-09-21",
};

const publicSub: BusinessScopeAnswers = {
  contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
  doesPublicWork: true,
  filesMonthlyPayApps: true,
};

const privateDirect: BusinessScopeAnswers = {
  contractingRelationship: "DIRECT_FOR_OWNERS",
  doesPublicWork: false,
  filesMonthlyPayApps: false,
};

/** Asks, and returns WHAT THE MODEL WOULD HAVE BEEN HANDED. Returning the
 * capture rather than reading the module variable afterwards is not only
 * tidier: the variable is filled inside the mocked provider loop, which the
 * compiler cannot see, so a test that resets it to null and reads it again
 * is reading something TypeScript has narrowed to `never`. */
async function ask(question: string, businessScope?: BusinessScopeAnswers): Promise<Captured | null> {
  captured = null;
  for await (const _event of streamAnswer({ ...base, businessScope }, { question })) {
    // Drained: the generator does the work, and nothing here asserts on the
    // events themselves.
  }
  return captured;
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
});

describe("what the model is told about the business", () => {
  it("reaches it for a public-works sub who files pay applications", async () => {
    const handed = await ask("what's overdue?", publicSub);
    expect(handed?.context).toContain("HOW THIS COMPANY WORKS");
    expect(handed?.context).toContain("they take public / prevailing-wage work");
    expect(handed?.context).toContain("a GC makes them file a pay application every month to get paid");
  });

  it("reaches it, saying the opposite, for a contractor working direct for owners", async () => {
    const handed = await ask("what's overdue?", privateDirect);
    expect(handed?.context).toContain("they contract direct for owners, not under GCs");
    expect(handed?.context).toContain("they take no public or prevailing-wage work");
  });
});

describe("a company that answered nothing", () => {
  it("is handed exactly what it was handed before this existed — no context at all", async () => {
    const allNull = (await ask("what's overdue?", UNANSWERED_SCOPE))?.context;
    const omitted = (await ask("what's overdue?"))?.context;

    // An owner with no page, no prior turns and no attachment had no
    // per-request context before this feature, and still has none. Both
    // arms are asserted because "skipped the questions" and "a caller that
    // never passes them" must stay the same one behaviour.
    expect(allNull).toBeUndefined();
    expect(omitted).toBeUndefined();
    expect(allNull).toEqual(omitted);
  });
});

describe("the promise that nothing is removed for good", () => {
  it("offers the certified-payroll tool to a contractor who said he does no public work", async () => {
    // The task's own test of the promise: /welcome says search and Ask can
    // still reach anything. If the answers ever narrowed the tool list,
    // this is where it would show, and no amount of prompt wording would
    // undo it — a tool the model was not offered cannot be called.
    const handed = await ask("can we produce certified payroll for Riverside last week?", privateDirect);
    const names = (handed?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain("certified_payroll");
    expect(names).toContain("wage_determinations");
  });

  it("offers the SAME tools whatever the answers are, and the same as for a company with none", async () => {
    const offeredFor = async (scope?: BusinessScopeAnswers) =>
      ((await ask("what needs my attention today?", scope))?.tools ?? []).map((tool) => tool.name).sort();

    const none = await offeredFor(undefined);
    expect(none.length).toBeGreaterThan(10);
    expect(await offeredFor(publicSub)).toEqual(none);
    expect(await offeredFor(privateDirect)).toEqual(none);
    expect(await offeredFor(UNANSWERED_SCOPE)).toEqual(none);
  });

  it("tells the model in words that the shape is not a limit", async () => {
    const handed = await ask("what about certified payroll?", privateDirect);
    expect(handed?.context).toContain("THIS NEVER LIMITS WHAT YOU ANSWER");
    expect(handed?.context).toContain("certified payroll at a company that does no public work");
  });
});
