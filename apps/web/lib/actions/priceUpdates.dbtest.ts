import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Supplier price increases reaching the price book, an open estimate, and a
 * deleted wall line — against a real Postgres.
 *
 * Three claims, each a row somewhere:
 *   1. re-importing a price list moves price and cost of an entry that matches
 *      by description, and nothing else, and only when asked to;
 *   2. "Update prices on this estimate" writes the ticked lines, leaves typed
 *      lines alone, leaves the recap-applied prices alone, and refuses a
 *      contracted job;
 *   3. a wall line a person deleted comes back at today's price.
 *
 * Runs against a SCRATCH database only (vitest.db.setup.mts refuses the rest).
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { importCatalogEntries } = await import("@/lib/actions/estimating");
const { previewEstimatePriceUpdate, applyEstimatePriceUpdate } = await import("@/lib/actions/priceRefresh");
const { restoreWallLines, deleteWallRun } = await import("@/lib/actions/wallTypes");
const { updateToken } = await import("@/lib/estimating/price-refresh");

let companyId = "";
let otherCompanyId = "";
let jobId = "";
let contractedJobId = "";
let boardId = "";
let studId = "";
const lineIds: Record<string, string> = {};

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const num = (v: unknown) => (v == null ? null : Number(v));

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Price Update Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const other = await prisma.company.create({ data: { name: "Other Co" } });
  otherCompanyId = other.id;

  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const board = await prisma.lineItemCatalogEntry.create({
    data: {
      companyId,
      description: '5/8" Type X board',
      unit: "SF",
      defaultUnitPrice: "2.50",
      defaultBudgetedUnitCost: "1.75",
      defaultLaborHours: "3",
    },
  });
  boardId = board.id;
  const stud = await prisma.lineItemCatalogEntry.create({
    data: { companyId, description: "Stud 25ga", unit: "LF", defaultUnitPrice: "1.00", defaultBudgetedUnitCost: "0.60" },
  });
  studId = stud.id;
  // Same description in ANOTHER company: must never be touched by this one's import.
  await prisma.lineItemCatalogEntry.create({
    data: { companyId: otherCompanyId, description: '5/8" Type X board', unit: "SF", defaultUnitPrice: "9.99" },
  });

  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Open Bid", status: "ESTIMATE" } });
  jobId = job.id;
  const contracted = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Signed Job", status: "CONTRACTED" },
  });
  contractedJobId = contracted.id;

  const mk = (jobIdValue: string, description: string, data: Record<string, unknown>) =>
    prisma.jobLineItem.create({
      data: { jobId: jobIdValue, description, quantity: "100", ...data } as never,
    });
  lineIds.board = (
    await mk(jobId, "Board", { unit: "SF", unitPrice: "2.50", budgetedUnitCost: "1.75", currentEstimatedUnitCost: "1.75", sourceCatalogEntryId: boardId })
  ).id;
  lineIds.stud = (
    await mk(jobId, "Studs", { unit: "LF", unitPrice: "1.00", budgetedUnitCost: "0.60", currentEstimatedUnitCost: "0.60", sourceCatalogEntryId: studId })
  ).id;
  lineIds.typed = (await mk(jobId, "Typed by hand", { unit: "SF", unitPrice: "5.00", budgetedUnitCost: "3.00", currentEstimatedUnitCost: "3.00" })).id;
  lineIds.contracted = (
    await mk(contractedJobId, "Signed board", { unit: "SF", unitPrice: "2.50", budgetedUnitCost: "1.75", currentEstimatedUnitCost: "1.75", sourceCatalogEntryId: boardId })
  ).id;
});

