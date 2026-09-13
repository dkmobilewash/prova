import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where a drafted line's PRICE came from, against a fake Prisma.
 *
 * The badge on a drafted row (`PriceBasisBadge`, jobs/[id]/page.tsx) is the
 * most load-bearing sentence the estimating draft says out loud: green
 * "Your catalog price", blue "From your past bids — verify", amber "AI
 * guess, no company data — check the price". A tool that admits it does not
 * know what something costs is worth more than one that invents a number,
 * and that is only true while the badge describes the number actually
 * stored beside it.
 *
 * It is two files that decide those two things. The drafter
 * (packages/integrations/src/anthropic.ts) normalises the model's claimed
 * `priceBasis`, and this file decides the `unitPrice` that is written —
 * overriding the model with a matched catalog entry's own default. Nothing
 * made them agree, so both ways of disagreeing were reachable:
 *
 *   - a catalog entry with NO default price, claimed as COMPANY_CATALOG:
 *     the number stored is the MODEL'S invention, wearing the green badge;
 *   - a catalog entry WITH a default price and any other claim: the number
 *     stored is the company's own, wearing the amber "AI guess" badge, or
 *     the grey "unpriced" one beside a price.
 *
 * So `priceBasis` is derived here, from the branch that actually chose the
 * number, rather than copied from the model — the same reason this repo
 * never stores derived state it can disagree with.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findFirst: vi.fn() },
    lineItemCatalogEntry: { findMany: vi.fn() },
    bidInvitation: { findMany: vi.fn() },
    jobLineItem: { createMany: vi.fn() },
  },
  draft: vi.fn(),
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@prova/integrations", () => ({ draftEstimateLineItems: fake.draft }));

const { draftLinesFromScope, NOT_ESTIMATE_STAGE } = await import("./draft-lines");

type DraftedRow = {
  description: string;
  unit: string | null;
  unitPrice: string | null;
  priceBasis: string | null;
  sourceCatalogEntryId: string | null;
  aiDrafted: boolean;
};

/** One line as the drafter hands it over, already normalised by it. */
const drafted = (over: Record<string, unknown> = {}) => ({
  description: "Hang and finish 5/8 Type X",
  quantity: 12000,
  unit: "SF",
  unitPrice: null,
  tradeScope: null,
  catalogEntryId: null,
  priceBasis: null,
  ...over,
});

/** A catalog row as `findMany` returns it (the full row, second read). */
const entry = (over: Record<string, unknown> = {}) => ({
  id: "cat-1",
  companyId: "co-1",
  description: "5/8 Type X, hung and finished, level 4",
  unit: "SF",
  defaultUnitPrice: 3.25,
  defaultBudgetedUnitCost: 2.1,
  defaultLaborHours: null,
  craftClassificationId: null,
  tradeScope: "METAL_FRAMING_DRYWALL",
  ...over,
});

/** Runs the core with one drafted line and one catalog state, and returns
 * the rows `createMany` was actually asked to write. */
async function write(
  draftedLines: ReturnType<typeof drafted>[],
  catalogRows: ReturnType<typeof entry>[],
): Promise<DraftedRow[]> {
  fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
  fake.prisma.lineItemCatalogEntry.findMany
    .mockResolvedValueOnce(catalogRows) // reference data for the prompt
    .mockResolvedValueOnce(catalogRows); // the matched entries, read back in full
  fake.prisma.bidInvitation.findMany.mockResolvedValue([]);
  fake.draft.mockResolvedValue(draftedLines);
  fake.prisma.jobLineItem.createMany.mockResolvedValue({ count: draftedLines.length });

  const result = await draftLinesFromScope("co-1", { jobId: "job-1", scopeText: "school gym, metal stud and drywall" });
  expect(result.ok).toBe(true);

  const call = fake.prisma.jobLineItem.createMany.mock.calls[0][0] as { data: DraftedRow[] };
  // The set this test reasons about is DERIVED from the drafter's output,
  // so its size is asserted against a number that cannot drift with it: a
  // mapping that silently dropped a line would otherwise pass every
  // assertion below, because nothing is ever wrong in a list of none.
  expect(call.data).toHaveLength(draftedLines.length);
  return call.data;
}

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) {
    for (const method of Object.values(model)) (method as ReturnType<typeof vi.fn>).mockReset();
  }
  fake.draft.mockReset();
});

