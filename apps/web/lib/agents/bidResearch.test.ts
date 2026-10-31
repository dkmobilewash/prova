import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  bidInvitation: { findFirst: vi.fn(), findMany: vi.fn() },
  contact: { findFirst: vi.fn() },
  job: { findMany: vi.fn() },
  agentFinding: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
}));
const ai = vi.hoisted(() => ({ agentPass: vi.fn(), anthropicIsConfigured: vi.fn(), gate: vi.fn(), usage: vi.fn() }));
vi.mock("@prova/db", () => ({ prisma: db, Prisma: {} }));
vi.mock("@prova/integrations", () => ({ agentPass: ai.agentPass, anthropicIsConfigured: ai.anthropicIsConfigured }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: ai.gate }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: ai.usage }));

import { researchBid } from "./bidResearch";
import { AGENT_RUNNERS, type AgentContext } from "./run";

const ctx: AgentContext = {
  run: { id: "run1", companyId: "c1", agent: "BID_RESEARCH" },
  companyId: "c1",
  bidInvitationId: "bid1",
  userId: "u1",
  model: "claude-opus-5",
  settings: {} as AgentContext["settings"],
};
type Written = { kind: string; title: string; body: string; sources: { recordId?: string; url?: string }[] };
const created: Written[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  created.length = 0;
  db.bidInvitation.findFirst.mockResolvedValue({
    id: "bid1",
    projectName: "Riverside Clinic",
    contactId: "gc1",
    tradeScope: null,
    bidAmount: null,
    contact: { name: "Turner" },
    pursuit: null,
    wonJob: null,
  });
  // A GC with NO history: only this bid, no jobs.
  db.contact.findFirst.mockResolvedValue({ id: "gc1", name: "Turner" });
  db.bidInvitation.findMany.mockResolvedValue([{ id: "bid1", projectName: "Riverside Clinic", status: "INVITED", outcome: null }]);
  db.job.findMany.mockResolvedValue([]);
  db.agentFinding.findUnique.mockResolvedValue(null);
  db.agentFinding.findMany.mockResolvedValue([]);
  db.agentFinding.create.mockImplementation(async ({ data }: { data: Written }) => {
    created.push(data);
    return { id: `f${created.length}` };
  });
  ai.anthropicIsConfigured.mockReturnValue(false);
  ai.gate.mockResolvedValue({ ok: true, model: "claude-opus-5" });
});

