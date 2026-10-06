import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { scalePrefillsFromReadings } from "../takeoff-plan-view";

/**
 * The scale reading against a real Postgres, because three of its properties are
 * the DATABASE's and not the code's: the one-row-per-page key, the decimal
 * column's precision, and whether deleting a plan reaches it.
 *
 * That last one is the `InvoiceCounter` scar (#224/#227): a new per-parent table
 * is a child nothing thought about until a cleanup script refused to delete the
 * parent. This one is declared `onDelete: Cascade` rather than RESTRICT, and
 * that is worth proving rather than reading off the schema.
 */

const ids: { companies: string[] } = { companies: [] };

afterEach(async () => {
  // Dependency order: the plan's children go with the plan, the plan with the
  // job, and `Company` does not cascade to `Contact` — learned by the database
  // refusing, in `estimate-crosschecks-query.dbtest.ts`.
  for (const companyId of ids.companies) {
    await prisma.takeoffPlan.deleteMany({ where: { job: { companyId } } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  }
  ids.companies = [];
});

async function aPlan() {
  const company = await prisma.company.create({ data: { name: "ZZ Scale Reading Co" } });
  ids.companies.push(company.id);
  const contact = await prisma.contact.create({
    data: { companyId: company.id, name: "ZZ GC" },
  });
  const job = await prisma.job.create({
    data: { companyId: company.id, name: "ZZ Scale Job", status: "ESTIMATE", contactId: contact.id },
  });
  const plan = await prisma.takeoffPlan.create({
    data: { companyId: company.id, jobId: job.id, fileUrl: "https://example.invalid/x.pdf", fileName: "x.pdf" },
  });
  return { company, job, plan };
}

const reading = (planId: string, pageNumber: number) => ({
  planId,
  pageNumber,
  scaleName: '1/8" = 1\'-0"',
  x1: 0.1,
  y1: 0.2,
  x2: 0.1489,
  y2: 0.2,
  declaredDistanceFeet: 16.375,
  declaredText: `16' - 4 1/2"`,
  agreedText: `16' - 4 1/2"\n11' - 0"\n6' - 0"`,
  consideredCount: 30,
  inheritedError: 0.00315,
  declineReason: null,
});

describe("PlanSheetScaleReading", () => {
  it("keeps ONE ROW PER PAGE, so a second run replaces a reading rather than stacking them", async () => {
    const { plan } = await aPlan();
    await prisma.planSheetScaleReading.create({ data: reading(plan.id, 1) });
    await prisma.planSheetScaleReading.upsert({
      where: { planId_pageNumber: { planId: plan.id, pageNumber: 1 } },
      create: reading(plan.id, 1),
      update: { scaleName: '1/4" = 1\'-0"' },
    });
    const rows = await prisma.planSheetScaleReading.findMany({ where: { planId: plan.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].scaleName).toBe('1/4" = 1\'-0"');
  });

  it("STORES THE DISTANCE TO FOUR PLACES, which is a sixteenth of an inch", async () => {
    // `Decimal(12,4)` matches `TakeoffScaleCalibration.declaredDistanceFeet`
    // exactly, deliberately: a prefill that rounds differently from the column
    // it lands in would show one figure and store another. 15.2865 ft is
    // 15' 3 7/16" — a real dimension off a real sheet.
    const { plan } = await aPlan();
    await prisma.planSheetScaleReading.create({
      data: { ...reading(plan.id, 2), declaredDistanceFeet: 15.2865 },
    });
    const row = await prisma.planSheetScaleReading.findFirstOrThrow({ where: { planId: plan.id, pageNumber: 2 } });
    expect(Number(row.declaredDistanceFeet)).toBeCloseTo(15.2865, 4);
    // And it survives the trip through the view layer at full precision.
    const prefill = scalePrefillsFromReadings([
      {
        pageNumber: row.pageNumber,
        scaleName: row.scaleName,
        x1: row.x1,
        y1: row.y1,
        x2: row.x2,
        y2: row.y2,
        declaredDistanceFeet: row.declaredDistanceFeet,
        declaredText: row.declaredText,
        agreedText: row.agreedText,
        consideredCount: row.consideredCount,
        inheritedError: row.inheritedError,
      },
    ])[2];
    expect(prefill?.declaredFeet).toBeCloseTo(15.2865, 4);
  });

  it("stores a DECLINE as a row, so no-reading and not-read stay different states", async () => {
    const { plan } = await aPlan();
    await prisma.planSheetScaleReading.create({
      data: {
        planId: plan.id,
        pageNumber: 3,
        consideredCount: 0,
        declineReason: "This sheet is a scan, so there are no printed dimensions to read a scale from.",
      },
    });
    const row = await prisma.planSheetScaleReading.findFirstOrThrow({ where: { planId: plan.id, pageNumber: 3 } });
    expect(row.scaleName).toBeNull();
    expect(row.x1).toBeNull();
    expect(row.declineReason).toMatch(/is a scan/);
    // And the view layer offers nothing for it rather than a blank prefill.
    expect(
      scalePrefillsFromReadings([
        {
          pageNumber: row.pageNumber,
          scaleName: row.scaleName,
          x1: row.x1,
          y1: row.y1,
          x2: row.x2,
          y2: row.y2,
          declaredDistanceFeet: row.declaredDistanceFeet,
          declaredText: row.declaredText,
          agreedText: row.agreedText,
          consideredCount: row.consideredCount,
          inheritedError: row.inheritedError,
        },
      ]),
    ).toEqual({});
  });

  it("GOES WITH ITS PLAN, so this table can never refuse a cleanup", async () => {
    // The `InvoiceCounter` scar: a per-parent child keyed on the parent's id
    // outlives a delete of the parent's other rows and then blocks the parent.
    // CASCADE rather than RESTRICT, proved by deleting rather than by reading
    // the schema.
    const { plan } = await aPlan();
    await prisma.planSheetScaleReading.create({ data: reading(plan.id, 1) });
    await prisma.takeoffPlan.delete({ where: { id: plan.id } });
    expect(await prisma.planSheetScaleReading.count({ where: { planId: plan.id } })).toBe(0);
  });

  it("allows a reading on every page of a set", async () => {
    const { plan } = await aPlan();
    for (let page = 1; page <= 4; page += 1) {
      await prisma.planSheetScaleReading.create({ data: reading(plan.id, page) });
    }
    expect(await prisma.planSheetScaleReading.count({ where: { planId: plan.id } })).toBe(4);
  });
});