describe("draftLinesFromScope — the badge describes the price actually written", () => {
  it("does not call a model's own invented number a catalog price when the entry has no price", async () => {
    const [row] = await write(
      [drafted({ catalogEntryId: "cat-1", unitPrice: 4.4, priceBasis: "COMPANY_CATALOG" })],
      [entry({ defaultUnitPrice: null })],
    );
    // The catalog entry priced nothing, so the number stored is the model's.
    expect(row.unitPrice).toBe("4.4");
    expect(row.priceBasis).not.toBe("COMPANY_CATALOG");
    expect(row.priceBasis).toBe("GENERAL_KNOWLEDGE");
    // The entry still supplied the wording and the cost defaults, so the
    // provenance link stays — it is the PRICE claim that was false.
    expect(row.sourceCatalogEntryId).toBe("cat-1");
    expect(row.description).toBe("5/8 Type X, hung and finished, level 4");
  });

  it("calls a catalog price a catalog price even when the model claimed it guessed", async () => {
    const [row] = await write(
      [drafted({ catalogEntryId: "cat-1", unitPrice: 9.99, priceBasis: "GENERAL_KNOWLEDGE" })],
      [entry({ defaultUnitPrice: 3.25 })],
    );
    expect(row.unitPrice).toBe("3.25");
    expect(row.priceBasis).toBe("COMPANY_CATALOG");
  });

  it("never labels a priced row unpriced", async () => {
    const [row] = await write(
      [drafted({ catalogEntryId: "cat-1", unitPrice: null, priceBasis: null })],
      [entry({ defaultUnitPrice: 3.25 })],
    );
    expect(row.unitPrice).toBe("3.25");
    expect(row.priceBasis).toBe("COMPANY_CATALOG");
  });

  it("leaves an honest guess alone when nothing in the catalog matched", async () => {
    const [row] = await write(
      [drafted({ catalogEntryId: null, unitPrice: 4.4, priceBasis: "GENERAL_KNOWLEDGE" })],
      [],
    );
    expect(row.unitPrice).toBe("4.4");
    expect(row.priceBasis).toBe("GENERAL_KNOWLEDGE");
    expect(row.sourceCatalogEntryId).toBeNull();
    expect(row.description).toBe("Hang and finish 5/8 Type X");
  });

  it("keeps a past-bid price labelled as one", async () => {
    const [row] = await write(
      [drafted({ catalogEntryId: null, unitPrice: 5.1, priceBasis: "HISTORICAL_BID" })],
      [],
    );
    expect(row.priceBasis).toBe("HISTORICAL_BID");
  });

  it("says nothing about a basis when it has no price to have a basis for", async () => {
    const [row] = await write([drafted({ catalogEntryId: null, unitPrice: null, priceBasis: null })], []);
    expect(row.unitPrice).toBeNull();
    expect(row.priceBasis).toBeNull();
    expect(row.aiDrafted).toBe(true);
  });

  it("decides each line on its own, not on the first one", async () => {
    const rows = await write(
      [
        drafted({ description: "A", catalogEntryId: "cat-1", unitPrice: 9.99, priceBasis: "GENERAL_KNOWLEDGE" }),
        drafted({ description: "B", catalogEntryId: null, unitPrice: 7, priceBasis: "GENERAL_KNOWLEDGE" }),
        drafted({ description: "C", catalogEntryId: null, unitPrice: null, priceBasis: null }),
      ],
      [entry({ defaultUnitPrice: 3.25 })],
    );
    expect(rows.map((r) => r.priceBasis)).toEqual(["COMPANY_CATALOG", "GENERAL_KNOWLEDGE", null]);
    expect(rows.map((r) => r.unitPrice)).toEqual(["3.25", "7", null]);
  });
});

describe("draftLinesFromScope — what it is allowed to price from", () => {
  it("grounds the draft in this company's own catalog and only its WON bids", async () => {
    await write([drafted()], [entry()]);
    expect(fake.prisma.lineItemCatalogEntry.findMany.mock.calls[0][0]).toMatchObject({
      where: { companyId: "co-1" },
    });
    expect(fake.prisma.bidInvitation.findMany.mock.calls[0][0]).toMatchObject({
      where: { companyId: "co-1", status: "WON", bidAmount: { not: null } },
    });
  });

  it("drafts from an empty catalog rather than refusing, with nothing to claim as a catalog price", async () => {
    const [row] = await write([drafted({ unitPrice: 4.4, priceBasis: "GENERAL_KNOWLEDGE" })], []);
    expect(row.priceBasis).toBe("GENERAL_KNOWLEDGE");
    const prompt = fake.draft.mock.calls[0][1] as { catalogEntries: unknown[]; wonBids: unknown[] };
    expect(prompt.catalogEntries).toEqual([]);
    expect(prompt.wonBids).toEqual([]);
  });
});

describe("draftLinesFromScope — the refusals, as sentences", () => {
  it("refuses a job that is past the estimate stage in the form's own words", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "CONTRACTED" });
    const result = await draftLinesFromScope("co-1", { jobId: "job-1", scopeText: "anything" });
    expect(result).toEqual({ ok: false, error: NOT_ESTIMATE_STAGE });
    expect(fake.prisma.jobLineItem.createMany).not.toHaveBeenCalled();
  });

  it("hands back the drafter's own sentence when it could not draft anything, and writes nothing", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findMany.mockResolvedValue([]);
    fake.prisma.bidInvitation.findMany.mockResolvedValue([]);
    fake.draft.mockRejectedValue(new Error("Claude couldn't draft any line items from that scope text"));
    const result = await draftLinesFromScope("co-1", { jobId: "job-1", scopeText: "asdfgh" });
    expect(result).toEqual({ ok: false, error: "Claude couldn't draft any line items from that scope text" });
    expect(fake.prisma.jobLineItem.createMany).not.toHaveBeenCalled();
  });
});