describe("BID_RESEARCH", () => {
  it("registers itself", () => {
    expect(AGENT_RUNNERS.BID_RESEARCH).toBe(researchBid);
  });

  it("on a GC with no history says so, cited to the contact, and invents no rate", async () => {
    const out = await researchBid(ctx);
    expect(created.map((f) => f.kind)).toEqual(["gc_history", "pay_speed"]);
    for (const f of created) {
      expect(f.sources).toEqual([expect.objectContaining({ recordType: "Contact", recordId: "gc1" })]);
      expect(f.body).not.toMatch(/\d+%|\d+ days/);
    }
    expect(ai.agentPass).not.toHaveBeenCalled();
    expect(out.summary).toBe("2 new findings on Riverside Clinic.");
  });

  it("says the GC count is of logged bid invitations, not jobs", async () => {
    await researchBid(ctx);
    const f = created.find((x) => x.kind === "gc_history")!;
    expect(f.title).toBe("No other bid invitations logged from Turner");
    expect(f.body).toContain("Only logged bid invitations are counted here, not jobs or estimates.");
  });

  it("never counts another GC's bid for the SAME job as a similar past bid", async () => {
    db.bidInvitation.findFirst.mockResolvedValue({
      ...(await db.bidInvitation.findFirst()),
      tradeScope: "METAL_FRAMING_DRYWALL",
      bidProject: { invitations: [{ id: "bid1" }, { id: "sibling" }] },
    });
    const past = (id: string, projectName: string, status: string) => ({
      id, projectName, status, bidAmount: null, wonJobId: null, contact: { name: "Halvorsen" }, outcome: null,
    });
    db.bidInvitation.findMany.mockImplementation(async ({ where }: { where: { tradeScope?: string } }) =>
      where.tradeScope
        ? [past("sibling", "Riverside Clinic", "INVITED"), past("old", "Harbor Lofts", "WON")]
        : [{ id: "bid1", projectName: "Riverside Clinic", status: "INVITED", outcome: null }],
    );
    await researchBid(ctx);
    const f = created.find((x) => x.kind === "similar_jobs")!;
    expect(f.title).toBe("1 similar past bid: 1 won, 0 lost");
    expect(f.body).not.toContain("Riverside Clinic");
    expect(f.sources.map((s) => s.recordId)).toEqual(["old"]);
  });

  it("writes owner/architect from the linked pursuit, cited to it", async () => {
    db.bidInvitation.findFirst.mockResolvedValue({
      ...(await db.bidInvitation.findFirst()),
      pursuit: { id: "p1", owner: "City of Salem", architect: "BRIC" },
    });
    await researchBid(ctx);
    const f = created.find((x) => x.kind === "owner_architect")!;
    expect(f.body).toContain("Owner: City of Salem. Architect: BRIC");
    expect(f.sources[0]!.recordId).toBe("p1");
  });

  it("makes ONE web pass with only project, GC and city, records usage, and writes a finding sourced to the searched URLs", async () => {
    ai.anthropicIsConfigured.mockReturnValue(true);
    db.bidInvitation.findFirst.mockResolvedValue({ ...(await db.bidInvitation.findFirst()), wonJob: { projectLocation: "Salem, OR" } });
    ai.agentPass.mockResolvedValue({
      text: "A three-storey clinic, groundbreaking in March.",
      usage: { passes: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 2 },
      citations: [{ url: "https://news.example.com/clinic", title: "Clinic news" }],
    });
    await researchBid(ctx);
    expect(ai.gate).toHaveBeenCalledWith("c1", "AI_AGENTS");
    expect(ai.agentPass).toHaveBeenCalledTimes(1);
    const call = ai.agentPass.mock.calls[0][0];
    expect(call.prompt).toBe("Project: Riverside Clinic\nGeneral contractor: Turner\nCity: Salem, OR");
    expect(call).toMatchObject({ model: "claude-opus-5", webSearch: true });
    expect(ai.usage).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c1", feature: "ai-agents", model: "claude-opus-5" }));
    const web = created.find((f) => f.kind === "web")!;
    expect(web.sources).toEqual([{ label: "Clinic news", url: "https://news.example.com/clinic" }]);
  });

  it("tells the web pass which earlier findings on THIS bid were marked Not right", async () => {
    ai.anthropicIsConfigured.mockReturnValue(true);
    ai.agentPass.mockResolvedValue({ text: "NOTHING FOUND", usage: { passes: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, citations: [] });
    db.agentFinding.findMany.mockResolvedValue([{ title: "What the web says", body: "A five-storey hospital tower." }]);

    await researchBid(ctx);

    expect(db.agentFinding.findMany.mock.calls[0][0].where).toEqual({ companyId: "c1", bidInvitationId: "bid1", dismissedReason: "WRONG" });
    const prompt: string = ai.agentPass.mock.calls[0][0].prompt;
    expect(prompt).toMatch(/^Project: Riverside Clinic\nGeneral contractor: Turner\n\nThe estimator marked these earlier findings on this project as NOT RIGHT/);
    expect(prompt).toContain("- What the web says: A five-storey hospital tower.");
  });

  it("writes NO web finding when the search returned nothing to cite", async () => {
    ai.anthropicIsConfigured.mockReturnValue(true);
    ai.agentPass.mockResolvedValue({
      text: "The clinic is huge.",
      usage: { passes: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      citations: [],
    });
    const out = await researchBid(ctx);
    expect(created.some((f) => f.kind === "web")).toBe(false);
    expect(ai.usage).toHaveBeenCalledTimes(1);
    expect(out.summary).toContain("found nothing to cite");
  });

  it("skips the web pass when the company AI switch refuses", async () => {
    ai.anthropicIsConfigured.mockReturnValue(true);
    ai.gate.mockResolvedValue({ ok: false, error: "off" });
    await researchBid(ctx);
    expect(ai.agentPass).not.toHaveBeenCalled();
  });

  it("fails with a sentence when no bid is given", async () => {
    await expect(researchBid({ ...ctx, bidInvitationId: null })).rejects.toThrow("No bid given");
  });
});
