import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `readBidInvitationText` and `checkSameJobFromOtherGc` against a mocked model
 * and a fake database. What is pinned:
 *
 *   - the ORDER of the refusals, each a sentence: capability, the paste
 *     itself, the AI switch, the allowance — and none of them reaches the
 *     model, and the first three claim nothing;
 *   - a failed model call MARKS the claim and says nothing was saved;
 *   - a successful read returns the code-checked suggestion (an invented field
 *     is dropped HERE, at the action, not only in the pure module's own test);
 *   - NOTHING IS WRITTEN on any path: the fake database has no write methods,
 *     so a create, update or upsert anywhere would throw.
 */

type Fake = { company: { id: string }; id: string; role: string; jobFunction: string | null };
const context: Fake = { company: { id: "co_1" }, id: "user_1", role: "OWNER", jobFunction: null };

let allowed = true;
let gateOk = true;
let allowanceOk = true;
let extractorThrows = false;
let extraction: Record<string, unknown> = {};
const calls = { claimed: 0, marked: 0, extracted: 0, usage: [] as Record<string, unknown>[] };
let openInvitations: unknown[] = [];

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("@/lib/permissions", () => ({ can: () => allowed }));
vi.mock("@/lib/agents/onEvent", () => ({ runAgentAfterResponse: () => undefined }));
vi.mock("@prova/db", () => ({
  prisma: {
    // READS ONLY. No create/update/upsert exists on this fake, so a write would
    // throw "is not a function" and fail the case it happened in.
    contact: {
      findMany: async () => [
        { id: "acme", name: "Acme Builders" },
        { id: "baker", name: "Baker Construction" },
      ],
    },
    bidInvitation: { findMany: async () => openInvitations },
  },
}));
vi.mock("@/lib/ai/settings", () => ({
  aiGate: async () =>
    gateOk
      ? { ok: true, model: "claude-opus-5" }
      : { ok: false, error: "Bid research is switched off for your company." },
}));
vi.mock("@/lib/ask/usage", () => ({
  recordAskUsage: async (record: Record<string, unknown>) => {
    calls.usage.push(record);
  },
}));
vi.mock("@/lib/ask/allowance", () => ({
  claimAskAllowance: async () => {
    calls.claimed += 1;
    return allowanceOk
      ? { ok: true, claim: { companyId: "co_1" }, left: { questions: 41, pages: 300 } }
      : { ok: false, error: "That wasn't sent — your company has used 300 of its 300 assistant questions for this month." };
  },
  markAskAllowanceFailure: async () => {
    calls.marked += 1;
  },
}));
vi.mock("@prova/integrations", () => ({
  BID_INVITE_PROMPT_VERSION: "bid-invite.test",
  extractBidInvite: async (params: { onUsage?: (usage: unknown) => Promise<void> }) => {
    calls.extracted += 1;
    await params.onUsage?.({ inputTokens: 1, outputTokens: 1 });
    if (extractorThrows) throw new Error("overloaded");
    return extraction;
  },
}));

const { readBidInvitationText, checkSameJobFromOtherGc } = await import("./bidInviteRead");

const INVITE = `Acme Builders invites you to bid Riverside Medical Office.
Address: 4500 Brockton Ave, Riverside CA
Bids due November 4, 2026 at 2 PM. Scope: Drywall.`;

beforeEach(() => {
  allowed = true;
  gateOk = true;
  allowanceOk = true;
  extractorThrows = false;
  calls.claimed = 0;
  calls.marked = 0;
  calls.extracted = 0;
  calls.usage = [];
  openInvitations = [];
  extraction = {
    gcName: "Acme Builders",
    projectName: "Riverside Medical Office",
    siteAddress: "4500 Brockton Ave",
    siteCity: "Riverside CA",
    tradeText: "Drywall",
    bidDueText: "November 4, 2026",
    bidDueDate: "2026-11-04",
    bidDueTime: "2 PM",
    jobWalk: null,
    bonding: null,
    planLink: null,
    readingNotes: null,
  };
});

describe("readBidInvitationText — refusals, in order, none reaching the model", () => {
  it("refuses somebody without estimating, in the house sentence, before anything else", async () => {
    allowed = false;
    const result = await readBidInvitationText(INVITE);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/part of your job function/) });
    expect(calls).toMatchObject({ claimed: 0, extracted: 0 });
  });

  it("refuses an empty paste without claiming or calling", async () => {
    expect(await readBidInvitationText("  ")).toEqual({ ok: false, error: "Paste the invitation text first." });
    expect(calls).toMatchObject({ claimed: 0, extracted: 0 });
  });

  it("refuses when the company's AI switch is off, says typing still works, and claims nothing", async () => {
    gateOk = false;
    expect(await readBidInvitationText(INVITE)).toEqual({
      ok: false,
      error: "Bid research is switched off for your company. You can still type the invitation in yourself.",
    });
    expect(calls).toMatchObject({ claimed: 0, extracted: 0 });
  });

  it("refuses when the monthly allowance is spent, in the allowance's own sentence, before the model", async () => {
    allowanceOk = false;
    const result = await readBidInvitationText(INVITE);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^That wasn't sent/) });
    expect(calls).toMatchObject({ claimed: 1, extracted: 0 });
  });
});

