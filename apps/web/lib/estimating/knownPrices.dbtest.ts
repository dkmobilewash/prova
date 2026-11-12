import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { STARTER_TYPES } from "@/lib/wall-type-starters";
import { RECAP_RATE_KEYS, unitPriceFromCost, type RecapRates } from "@/lib/bid-recap";
import { syncTakeoffItemLines } from "./takeoff-item-lines";

/**
 * The Totem Lake walk typed four costs into the review queue that the company already held: studs and
 * track on an imported supplier list, board and hang-and-finish in its price book under the part's own
 * words. Nothing linked them: the starter parts write `3⅝″`, which the material reader did not read,
 * and the board part never says "gypsum". Now the takeoff's lines take those prices, through the job's
 * markup, marked with the entry they came from, and the queue (which asks for lines with no price and
 * no cost) has nothing left to ask.
 */
const made: string[] = [];
afterAll(async () => {
  for (const companyId of made) {
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId } } });
    await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { companyId } } } });
    await prisma.takeoffItem.deleteMany({ where: { companyId } });
    await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { companyId } } } });
    await prisma.takeoffPlanPage.deleteMany({ where: { plan: { companyId } } });
    await prisma.takeoffPlan.deleteMany({ where: { companyId } });
    await prisma.jobBidRecap.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.wallType.deleteMany({ where: { companyId } });
    await prisma.vendorPriceQuote.deleteMany({ where: { companyId } });
    await prisma.vendor.deleteMany({ where: { companyId } });
    await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

const RATES = { materialMarkupPercent: 10, laborMarkupPercent: 10, overheadPercent: 8, profitPercent: 10 };
const ALL_RATES = Object.fromEntries(RECAP_RATE_KEYS.map((k) => [k, (RATES as Record<string, number>)[k] ?? null])) as RecapRates;

