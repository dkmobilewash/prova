import { beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, prisma } from "@prova/db";
import { legendProposalFrom } from "@/lib/takeoff/legendProposalBuild";
import { unpricedMaterials } from "@/lib/estimating/materialKey";

// A confirmed wall type turns into priced material lines without typing: the legend's assembly made
// complete (screws, tape, compound), the board priced from the company's own catalog, the rest listed
// once to price, and a height change moving the quantities.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { setWallGroupType } = await import("./wallGroupType");
const { setWallGroupHeight } = await import("./takeoffItems");
const { priceMaterial, saveAssemblyStandards } = await import("./assemblyStandards");
const { wallItemsForSheet } = await import("@/lib/plan-ingest/wallItems");

let companyId = "";
let jobId = "";
let planId = "";
let boardEntry = "";
const runs = [{ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1 }];
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const lines = () => prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Auto Estimate Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `auto_${Date.now()}`, email: `auto_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Auto Job", status: "ESTIMATE" } })).id;
  await prisma.companyBidDefaults.create({
    data: { companyId, materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "0", profitPercent: "0", assemblyStandards: { wastePercent: { board: 15 } } },
  });
  boardEntry = (await prisma.lineItemCatalogEntry.create({ data: { companyId, description: '5/8" Type X Gypsum Board 4x8', unit: "sheet", defaultUnitPrice: "18.50", defaultBudgetedUnitCost: "15.00", costCategory: "MATERIAL" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  const run = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 9 } });
  const read = { types: [{ code: "W1", name: "Partition W1", lines: ['3 5/8" METAL STUDS @ 16" O.C.', '(1) LAYER 5/8" TYPE X GYP. BD. EACH SIDE'] }], uno: [], reason: "r", confidence: "HIGH" as const };
  await prisma.planLegendProposal.create({ data: { ingestJobId: run.id, planId, pageNumber: 9, ...legendProposalFrom({ pageNumber: 9, sheetTitle: null, model: "m", read, crops: [] }) } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffWallProposal.create({ data: { pageId: page.id, calibrationId: cal.id, thicknessInches: 5, source: "REMAINDER", runs: runs.map((r) => ({ ...r, thicknessFeet: 5 / 12 })) } });
  await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null });
});

describe("the automatic estimate", () => {
  it("a confirmed type becomes its full material list, the board priced from the company's catalog and nothing else priced", async () => {
    expect(await setWallGroupType(jobId, { planId, pageNumber: 1, code: "W1", inches: 5, runs })).toEqual({ ok: true });
    const type = await prisma.wallType.findFirstOrThrow({ where: { companyId, code: "W1" }, include: { components: true } });
    const parts = type.components.map((c) => c.description);
    expect(parts.some((d) => /screws/.test(d))).toBe(true);
    expect(parts.some((d) => /joint tape/.test(d))).toBe(true);
    expect(parts.some((d) => /joint compound/.test(d))).toBe(true);
    const board = type.components.find((c) => /gypsum board/.test(c.description))!;
    expect(board.unit).toBe("SHT");
    expect(Number(board.wastePercent)).toBe(15); // the company's stored standard, not the default 10
    expect(board.catalogEntryId).toBe(boardEntry);
    expect(type.notes).toMatch(/Corner bead/);

    // The legend gives no height, so board waits for one: the one thing a person types.
    expect((await lines()).some((l) => /gypsum board/.test(l.description))).toBe(false);
    const item = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, wallType: { code: "W1" } } });
    expect((await setWallGroupHeight(jobId, item.id, 10)).ok).toBe(true);
    const all = await lines();
    const boardLine = all.find((l) => /gypsum board/.test(l.description))!;
    expect(boardLine.unitPrice?.toString()).toBe("18.5");
    expect(boardLine.priceBasis).toBe("COMPANY_CATALOG");
    // Every other material is unpriced — no price is invented for anything the catalog lacks.
    expect(all.filter((l) => l.id !== boardLine.id).every((l) => l.unitPrice === null && l.sourceCatalogEntryId === null)).toBe(true);
  });

  it("lists each unpriced material once, and one cost prices its lines through the markup and teaches the part", async () => {
    const all = await lines();
    const rows = unpricedMaterials(all.filter((l) => l.wallTypeComponentId !== null && l.unitPrice === null).map((l) => ({ id: l.id, description: l.description, unit: l.unit, quantity: Number(l.quantity) })));
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(["drywall screws, Type S, per 1,000", "joint tape"]));
    const screws = rows.find((r) => /screws/.test(r.label))!;
    expect(await priceMaterial(jobId, screws.lineIds, form({ unitCost: "30" }))).toEqual({ ok: true });
    const line = (await lines()).find((l) => /screws/.test(l.description))!;
    expect(line.budgetedUnitCost?.toString()).toBe("30");
    expect(Number(line.unitPrice)).toBeCloseTo(33, 2); // 10% material markup, nothing else
    const entry = await prisma.lineItemCatalogEntry.findFirstOrThrow({ where: { companyId, description: "drywall screws, Type S, per 1,000" } });
    expect(entry.defaultBudgetedUnitCost?.toString()).toBe("30");
    const part = await prisma.wallTypeComponent.findFirstOrThrow({ where: { id: line.wallTypeComponentId! } });
    expect(part.catalogEntryId).toBe(entry.id);
  });

  it("refuses a cost for lines of different materials, or with no cost", async () => {
    const all = (await lines()).filter((l) => l.unitPrice === null);
    const tape = all.find((l) => /tape/.test(l.description))!;
    const compound = all.find((l) => /compound/.test(l.description))!;
    expect(await priceMaterial(jobId, [tape.id, compound.id], form({ unitCost: "1" }))).toMatchObject({ ok: false, error: expect.stringMatching(/not all the same material/) });
    expect(await priceMaterial(jobId, [tape.id], form({}))).toMatchObject({ ok: false });
  });

  it("changing the wall's height moves its materials and keeps the prices", async () => {
    const item = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, wallType: { code: "W1" } } });
    const at10 = await lines();
    const before = at10;
    expect((await setWallGroupHeight(jobId, item.id, 12)).ok).toBe(true);
    const at12 = await lines();
    const q = (ls: typeof before, re: RegExp) => Number(ls.find((l) => re.test(l.description))!.quantity);
    expect(q(at12, /gypsum board/)).toBeGreaterThan(q(at10, /gypsum board/));
    expect(q(at12, /screws/)).toBeGreaterThan(q(at10, /screws/));
    expect(q(at12, /compound/)).toBeGreaterThan(q(at10, /compound/));
    expect(at12.find((l) => /gypsum board/.test(l.description))!.unitPrice?.toString()).toBe("18.5");
    expect(at12.map((l) => l.id).sort()).toEqual(before.map((l) => l.id).sort()); // updated in place
  });

  it("a typed takeoff wall gets labor from the company's rates, and its height moves the hours", async () => {
    // W1: 3-5/8in studs @16, one layer 5/8 type X each side. Rates set directly, as the Wall types form stores them.
    await prisma.companyBidDefaults.update({
      where: { companyId },
      data: { productionRates: { framingLfPerHr: 20, boardSfPerHr: { typeX: 50 }, finishSfPerHr: { level4: 45 }, defaultFinishLevel: 4, over10Multiplier: 1.15, crewRatePerHr: 62 } },
    });
    const item = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, wallType: { code: "W1" } } });
    expect((await setWallGroupHeight(jobId, item.id, 10)).ok).toBe(true);
    const at10 = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false, costCategory: "LABOR" } });
    const lf = Number((await lines()).find((l) => /track/.test(l.description))!.quantity) / 2 / 1.05; // track is 2 x LF plus the 5% standard waste
    const framing = at10.find((l) => /^Labor — W1 — framing, studs and track$/.test(l.description))!;
    expect(Number(framing.laborHours)).toBeCloseTo(lf / 20, 2);
    const board10 = Number(at10.find((l) => /W1 — hang type X board$/.test(l.description))!.laborHours);
    expect(board10).toBeCloseTo((lf * 10 * 2) / 50, 1);
    expect((await setWallGroupHeight(jobId, item.id, 12)).ok).toBe(true);
    const at12 = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false, costCategory: "LABOR" } });
    expect(Number(at12.find((l) => /W1 — hang type X board, over 10 ft/.test(l.description))!.laborHours)).toBeCloseTo(((lf * 12 * 2) / 50) * 1.15, 1);
    await prisma.companyBidDefaults.update({ where: { companyId }, data: { productionRates: Prisma.DbNull } });
  });

  it("saves the company's standards, and refuses a spacing nobody frames at", async () => {
    expect(await saveAssemblyStandards(form({ studSpacingIn: "13" }))).toMatchObject({ ok: false });
    expect(await saveAssemblyStandards(form({ studSpacingIn: "24", "waste-studs": "3" }))).toEqual({ ok: true });
    const saved = await prisma.companyBidDefaults.findUniqueOrThrow({ where: { companyId } });
    expect(saved.assemblyStandards).toMatchObject({ studSpacingIn: 24, wastePercent: { studs: 3 } });
  });
});
