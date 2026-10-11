import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  bidInvitation: { findFirst: vi.fn(), findMany: vi.fn() },
  jobLineItem: { findMany: vi.fn() },
  agentFinding: { create: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@prova/db", () => ({ prisma: db, Prisma: {} }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: vi.fn() }));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));

import {
  OUTLIER_BAND,
  checkEstimate,
  lineKey,
  median,
  missingScope,
  openAddendumItems,
  unitPriceOutliers,
  type CheckLine,
} from "./estimateCheck";
import type { AgentContext } from "./run";

const line = (id: string, jobId: string, unitPrice: number | null, extra: Partial<CheckLine> = {}): CheckLine => ({
  id,
  jobId,
  description: "5/8 Type X board",
  catalogEntryId: null,
  quantity: 100,
  unit: "SF",
  unitPrice,
  ...extra,
});

describe("unitPriceOutliers", () => {
  const history = [line("h1", "j1", 2.8), line("h2", "j2", 3.0), line("h3", "j3", 3.2)];

  it("flags a price more than 25% from the median and reports the comparison set", () => {
    const [o] = unitPriceOutliers([line("x", "now", 4.0)], history);
    expect(o).toMatchObject({ n: 3, median: 3.0, min: 2.8, max: 3.2, jobIds: ["j1", "j2", "j3"] });
    expect(o!.off).toBeCloseTo(1 / 3);
  });

  it("leaves a price inside the band alone — 3.70 is +23%", () => {
    expect(OUTLIER_BAND).toBe(0.25);
    expect(unitPriceOutliers([line("x", "now", 3.7)], history)).toEqual([]);
    expect(unitPriceOutliers([line("x", "now", 2.2)], history)).toHaveLength(1);
  });

  it("needs three past prices, ignores other units, and never compares a job with itself", () => {
    expect(unitPriceOutliers([line("x", "now", 9)], history.slice(0, 2))).toEqual([]);
    expect(unitPriceOutliers([line("x", "now", 9, { unit: "LF" })], history)).toEqual([]);
    expect(unitPriceOutliers([line("x", "j1", 9)], history)).toEqual([]);
  });

  it("matches on the catalog entry before the description, and on description ignoring case and spacing", () => {
    expect(lineKey({ description: "  5/8  TYPE x Board", catalogEntryId: null })).toBe(lineKey(line("a", "b", 1)));
    expect(lineKey({ description: "anything", catalogEntryId: "cat1" })).toBe("catalog:cat1");
    expect(median([5, 1, 3, 2])).toBe(2.5);
  });
});

describe("missingScope", () => {
  const jobs = (n: number, withLine: number) =>
    new Map(
      Array.from({ length: n }, (_, i) => [
        `j${i}`,
        [line(`a${i}`, `j${i}`, 1, { description: "Framing" }), ...(i < withLine ? [line(`b${i}`, `j${i}`, 1, { description: "Firestopping" })] : [])],
      ]),
    );

  it("names a line on ≥60% of similar jobs and absent here, citing those jobs", () => {
    const [gap] = missingScope([line("x", "now", 1, { description: "Framing" })], jobs(5, 3));
    expect(gap).toMatchObject({ description: "Firestopping", jobIds: ["j0", "j1", "j2"], ofJobs: 5 });
    expect(missingScope([line("x", "now", 1, { description: "Framing" })], jobs(5, 2))).toEqual([]);
  });

  it("says nothing on fewer than three similar estimates", () => {
    expect(missingScope([], jobs(2, 2))).toEqual([]);
  });
});

describe("openAddendumItems", () => {
  it("counts items whose normalised reference has no decision", () => {
    const items = [{ reference: "Section 09 21 16 - Gypsum Board" }, { reference: "A-201" }, { reference: 5 }];
    expect(openAddendumItems(items, [{ normalisedReference: "092116" }])).toEqual({ open: 1, total: 3 });
    expect(openAddendumItems(null, [])).toEqual({ open: 0, total: 0 });
  });
});

describe("the ESTIMATE_CHECK runner", () => {
  const ctx: AgentContext = {
    run: { id: "run1", companyId: "c1", agent: "ESTIMATE_CHECK" },
    companyId: "c1",
    bidInvitationId: "bid1",
    userId: null,
    model: "claude-opus-5",
    settings: {} as AgentContext["settings"],
  };
  const created: { kind: string; sources: unknown[] }[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    created.length = 0;
    db.agentFinding.findUnique.mockResolvedValue(null);
    db.agentFinding.create.mockImplementation(async ({ data }: { data: { kind: string; sources: unknown[] } }) => {
      created.push(data);
      return { id: `f${created.length}` };
    });
    db.bidInvitation.findMany.mockResolvedValue([]);
  });

  it("with no linked estimate and nothing else, writes one cited 'no estimate' finding and no numbers", async () => {
    db.bidInvitation.findFirst.mockResolvedValue({
      id: "bid1",
      projectName: "Riverside",
      tradeScope: null,
      bidAmount: null,
      wonJobId: null,
      lines: [],
      addenda: [],
    });
    const out = await checkEstimate(ctx);
    expect(created.map((f) => f.kind)).toEqual(["no_estimate"]);
    expect(created[0]!.sources).toEqual([expect.objectContaining({ recordId: "bid1" })]);
    expect(out.summary).toBe("1 new finding on Riverside's estimate.");
  });

  it("over a real-shaped estimate finds an outlier, a zero line, an unread addendum and an open item — every one cited", async () => {
    db.bidInvitation.findFirst.mockResolvedValue({
      id: "bid1",
      projectName: "Riverside",
      tradeScope: "METAL_FRAMING_DRYWALL",
      bidAmount: null,
      wonJobId: "job1",
      lines: [{ id: "bl1", kind: "UNIT_PRICE", label: "Extra board", amount: null, unitPrice: 0 }],
      addenda: [
        { id: "ad1", reference: "1", readings: [], decisions: [] },
        { id: "ad2", reference: "2", readings: [{ id: "r1", items: [{ reference: "A-201" }] }], decisions: [] },
        { id: "ad3", reference: "3", readings: [{ id: "r2", items: [{ reference: "A-301" }] }], decisions: [{ normalisedReference: "a301" }] },
      ],
    });
    db.jobLineItem.findMany
      // the estimate
      .mockResolvedValueOnce([
        { id: "l1", jobId: "job1", description: "5/8 Type X board", quantity: 100, unit: "SF", unitPrice: 4.5 },
        { id: "l2", jobId: "job1", description: "Corner bead", quantity: 0, unit: "LF", unitPrice: 1 },
      ])
      // price history
      .mockResolvedValueOnce([
        { id: "h1", jobId: "j1", description: "5/8 type x board", quantity: 1, unit: "SF", unitPrice: 2.9 },
        { id: "h2", jobId: "j2", description: "5/8 Type X board", quantity: 1, unit: "SF", unitPrice: 3.0 },
        { id: "h3", jobId: "j3", description: "5/8 Type X board", quantity: 1, unit: "SF", unitPrice: 3.1 },
      ]);
    await checkEstimate(ctx);
    expect(created.map((f) => f.kind).sort()).toEqual(["addendum_open", "addendum_open", "unit_price_outlier", "zero_line", "zero_line"]);
    for (const finding of created) expect(finding.sources.length).toBeGreaterThan(0);
    const outlier = created.find((f) => f.kind === "unit_price_outlier") as unknown as { body: string; sources: { recordId: string }[] };
    expect(outlier.body).toContain("median $3.00");
    expect(outlier.sources.map((s) => s.recordId)).toEqual(["l1", "j1", "j2", "j3"]);
  });

  it("fails the run with a sentence when no bid is given", async () => {
    await expect(checkEstimate({ ...ctx, bidInvitationId: null })).rejects.toThrow(/No bid given/);
  });
});