describe("a price the company already has is not asked again", () => {
  it("W1's four starter parts take the supplier list's and the price book's costs, through the job's markup, each saying where from", async () => {
    const company = await prisma.company.create({ data: { name: "Known Prices Co" } });
    const companyId = company.id;
    made.push(companyId);
    const gc = await prisma.contact.create({ data: { companyId, name: "Known Prices GC" } });
    const job = await prisma.job.create({ data: { companyId, contactId: gc.id, name: "Known Prices Job", status: "ESTIMATE" } });
    await prisma.jobBidRecap.create({ data: { companyId, jobId: job.id, ...RATES } });
    const w1Starter = STARTER_TYPES.find((t) => t.code === "W1")!;
    const w1 = await prisma.wallType.create({ data: { companyId, code: "W1", name: w1Starter.name, defaultHeightFt: 10, sides: 2, components: { create: w1Starter.parts.map((p, i) => ({ ...p, sortOrder: i })) } } });

    // The supplier list, in its own words; the price book, in the part's.
    const vendor = await prisma.vendor.create({ data: { companyId, name: "Northgate Supply" } });
    const listed = async (description: string, unit: string, cost: string) => {
      const entry = await prisma.lineItemCatalogEntry.create({ data: { companyId, description, unit, defaultBudgetedUnitCost: cost } });
      await prisma.vendorPriceQuote.create({ data: { companyId, vendorId: vendor.id, catalogEntryId: entry.id, description, unit, unitPrice: cost, quotedOn: new Date(), source: "PRICE_LIST" } });
      return entry.id;
    };
    const stud = await listed('3-5/8" 20ga steel stud', "EA", "4.10");
    const track = await listed('3-5/8" 20ga track', "LF", "0.95");
    const board = (await prisma.lineItemCatalogEntry.create({ data: { companyId, description: "⅝″ Type X board, 4x8 sheets", unit: "sheet", defaultBudgetedUnitCost: "14.00" } })).id;
    const hang = (await prisma.lineItemCatalogEntry.create({ data: { companyId, description: "Hang, tape and finish ⅝″ board", unit: "sf", defaultBudgetedUnitCost: "1.10", costCategory: "LABOR" } })).id;

    // 50 ft of W1 at 10 ft.
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId: job.id, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
    const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A2.1", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "100" } });
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId: job.id, name: "W1 walls", type: "LINEAR", colorHex: "#111111", wallTypeId: w1.id, heightFt: "10", sides: 2 } });
    await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0, 0.5], ys: [0.3, 0.3], itemId: item.id } });

    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, job.id));

    const lines = await prisma.jobLineItem.findMany({ where: { jobId: job.id, isDeleted: false, takeoffItemId: item.id }, orderBy: { createdAt: "asc" } });
    const by = (words: RegExp) => lines.find((l) => words.test(l.description))!;
    const expected = [
      { line: by(/studs/), entry: stud, cost: 4.1, category: "MATERIAL" },
      { line: by(/track/), entry: track, cost: 0.95, category: "MATERIAL" },
      { line: by(/Type X board/), entry: board, cost: 14, category: "MATERIAL" },
      { line: by(/Hang, tape/), entry: hang, cost: 1.1, category: "LABOR" },
    ] as const;
    for (const { line, entry, cost, category } of expected) {
      expect({ d: line.description, cost: Number(line.budgetedUnitCost), source: line.sourceCatalogEntryId, basis: line.priceBasis, category: line.costCategory }).toEqual({ d: line.description, cost, source: entry, basis: "COMPANY_CATALOG", category });
      // The same arithmetic the queue's typed cost goes through (`priceLineFromCost`).
      expect(Number(line.unitPrice)).toBe(Number(unitPriceFromCost({ quantity: Number(line.quantity), unitCost: cost, costCategory: category }, ALL_RATES)));
    }
    // What the review queue would ask: nothing.
    expect(await prisma.jobLineItem.count({ where: { jobId: job.id, isDeleted: false, unitPrice: null, budgetedUnitCost: null } })).toBe(0);

    // A price somebody types over the catalog's stays theirs on the next write.
    await prisma.jobLineItem.update({ where: { id: expected[0].line.id }, data: { unitPrice: "9.99" } });
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, job.id));
    expect((await prisma.jobLineItem.findUniqueOrThrow({ where: { id: expected[0].line.id } })).unitPrice?.toString()).toBe("9.99");
  });

  it("a material the company has no price for is still asked", async () => {
    const company = await prisma.company.create({ data: { name: "Unknown Prices Co" } });
    const companyId = company.id;
    made.push(companyId);
    const gc = await prisma.contact.create({ data: { companyId, name: "GC" } });
    const job = await prisma.job.create({ data: { companyId, contactId: gc.id, name: "Unknown Prices Job", status: "ESTIMATE" } });
    await prisma.jobBidRecap.create({ data: { companyId, jobId: job.id, ...RATES } });
    const w1Starter = STARTER_TYPES.find((t) => t.code === "W1")!;
    const w1 = await prisma.wallType.create({ data: { companyId, code: "W1", name: w1Starter.name, defaultHeightFt: 10, sides: 2, components: { create: w1Starter.parts.map((p, i) => ({ ...p, sortOrder: i })) } } });
    // A 25 ga stud is not this 20 ga one.
    await prisma.lineItemCatalogEntry.create({ data: { companyId, description: '3-5/8" 25ga steel stud', unit: "EA", defaultBudgetedUnitCost: "3.20" } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId: job.id, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
    const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A2.1", pageWidthPt: 2592 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "100" } });
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId: job.id, name: "W1 walls", type: "LINEAR", colorHex: "#111111", wallTypeId: w1.id, heightFt: "10", sides: 2 } });
    await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0, 0.5], ys: [0.3, 0.3], itemId: item.id } });
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, job.id));
    expect(await prisma.jobLineItem.count({ where: { jobId: job.id, isDeleted: false, unitPrice: null, budgetedUnitCost: null } })).toBe(4);
  });
});
