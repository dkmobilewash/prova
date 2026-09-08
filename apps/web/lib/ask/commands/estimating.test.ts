import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The estimating commands against a fake Prisma that records every call.
 *
 * What is pinned here is what a person would be hurt by if it drifted:
 * that a missing name is a QUESTION and not a guess, that two Turners are
 * a chip row and not a pick, that a job which already exists is a link and
 * not a twin, that a chip carrying a foreign contact id is refused, and —
 * on execute — the exact rows written, asserted as the exact `create`
 * arguments rather than "something was created".
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
      lineItemCatalogEntry: { findMany: fn(), findFirst: fn() },
      jobLineItem: { createMany: fn(), create: fn() },
      bidInvitation: { findMany: fn() },
    },
    draft: vi.fn(),
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@prova/integrations", () => ({ draftEstimateLineItems: fake.draft }));

const { createEstimateJobCommand, draftEstimateLinesCommand, addCatalogLineCommand } = await import("./estimating");

const ctx = {
  companyId: "co-1",
  userId: "u-1",
  principal: { role: "OWNER", jobFunction: null },
  today: "2026-09-08",
};

const turner = (id: string, email: string | null, jobs: number) => ({
  id,
  name: "Turner Construction",
  email,
  _count: { jobs },
});

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) {
    if (typeof model === "object") for (const method of Object.values(model)) (method as ReturnType<typeof vi.fn>).mockReset();
  }
  for (const model of Object.values(fake.tx)) for (const method of Object.values(model)) method.mockReset();
  fake.draft.mockReset();
  fake.prisma.$transaction.mockReset();
  fake.prisma.$transaction.mockImplementation(async (run: (t: typeof fake.tx) => Promise<unknown>) => run(fake.tx));
});

describe("create_estimate_job.resolve", () => {
  it("asks for what the person never said, and reads nothing", async () => {
    const result = await createEstimateJobCommand.resolve(ctx, { scope: "commercial project" });
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    expect(result.missing).toContain("the job's name");
    expect(result.missing).toContain("which GC");
    expect(fake.prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("offers chips when the GC name matches two different contacts", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([
      turner("t1", "estimating@turner.com", 3),
      turner("t2", "pm@turner.com", 1),
    ]);
    const result = await createEstimateJobCommand.resolve(ctx, { jobName: "Riverside Plaza", gcName: "Turner Construction" });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("contactId");
    expect(result.options.map((o) => o.value)).toEqual(["t1", "t2"]);
    expect(result.options[0].detail).toContain("estimating@turner.com");
  });

  it("is ready with the contact on file when exactly one matches, and says the job will be drafted", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner("t1", "gc@turner.com", 3)]);
    fake.prisma.job.findFirst.mockResolvedValue(null);
    const result = await createEstimateJobCommand.resolve(ctx, {
      jobName: "Riverside Plaza",
      gcName: "Turner Construction",
      scope: "commercial TI, drywall and ceilings",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      jobName: "Riverside Plaza",
      scope: "commercial TI, drywall and ceilings",
      contact: { id: "t1", name: "Turner Construction" },
      draftLines: true,
    });
    expect(result.preview.find((l) => l.label === "GC")?.value).toBe("Turner Construction (on file, 3 jobs)");
    expect(result.preview.find((l) => l.label === "Line items")?.value).toMatch(/flagged for your review/);
    expect(result.existing).toBeUndefined();
    // The natural-key check was made against THIS contact and THIS company.
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({
      where: { companyId: "co-1", contactId: "t1", name: { equals: "Riverside Plaza", mode: "insensitive" } },
      select: { id: true, name: true },
    });
  });

  it("links to the job that already exists instead of proposing a twin", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner("t1", "gc@turner.com", 3)]);
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-9", name: "Riverside Plaza" });
    const result = await createEstimateJobCommand.resolve(ctx, { jobName: "riverside plaza", gcName: "Turner" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.existing).toEqual({
      label: "Riverside Plaza for Turner Construction already exists",
      href: "/jobs/job-9",
    });
  });

  it("proposes a new contact when nothing matches, carrying the email if given", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([]);
    const result = await createEstimateJobCommand.resolve(ctx, {
      jobName: "Oak Street TI",
      gcName: "Acme Builders",
      gcEmail: "bids@acme.com",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.contact).toEqual({ name: "Acme Builders", email: "bids@acme.com" });
    expect(result.preview.find((l) => l.label === "GC")?.value).toBe("Acme Builders (new contact, bids@acme.com)");
    expect(result.preview.find((l) => l.label === "Line items")?.value).toMatch(/None yet/);
    expect(fake.prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a chip that names a contact outside this company", async () => {
    fake.prisma.contact.findFirst.mockResolvedValue(null);
    const result = await createEstimateJobCommand.resolve(ctx, { jobName: "X", contactId: "someone-elses" });
    expect(result.kind).toBe("refuse");
    expect(fake.prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "someone-elses", companyId: "co-1" },
      select: { id: true, name: true, _count: { select: { jobs: true } } },
    });
  });
});

