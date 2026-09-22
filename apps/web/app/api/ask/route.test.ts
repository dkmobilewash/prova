import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the route hands the assistant about the company asking.
 *
 * Everything else about the business scope is pure and unit-tested
 * (lib/ask/business-scope-context.ts) or asserted through the stream
 * (lib/ask/business-scope-stream.test.ts). This is the one seam neither can
 * see: whether the three answers actually come off the SESSION's Company
 * row, and off the right fields. `doesPublicWork` and `filesMonthlyPayApps`
 * are both `boolean | null`, so swapping them typechecks perfectly and
 * would tell the model the opposite of what the contractor answered on two
 * of the three questions.
 */

type Ctx = { businessScope?: Record<string, unknown>; companyId?: string };
let handed: Ctx | null = null;
let company: Record<string, unknown> = {};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({
    id: "u_1",
    role: "OWNER",
    jobFunction: null,
    company: { id: "co_1", ...company },
  }),
}));

vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => "2026-09-21" }));

vi.mock("@/lib/ask/answer", () => ({
  streamAnswer: (ctx: Ctx) => {
    handed = ctx;
    return (async function* () {
      yield { type: "done", citations: [], toolsUsed: [] };
    })();
  },
}));

const { POST } = await import("./route");

async function post(body: unknown) {
  handed = null;
  const response = await POST(new Request("https://app.cstream.ai/api/ask", { method: "POST", body: JSON.stringify(body) }));
  // Drain the stream so the handler's generator actually runs.
  await response.text();
  return response;
}

beforeEach(() => {
  company = {};
});

describe("the three onboarding answers", () => {
  it("are read off this session's own company row, field for field", async () => {
    company = {
      contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
      doesPublicWork: true,
      filesMonthlyPayApps: false,
    };
    await post({ question: "what's overdue?" });

    expect(handed?.businessScope).toEqual({
      contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
      // Asserted as a whole object, and with the two booleans DIFFERENT
      // from each other on purpose: equal values would let the fields be
      // swapped and still pass.
      doesPublicWork: true,
      filesMonthlyPayApps: false,
    });
    expect(handed?.companyId).toBe("co_1");
  });

  it("pass through as nulls for a company that skipped them", async () => {
    company = { contractingRelationship: null, doesPublicWork: null, filesMonthlyPayApps: null };
    await post({ question: "what's overdue?" });
    expect(handed?.businessScope).toEqual({
      contractingRelationship: null,
      doesPublicWork: null,
      filesMonthlyPayApps: null,
    });
  });

  it("cannot be supplied by the caller — the body is not a source of them", async () => {
    // The same rule as companyId and the role beside it: a scope sent in
    // the payload must not reach the model, or anyone could tell the
    // assistant what kind of company they are. Today's answers win because
    // the route never reads the body for them; this fails loudly if that
    // ever changes.
    company = { contractingRelationship: "DIRECT_FOR_OWNERS", doesPublicWork: false, filesMonthlyPayApps: false };
    await post({
      question: "what's overdue?",
      businessScope: { contractingRelationship: "BOTH", doesPublicWork: true, filesMonthlyPayApps: true },
    });
    expect(handed?.businessScope).toEqual({
      contractingRelationship: "DIRECT_FOR_OWNERS",
      doesPublicWork: false,
      filesMonthlyPayApps: false,
    });
  });
});
