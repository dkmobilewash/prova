import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a catalog entry's `defaultLaborHours` MEANS, pinned at two quantities.
 *
 * `addCatalogLine` copies the entry's hours onto the new line flat while
 * `unitPrice` and `budgetedUnitCost` are per-unit figures the job page
 * multiplies out. Nothing in the app said so: the field was labelled "Default
 * labor hrs", the catalog row rendered a bare "8 hrs" next to "$2.85/unit", and
 * an estimator reading both could not tell that one scales with quantity and
 * the other does not. A wrong labor burden is a wrong bid.
 *
 * The two assertions that matter are the SAME NUMBER at quantity 1 and at
 * quantity 100, asserted explicitly rather than inferred from one case — a
 * single-quantity test cannot tell flat from per-unit at all, which is how this
 * went unnoticed. Each is paired with `unitPrice`, which is genuinely per-unit
 * and also unchanged by the copy, so the contrast is visible in the file: the
 * difference between the two fields is not in this function, it is in what the
 * job page later does with each.
 *
 * This pins the CURRENT behaviour. It is deliberately not an endorsement —
 * `importCatalogEntries` writes a per-unit productivity factor into the same
 * column, so the two writers disagree. See
 * changelog.d/cyrus-catalog-labor-hours-meaning.md. If someone decides hours
 * should scale, this test is the thing they must change on purpose, which is
 * the whole point of it existing.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findFirst: vi.fn() },
    lineItemCatalogEntry: { findFirst: vi.fn() },
    jobLineItem: { create: vi.fn() },
  },
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { addCatalogLine } = await import("./catalog-line");

/** The entry an estimator would actually build: priced per SF, 8 hours typed
 *  into the labor field. Prisma hands Decimal columns back as Decimal objects;
 *  a number stands in for one here because this function only ever passes the
 *  value straight through — it never does arithmetic on it, which is precisely
 *  the fact under test. */
const entry = {
  id: "cat-1",
  companyId: "co-1",
  description: '5/8" Type X, hung and finished',
  unit: "SF",
  defaultUnitPrice: 2.85,
  defaultBudgetedUnitCost: 1.9,
  defaultLaborHours: 8,
  craftClassificationId: "craft-1",
  tradeScope: "METAL_FRAMING_DRYWALL",
};

/** The `data` object `addCatalogLine` asked Prisma to write. */
async function createdLineFor(quantity: string) {
  fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
  fake.prisma.lineItemCatalogEntry.findFirst.mockResolvedValue(entry);
  fake.prisma.jobLineItem.create.mockResolvedValue({ id: "li-1" });

  const result = await addCatalogLine("co-1", {
    jobId: "job-1",
    catalogEntryId: "cat-1",
    quantity,
  });
  expect(result.ok).toBe(true);

  const call = fake.prisma.jobLineItem.create.mock.calls.at(-1) as
    | [{ data: Record<string, unknown> }]
    | undefined;
  if (!call) throw new Error("no line item was created");
  return call[0].data;
}

beforeEach(() => {
  fake.prisma.job.findFirst.mockReset();
  fake.prisma.lineItemCatalogEntry.findFirst.mockReset();
  fake.prisma.jobLineItem.create.mockReset();
});

describe("addCatalogLine — catalog labor hours are FLAT per line", () => {
  it("writes the entry's own hours at quantity 1", async () => {
    const data = await createdLineFor("1");
    expect(data.quantity).toBe("1");
    expect(data.laborHours).toBe(8);
    expect(data.unitPrice).toBe(2.85);
  });

  it("writes the SAME hours at quantity 100 — not 800", async () => {
    const data = await createdLineFor("100");
    expect(data.quantity).toBe("100");
    expect(data.laborHours).toBe(8);
    expect(data.laborHours).not.toBe(800);
    // Unchanged for the same reason and with the opposite meaning: this one is
    // a rate the job page multiplies by 100 later, and the hours are not.
    expect(data.unitPrice).toBe(2.85);
  });

  it("is the same number at both quantities, which is the whole claim", async () => {
    const one = await createdLineFor("1");
    const hundred = await createdLineFor("100");
    expect(hundred.laborHours).toBe(one.laborHours);
  });

  it("leaves hours null when the entry has none, rather than inventing a zero", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findFirst.mockResolvedValue({
      ...entry,
      defaultLaborHours: null,
      craftClassificationId: null,
    });
    fake.prisma.jobLineItem.create.mockResolvedValue({ id: "li-1" });

    await addCatalogLine("co-1", { jobId: "job-1", catalogEntryId: "cat-1", quantity: "600" });
    const call = fake.prisma.jobLineItem.create.mock.calls.at(-1) as [
      { data: Record<string, unknown> },
    ];
    expect(call[0].data.laborHours).toBeNull();
    // A zero would price as "no labor" rather than "labor not estimated", and
    // estimateBurdenedLaborCost treats <= 0 as no number at all.
    expect(call[0].data.laborHours).not.toBe(0);
  });
});