describe("readBidInvitationText — a failed read", () => {
  it("marks the claimed question as failed and says nothing was saved", async () => {
    extractorThrows = true;
    const result = await readBidInvitationText(INVITE);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/couldn't be read.*nothing was saved\.$/);
    expect(calls).toMatchObject({ claimed: 1, extracted: 1, marked: 1 });
  });
});

describe("readBidInvitationText — a successful read", () => {
  it("returns the checked suggestion, metered as a versioned bid-research proposal", async () => {
    const result = await readBidInvitationText(INVITE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toMatchObject({
      contactId: "acme",
      projectName: "Riverside Medical Office",
      tradeScope: "METAL_FRAMING_DRYWALL",
      dueDate: "2026-11-04",
      notes: "Site: 4500 Brockton Ave, Riverside CA\nBid due time: 2 PM",
      checks: [],
    });
    expect(result.value.note).toBe(
      "Read with one assistant question — 41 left this month. Check every field before you log it.",
    );
    expect(calls).toMatchObject({ claimed: 1, extracted: 1, marked: 0 });
    expect(calls.usage).toEqual([
      expect.objectContaining({ feature: "bid-research", outcome: "proposal", promptVersion: "bid-invite.test" }),
    ]);
  });

  it("drops what the model returned that the paste does not print", async () => {
    extraction = { ...extraction, bonding: "10% bid bond", planLink: "https://example.com/plans" };
    const result = await readBidInvitationText(INVITE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.notes).not.toMatch(/Bonding|Plans/);
    expect(result.value.dropped).toEqual(["bonding", "plan link"]);
  });
});

describe("checkSameJobFromOtherGc", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "inv-1",
    contactId: "baker",
    projectName: "Riverside Medical Office",
    status: "INVITED",
    dueDate: new Date("2026-11-04T00:00:00.000Z"),
    notes: null,
    contact: { name: "Baker Construction" },
    ...over,
  });

  it("names an open invitation from another GC, reading dates and the Site line off the rows", async () => {
    openInvitations = [row({ projectName: "KP clinic", notes: "Job walk: Monday\nSite: 4500 Brockton Avenue, Riverside" })];
    const result = await checkSameJobFromOtherGc({
      contactId: "acme",
      projectName: "Riverside Medical Office",
      dueDate: "2026-11-04",
      notes: "Site: 4500 Brockton Ave, Riverside CA",
    });
    expect(result).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: "inv-1",
          sentence: "Same site address and due date as KP clinic from Baker Construction",
        }),
      ],
    });
  });

  it("says nothing for the same GC, or before a name is typed, and refuses without estimating", async () => {
    openInvitations = [row({ contactId: "acme" })];
    expect(
      await checkSameJobFromOtherGc({ contactId: "acme", projectName: "Riverside Medical Office", dueDate: "2026-11-04", notes: null }),
    ).toEqual({ ok: true, value: [] });
    expect(await checkSameJobFromOtherGc({ contactId: null, projectName: " ", dueDate: null, notes: null })).toEqual({
      ok: true,
      value: [],
    });
    allowed = false;
    const refused = await checkSameJobFromOtherGc({ contactId: null, projectName: "x", dueDate: null, notes: null });
    expect(refused.ok).toBe(false);
  });
});