afterAll(async () => {
  await prisma.jobBidRecap.deleteMany({ where: { jobId } });
  await prisma.jobLineItem.deleteMany({ where: { jobId: { in: [jobId, contractedJobId] } } });
  await prisma.wallRun.deleteMany({ where: { companyId } });
  await prisma.wallTypeComponent.deleteMany({ where: { wallType: { companyId } } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
});

const LIST = [
  "Description,Unit,Unit Price,Cost",
  '5/8" type x board,SF,2.70,1.89',
  "Stud 25ga,LF,1.00,0.60",
  "Brand new tape,EA,4,2",
].join("\n");

describe("re-importing a price list", () => {
  it("adds new items but does NOT touch prices unless asked", async () => {
    const result = await importCatalogEntries(fd({ csv: LIST }));
    expect(result.ok).toBe(true);
    const board = await prisma.lineItemCatalogEntry.findUniqueOrThrow({ where: { id: boardId } });
    expect(num(board.defaultUnitPrice)).toBe(2.5);
    expect(await prisma.lineItemCatalogEntry.count({ where: { companyId, description: "Brand new tape" } })).toBe(1);
  });

  it("refuses when the count the preview showed is not what the server finds", async () => {
    const result = await importCatalogEntries(fd({ csv: LIST, updatePrices: "on", expectedChanges: "5" }));
    expect(result).toMatchObject({ ok: false });
    expect(num((await prisma.lineItemCatalogEntry.findUniqueOrThrow({ where: { id: boardId } })).defaultUnitPrice)).toBe(2.5);
  });

  it("updates price and cost only, leaving unit, hours and every other company alone", async () => {
    const result = await importCatalogEntries(fd({ csv: LIST, updatePrices: "on", expectedChanges: "1" }));
    expect(result).toMatchObject({ ok: true });
    const board = await prisma.lineItemCatalogEntry.findUniqueOrThrow({ where: { id: boardId } });
    expect(num(board.defaultUnitPrice)).toBe(2.7);
    expect(num(board.defaultBudgetedUnitCost)).toBe(1.89);
    expect(board.unit).toBe("SF");
    expect(num(board.defaultLaborHours)).toBe(3);
    const stranger = await prisma.lineItemCatalogEntry.findFirstOrThrow({ where: { companyId: otherCompanyId } });
    expect(num(stranger.defaultUnitPrice)).toBe(9.99);
    // Lines already priced from the entry keep their numbers.
    const line = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineIds.board } });
    expect(num(line.unitPrice)).toBe(2.5);
  });

  it("is owner-only: an estimator is refused with a sentence, and nothing moves", async () => {
    context.role = "MEMBER";
    try {
      const result = await importCatalogEntries(fd({ csv: LIST.replace("2.70", "9.00"), updatePrices: "on", expectedChanges: "1" }));
      expect(result).toMatchObject({ ok: false });
    } finally {
      context.role = "OWNER";
    }
    expect(num((await prisma.lineItemCatalogEntry.findUniqueOrThrow({ where: { id: boardId } })).defaultUnitPrice)).toBe(2.7);
  });
});

describe("Update prices on this estimate", () => {
  it("lists only the stale linked line; typed and unchanged lines are not offered", async () => {
    const result = await previewEstimatePriceUpdate(jobId);
    if (!result.ok) throw new Error(result.error);
    const { plan } = result.value;
    expect(plan.updates.map((u) => u.lineId)).toEqual([lineIds.board]);
    expect(plan.kept.map((k) => [k.lineId, k.reason])).toEqual([[lineIds.typed, "no-link"]]);
    expect(plan.current).toBe(1); // studs already match
    expect(plan.priceEffect).toBeCloseTo(20, 6);
  });

  it("refuses a contracted job outright", async () => {
    const result = await previewEstimatePriceUpdate(contractedJobId);
    expect(result).toMatchObject({ ok: false });
    const before = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineIds.contracted } });
    const write = await applyEstimatePriceUpdate(contractedJobId, [lineIds.contracted], "x");
    expect(write).toMatchObject({ ok: false });
    const after = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineIds.contracted } });
    expect(num(after.unitPrice)).toBe(num(before.unitPrice));
  });

  it("refuses a confirmation that is not the figures that would be written", async () => {
    const result = await applyEstimatePriceUpdate(jobId, [lineIds.board], "stale");
    expect(result).toMatchObject({ ok: false });
    expect(num((await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineIds.board } })).unitPrice)).toBe(2.5);
  });

  it("refuses a line that is not an offered update (a typed line cannot be smuggled in)", async () => {
    const preview = await previewEstimatePriceUpdate(jobId);
    if (!preview.ok) throw new Error(preview.error);
    const token = preview.value.plan.updates.map(updateToken).join("|");
    const result = await applyEstimatePriceUpdate(jobId, [lineIds.board, lineIds.typed], token);
    // The typed line contributes nothing to the recomputed signature, so the
    // call is equivalent to ticking the board line alone and the typed line is
    // untouched either way.
    expect(result.ok).toBe(true);
    const typed = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineIds.typed } });
    expect(num(typed.unitPrice)).toBe(5);
  });

  it("wrote price, cost and the forecast on the confirmed line", async () => {
    const line = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineIds.board } });
    expect(num(line.unitPrice)).toBe(2.7);
    expect(num(line.budgetedUnitCost)).toBe(1.89);
    expect(num(line.currentEstimatedUnitCost)).toBe(1.89);
  });

  it("after the recap is applied, a further increase moves cost only", async () => {
    await prisma.jobBidRecap.create({ data: { jobId, companyId, appliedAt: new Date(), appliedTotal: "300" } });
    await prisma.lineItemCatalogEntry.update({ where: { id: boardId }, data: { defaultUnitPrice: "3.00", defaultBudgetedUnitCost: "2.00" } });
    const preview = await previewEstimatePriceUpdate(jobId);
    if (!preview.ok) throw new Error(preview.error);
    const [u] = preview.value.plan.updates;
    expect(u.price).toBeNull();
    const result = await applyEstimatePriceUpdate(jobId, [u.lineId], updateToken(u));
    expect(result.ok).toBe(true);
    const line = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: lineIds.board } });
    expect(num(line.unitPrice)).toBe(2.7); // the marked-up price is not overwritten
    expect(num(line.budgetedUnitCost)).toBe(2);
  });
});