describe("create_estimate_job.execute", () => {
  it("creates the contact and the job in one transaction with exactly these rows, then drafts lines", async () => {
    fake.tx.contact.create.mockResolvedValue({ id: "t-new" });
    fake.tx.job.create.mockResolvedValue({ id: "job-1" });
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findMany.mockResolvedValue([]);
    fake.prisma.bidInvitation.findMany.mockResolvedValue([]);
    fake.draft.mockResolvedValue([
      { description: "Hang 5/8 Type X", quantity: 200, unit: "SF", unitPrice: null, tradeScope: null, catalogEntryId: null, priceBasis: "GENERAL_KNOWLEDGE" },
    ]);
    fake.prisma.jobLineItem.createMany.mockResolvedValue({ count: 1 });

    const result = await createEstimateJobCommand.execute(ctx, {
      jobName: "Oak Street TI",
      scope: "commercial TI drywall",
      contact: { name: "Acme Builders", email: "bids@acme.com" },
      draftLines: true,
    });

    expect(fake.tx.contact.create).toHaveBeenCalledWith({
      data: { companyId: "co-1", name: "Acme Builders", email: "bids@acme.com" },
      select: { id: true },
    });
    expect(fake.tx.job.create).toHaveBeenCalledWith({
      data: { companyId: "co-1", contactId: "t-new", name: "Oak Street TI", scope: "commercial TI drywall" },
      select: { id: true },
    });
    const drafted = fake.prisma.jobLineItem.createMany.mock.calls[0][0] as { data: { jobId: string; aiDrafted: boolean }[] };
    expect(drafted.data[0].jobId).toBe("job-1");
    expect(drafted.data[0].aiDrafted).toBe(true);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.created).toEqual({ label: "Oak Street TI", href: "/jobs/job-1", targetType: "Job", targetId: "job-1" });
    expect(result.message).toBe(
      "Created Oak Street TI and added Acme Builders as a contact. Drafted 1 line item from the scope, flagged for review.",
    );
  });

  it("reports the existing job when the transaction finds one, and writes nothing", async () => {
    fake.tx.contact.findFirst.mockResolvedValue({ id: "t1" });
    fake.tx.job.findFirst.mockResolvedValue({ id: "job-9" });
    const result = await createEstimateJobCommand.execute(ctx, {
      jobName: "Riverside Plaza",
      scope: null,
      contact: { id: "t1", name: "Turner Construction" },
      draftLines: false,
    });
    expect(fake.tx.job.create).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.message).toContain("already exists");
    expect(result.created?.href).toBe("/jobs/job-9");
  });

  it("still reports the job created when drafting fails, and says how to draft by hand", async () => {
    fake.tx.contact.findFirst.mockResolvedValue({ id: "t1" });
    fake.tx.job.findFirst.mockResolvedValue(null);
    fake.tx.job.create.mockResolvedValue({ id: "job-2" });
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-2", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findMany.mockResolvedValue([]);
    fake.prisma.bidInvitation.findMany.mockResolvedValue([]);
    fake.draft.mockRejectedValue(new Error("Claude returned no line items"));

    const result = await createEstimateJobCommand.execute(ctx, {
      jobName: "Maple",
      scope: "something",
      contact: { id: "t1", name: "Turner Construction" },
      draftLines: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.message).toContain("Created Maple for Turner Construction.");
    expect(result.message).toContain("Claude returned no line items");
    expect(result.message).toContain("Draft line items");
    expect(fake.prisma.jobLineItem.createMany).not.toHaveBeenCalled();
  });

  it("refuses a payload that is not the shape resolve produced", async () => {
    const result = await createEstimateJobCommand.execute(ctx, { jobName: "X" });
    expect(result.ok).toBe(false);
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("draft_estimate_lines.resolve", () => {
  it("refuses when the job already has drafted lines rather than drafting a second set", async () => {
    fake.prisma.job.findMany.mockResolvedValue([{ id: "job-1", name: "Riverside", status: "ESTIMATE", contact: { name: "Turner" } }]);
    fake.prisma.job.findFirst.mockResolvedValue({ scope: "scope", lineItems: [{ id: "li-1" }] });
    const result = await draftEstimateLinesCommand.resolve(ctx, { jobName: "Riverside" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toContain("already has drafted line items");
    expect(result.href).toBe("/jobs/job-1");
  });

  it("uses the scope on the job when none is given now, and asks when there is neither", async () => {
    fake.prisma.job.findMany.mockResolvedValue([{ id: "job-1", name: "Riverside", status: "ESTIMATE", contact: { name: "Turner" } }]);
    fake.prisma.job.findFirst.mockResolvedValue({ scope: "recorded scope", lineItems: [] });
    const ready = await draftEstimateLinesCommand.resolve(ctx, { jobName: "Riverside" });
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") throw new Error("unreachable");
    expect(ready.resolved.scopeText).toBe("recorded scope");

    fake.prisma.job.findFirst.mockResolvedValue({ scope: null, lineItems: [] });
    const need = await draftEstimateLinesCommand.resolve(ctx, { jobName: "Riverside" });
    expect(need.kind).toBe("need");
  });

  it("only considers estimate-stage jobs", async () => {
    fake.prisma.job.findMany.mockResolvedValue([]);
    const result = await draftEstimateLinesCommand.resolve(ctx, { jobName: "Contracted Job" });
    expect(result.kind).toBe("refuse");
    expect(fake.prisma.job.findMany.mock.calls[0][0]).toMatchObject({ where: { companyId: "co-1", status: "ESTIMATE" } });
  });
});

describe("add_catalog_line", () => {
  it("shows the catalog price, never a total, and adds the line at that price", async () => {
    fake.prisma.job.findMany.mockResolvedValue([{ id: "job-1", name: "Riverside", status: "ESTIMATE", contact: { name: "Turner" } }]);
    fake.prisma.lineItemCatalogEntry.findMany.mockResolvedValue([
      { id: "cat-1", description: "5/8 Type X, hung and finished", unit: "SF", defaultUnitPrice: 3.25 },
    ]);
    const ready = await addCatalogLineCommand.resolve(ctx, { jobName: "Riverside", item: "5/8 Type X", quantity: "200" });
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") throw new Error("unreachable");
    expect(ready.preview.map((l) => l.value)).toEqual(["Riverside", "5/8 Type X, hung and finished", "$3.25 per SF", "200 SF"]);
    expect(JSON.stringify(ready.preview)).not.toContain("650");

    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findFirst.mockResolvedValue({
      id: "cat-1",
      companyId: "co-1",
      description: "5/8 Type X, hung and finished",
      unit: "SF",
      defaultUnitPrice: 3.25,
      defaultBudgetedUnitCost: 2,
      defaultLaborHours: null,
      craftClassificationId: null,
      tradeScope: "METAL_FRAMING_DRYWALL",
    });
    fake.prisma.jobLineItem.create.mockResolvedValue({ id: "li-1" });
    const done = await addCatalogLineCommand.execute(ctx, ready.resolved);
    expect(done.ok).toBe(true);
    const args = fake.prisma.jobLineItem.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({
      jobId: "job-1",
      description: "5/8 Type X, hung and finished",
      quantity: "200",
      unitPrice: 3.25,
      sourceCatalogEntryId: "cat-1",
      priceBasis: "COMPANY_CATALOG",
    });
  });

  it("refuses with a link to the catalog when nothing matches, and asks for a real quantity", async () => {
    fake.prisma.job.findMany.mockResolvedValue([{ id: "job-1", name: "Riverside", status: "ESTIMATE", contact: { name: "Turner" } }]);
    fake.prisma.lineItemCatalogEntry.findMany.mockResolvedValue([]);
    const none = await addCatalogLineCommand.resolve(ctx, { jobName: "Riverside", item: "unobtainium", quantity: "1" });
    expect(none.kind).toBe("refuse");
    if (none.kind !== "refuse") throw new Error("unreachable");
    expect(none.href).toBe("/catalog");

    const bad = await addCatalogLineCommand.resolve(ctx, { jobName: "Riverside", item: "board", quantity: "lots" });
    expect(bad.kind).toBe("need");
  });
});
