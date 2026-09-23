import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BidResearcher } from "./commands";
import type { WebSuggestion } from "./webSuggestions";
import { keepSuggestions } from "./webSuggestions";

/**
 * "Start a bid": ask before creating, research only what was typed, and
 * write nothing from the web unless a person kept it and tapped.
 *
 * `create_estimate_job` is what "start a bid" maps to (its description says
 * so, for the model). These drive its `resolve` and `execute` against a
 * fake Prisma and a fake researcher, so every assertion is about what the
 * code does with whatever the model or the web hands it.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  const tx = {
    contact: { findFirst: fn(), create: fn() },
    job: { findFirst: fn(), create: fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (run: (t: typeof tx) => Promise<unknown>) => run(tx)),
      contact: { findMany: fn(), findFirst: fn() },
      job: { findMany: fn(), findFirst: fn() },
    },
    draft: vi.fn(),
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@prova/integrations", () => ({ draftEstimateLineItems: fake.draft }));

const { createEstimateJobCommand, missingBidEssentials } = await import("./commands/estimating");

const baseCtx = {
  companyId: "co-1",
  userId: "u-1",
  principal: { role: "OWNER" as const, jobFunction: null },
  today: "2026-09-18",
};

const OWNER: WebSuggestion = {
  key: "owner",
  label: "Owner",
  value: "City of Portland",
  sources: [{ title: "Sellwood Clinic", url: "https://www.portland.gov/sellwood-clinic" }],
};
const ARCHITECT: WebSuggestion = {
  key: "architect",
  label: "Architect",
  value: "Hacker Architects",
  sources: [{ title: "Hacker", url: "https://hacker.example.com/sellwood" }],
};

const full = {
  jobName: "Sellwood Clinic",
  gcName: "Brackett",
  location: "Portland, OR",
  bidDueDate: "Oct 10",
  scope: "drywall",
};

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) {
    if (typeof model === "object") for (const method of Object.values(model)) (method as ReturnType<typeof vi.fn>).mockReset();
  }
  for (const model of Object.values(fake.tx)) for (const method of Object.values(model)) method.mockReset();
  fake.prisma.$transaction.mockImplementation(async (run: (t: typeof fake.tx) => Promise<unknown>) => run(fake.tx));
  // No Brackett on file: a new contact, so no natural-key lookup either.
  fake.prisma.contact.findMany.mockResolvedValue([]);
});

describe("start a bid with too little", () => {
  it("asks for every missing essential in one question, and reads and researches nothing", async () => {
    const research = vi.fn<BidResearcher>();
    const result = await createEstimateJobCommand.resolve({ ...baseCtx, research }, {});
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    for (const essential of ["project's name", "GC", "where it is", "when the bid is due", "our scope"]) {
      expect(result.missing).toContain(essential);
    }
    expect(result.missing).toMatch(/one short question/);
    expect(research).not.toHaveBeenCalled();
    expect(fake.prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("names only what is actually missing", () => {
    expect(missingBidEssentials({ jobName: "Sellwood Clinic", location: "Portland" })).toEqual([
      "the GC (or owner) it's for",
      "when the bid is due",
      "our scope on it",
    ]);
  });

  it("still asks when the name is given but the GC is not — never a job with no GC", async () => {
    const result = await createEstimateJobCommand.resolve(baseCtx, { jobName: "Sellwood Clinic", location: "Portland, OR" });
    expect(result.kind).toBe("need");
  });
});

describe("researching the project", () => {
  it("sends the researcher ONLY the project name and the location as typed", async () => {
    const research = vi.fn<BidResearcher>(async () => ({ ok: true, suggestions: [OWNER] }));
    await createEstimateJobCommand.resolve({ ...baseCtx, research }, { ...full, gcEmail: "est@brackett.com" });
    expect(research).toHaveBeenCalledTimes(1);
    expect(research.mock.calls[0][0]).toEqual({ projectName: "Sellwood Clinic", location: "Portland, OR" });
  });

  it("puts what the web found on the card as suggestions, apart from the preview", async () => {
    const research = vi.fn<BidResearcher>(async () => ({ ok: true, suggestions: [OWNER, ARCHITECT] }));
    const result = await createEstimateJobCommand.resolve({ ...baseCtx, research }, full);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.suggestions).toEqual([OWNER, ARCHITECT]);
    expect(result.resolved.webSuggestions).toEqual([OWNER, ARCHITECT]);
    // Nothing from the web leaks into the person's own lines.
    expect(JSON.stringify(result.preview)).not.toContain("City of Portland");
    expect(result.preview.find((line) => line.label === "Location")?.value).toBe("Portland, OR");
    expect(result.preview.find((line) => line.label === "Bid due")?.value).toMatch(/Oct/);
  });

  it("does not research without a location, and says so", async () => {
    const research = vi.fn<BidResearcher>();
    const { location: _omit, ...noLocation } = full;
    void _omit;
    const result = await createEstimateJobCommand.resolve({ ...baseCtx, research }, noLocation);
    expect(research).not.toHaveBeenCalled();
    expect(result.kind === "ready" && result.warnings.join(" ")).toMatch(/No location given/);
  });

  it("stops at a which-year chip for the due date BEFORE spending a search", async () => {
    const research = vi.fn<BidResearcher>();
    const result = await createEstimateJobCommand.resolve({ ...baseCtx, research }, { ...full, bidDueDate: "March 3" });
    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") expect(result.field).toBe("bidDueDate");
    expect(research).not.toHaveBeenCalled();
  });
});

describe("when web search is unavailable", () => {
  it("still makes the card from what the person gave, and says research was unavailable", async () => {
    const research = vi.fn<BidResearcher>(async () => ({ ok: false }));
    const result = await createEstimateJobCommand.resolve({ ...baseCtx, research }, full);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.suggestions ?? []).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/Web research is unavailable/);
    expect(result.resolved.jobName).toBe("Sellwood Clinic");
  });

  it("survives a researcher that throws", async () => {
    const research = vi.fn<BidResearcher>(async () => {
      throw new Error("boom");
    });
    const result = await createEstimateJobCommand.resolve({ ...baseCtx, research }, full);
    expect(result.kind).toBe("ready");
  });

  it("says plainly when the web had nothing", async () => {
    const research = vi.fn<BidResearcher>(async () => ({ ok: true, suggestions: [] }));
    const result = await createEstimateJobCommand.resolve({ ...baseCtx, research }, full);
    expect(result.kind === "ready" && result.warnings.join(" ")).toMatch(/Nothing about Sellwood Clinic/);
  });
});

describe("nothing from the web is written without the tap", () => {
  it("resolve writes no business row, however much the web found", async () => {
    const research = vi.fn<BidResearcher>(async () => ({ ok: true, suggestions: [OWNER, ARCHITECT] }));
    await createEstimateJobCommand.resolve({ ...baseCtx, research }, full);
    expect(fake.tx.job.create).not.toHaveBeenCalled();
    expect(fake.tx.contact.create).not.toHaveBeenCalled();
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("execute writes exactly the suggestions still in the payload — the dropped one is gone", async () => {
    const research = vi.fn<BidResearcher>(async () => ({ ok: true, suggestions: [OWNER, ARCHITECT] }));
    const ready = await createEstimateJobCommand.resolve({ ...baseCtx, research }, full);
    if (ready.kind !== "ready") throw new Error("unreachable");

    // What confirmAskProposal does with the person's untick of "architect".
    const payload = { ...ready.resolved, webSuggestions: keepSuggestions(ready.resolved.webSuggestions, ["architect"]) };

    fake.tx.contact.create.mockResolvedValue({ id: "c-new" });
    fake.tx.job.create.mockResolvedValue({ id: "job-1" });
    const executed = await createEstimateJobCommand.execute(baseCtx, payload);
    expect(executed.ok).toBe(true);

    const data = fake.tx.job.create.mock.calls[0][0].data;
    expect(data.bidResearch).toEqual([OWNER]);
    expect(data.projectLocation).toBe("Portland, OR");
    expect(data.bidDueDate).toEqual(new Date("2026-10-10T00:00:00.000Z"));
    // The web never reaches the scope, which drafts line items.
    expect(data.scope).toBe("drywall");
  });

  it("writes no bidResearch at all when every suggestion was dropped", async () => {
    const research = vi.fn<BidResearcher>(async () => ({ ok: true, suggestions: [OWNER] }));
    const ready = await createEstimateJobCommand.resolve({ ...baseCtx, research }, full);
    if (ready.kind !== "ready") throw new Error("unreachable");
    const payload = { ...ready.resolved, webSuggestions: keepSuggestions(ready.resolved.webSuggestions, ["owner"]) };
    fake.tx.contact.create.mockResolvedValue({ id: "c-new" });
    fake.tx.job.create.mockResolvedValue({ id: "job-1" });
    await createEstimateJobCommand.execute(baseCtx, payload);
    expect(fake.tx.job.create.mock.calls[0][0].data).not.toHaveProperty("bidResearch");
  });

  it("drops a stored suggestion whose link is not http(s), so it can never render as a script", () => {
    const hostile = [{ ...OWNER, sources: [{ title: "x", url: "javascript:alert(1)" }] }];
    expect(keepSuggestions(hostile)).toEqual([]);
  });
});