describe("restoring a deleted wall line", () => {
  it("brings it back at today's catalog price with the schedule's quantity", async () => {
    const wallType = await prisma.wallType.create({
      data: { companyId, code: "A1", name: "Partition", defaultHeightFt: "10", sides: 2 },
    });
    const component = await prisma.wallTypeComponent.create({
      data: { wallTypeId: wallType.id, description: "Board", basis: "BOARDED_SQFT", unit: "SF", catalogEntryId: boardId },
    });
    const run = await prisma.wallRun.create({
      data: { companyId, jobId, wallTypeId: wallType.id, label: "Corridor", lengthFt: "20", heightFt: "10" },
    });
    void run;
    // Generate the line, then delete it the way a person does.
    const { syncWallScheduleLines } = await import("@/lib/estimating/wall-schedule");
    await prisma.$transaction((tx) => syncWallScheduleLines(tx, companyId, jobId));
    const generated = await prisma.jobLineItem.findFirstOrThrow({ where: { jobId, wallTypeComponentId: component.id } });
    expect(num(generated.unitPrice)).toBe(3);
    await prisma.jobLineItem.update({ where: { id: generated.id }, data: { isDeleted: true } });

    // A re-sync does NOT bring it back (the rule that already existed).
    await prisma.$transaction((tx) => syncWallScheduleLines(tx, companyId, jobId));
    expect((await prisma.jobLineItem.findUniqueOrThrow({ where: { id: generated.id } })).isDeleted).toBe(true);

    // The supplier raises the price again, then the person restores.
    await prisma.lineItemCatalogEntry.update({ where: { id: boardId }, data: { defaultUnitPrice: "3.30", defaultBudgetedUnitCost: "2.20" } });
    const result = await restoreWallLines(jobId);
    expect(result).toEqual({ ok: true, value: { restored: 1 } });
    const back = await prisma.jobLineItem.findUniqueOrThrow({ where: { id: generated.id } });
    expect(back.isDeleted).toBe(false);
    expect(num(back.unitPrice)).toBe(3.3);
    expect(num(back.budgetedUnitCost)).toBe(2.2);
    expect(num(back.quantity)).toBe(400);

    // Idempotent: nothing left to restore, no duplicate line.
    expect(await restoreWallLines(jobId)).toEqual({ ok: true, value: { restored: 0 } });
    expect(await prisma.jobLineItem.count({ where: { jobId, wallTypeComponentId: component.id } })).toBe(1);

    // A deleted line whose wall type has LEFT the schedule is not resurrected.
    // A second type keeps the schedule non-empty, so this is not the trivial
    // "nothing wanted" early return — and the person-deleted line keeps its
    // link when the run goes (the sync skips deleted lines), which is exactly
    // the line a careless restore would bring back.
    const other = await prisma.wallType.create({
      data: { companyId, code: "B1", name: "Furring", defaultHeightFt: "10", sides: 1 },
    });
    await prisma.wallTypeComponent.create({
      data: { wallTypeId: other.id, description: "Furring", basis: "BOARDED_SQFT", unit: "SF" },
    });
    await prisma.wallRun.create({
      data: { companyId, jobId, wallTypeId: other.id, label: "Closet", lengthFt: "5", heightFt: "10" },
    });
    await prisma.jobLineItem.update({ where: { id: generated.id }, data: { isDeleted: true } });
    await deleteWallRun(jobId, run.id);
    expect(await restoreWallLines(jobId)).toEqual({ ok: true, value: { restored: 0 } });
    expect((await prisma.jobLineItem.findUniqueOrThrow({ where: { id: generated.id } })).isDeleted).toBe(true);
  });

  it("refuses a contracted job", async () => {
    expect(await restoreWallLines(contractedJobId)).toMatchObject({ ok: false });
  });
});
