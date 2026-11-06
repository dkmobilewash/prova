import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { prisma } from "@prova/db";
import { pageInventoryWork, realDeps } from "@/lib/plan-ingest/pageInventory";
import { pdfPageCount } from "@/lib/ask/pageCount";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { linedUpDemo, pairingsForPlan, suggestPriorPlan } from "@/lib/takeoff/priorPlanLoad";

/**
 * Chrome on Baker: A101 shows existing work and "No demolition plan is
 * paired", while the set has demolition plan A001 (page 11). The titles fit
 * A100 and A101 alike, so the pairer pairs neither. The bar now OFFERS the
 * demolition plan the same-layout check lines up with this sheet — "Compare
 * with A001?" — and pairs nothing until a person accepts.
 *
 * Reads the drawing from BAKER_PDF (outside the repository); skipped without
 * it. The inventory and the loader are the product's own.
 */
const PDF = process.env.BAKER_PDF ?? "";
const A001 = 11;
const A101 = 13;
const A201 = 16;

describe.skipIf(PDF === "")("Baker A101 is offered demolition plan A001 by its drawing, on the real set", () => {
  it("offers A001 where the titles pair nothing, applies nothing, and stops offering once a person chose", async () => {
    process.env.TAKEOFF_LOCAL_PLAN_DIR = dirname(PDF);
    const company = await prisma.company.create({ data: { name: "Baker demo suggest", planCompareOn: true } });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Baker", status: "ESTIMATE" } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId: company.id, jobId: job.id, fileUrl: `local:${basename(PDF)}`, fileName: basename(PDF) } });
    const pages = pdfPageCount(readFileSync(PDF)) ?? 0;
    const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId: company.id, stage: "PAGE_INVENTORY", pageCount: pages, finishedAt: new Date() } });
    const inventory = pageInventoryWork({ planId: plan.id, companyId: company.id, ingestJobId: ingest.id, jobId: job.id, startedByUserId: null }, { ...realDeps, sheetNamesOn: async () => true });
    for (let n = 1; n <= pages; n++) expect((await inventory({ id: `inv-${n}`, pageNumber: n, stage: "PAGE_INVENTORY", attempts: 1 })).ok).toBe(true);
    // A101 scaled at 1/8", the way the one-press printed scale saves it.
    const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: A101 } });
    await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "288" } });

    // The titles pair nothing: the bar says "No demolition plan is paired".
    const before = await pairingsForPlan(plan.id);
    expect(before.sheets.find((s) => s.pageNumber === A001)?.title).toMatch(/DEMOLITION/);
    expect(before.byPage.has(A101)).toBe(false);

    // The drawing lines up with A001: offered, and only offered.
    const offer = await suggestPriorPlan({ planId: plan.id, companyId: company.id, pageNumber: A101 });
    console.log(`BAKER_SUGGEST ${JSON.stringify(offer)}`);
    expect(offer).toMatchObject({ demoPage: A001, sheet: "A001" });
    expect(offer!.votes).toBeGreaterThanOrEqual(8);
    expect((await prisma.takeoffPlanPage.findUniqueOrThrow({ where: { id: page.id } })).priorPageChoice).toBeNull();
    expect((await pairingsForPlan(plan.id)).byPage.has(A101)).toBe(false);

    // Accepted (what savePriorPlanChoice stores): paired as chosen, nothing more offered.
    await prisma.takeoffPlanPage.update({ where: { id: page.id }, data: { priorPage: A001, priorPageChoice: "user" } });
    expect((await pairingsForPlan(plan.id)).byPage.get(A101)).toEqual({ demoPage: A001, source: "user", basis: "chosen" });
    expect(await suggestPriorPlan({ planId: plan.id, companyId: company.id, pageNumber: A101 })).toBeNull();

    // A pairing the person removed is not offered back.
    await prisma.takeoffPlanPage.update({ where: { id: page.id }, data: { priorPage: null, priorPageChoice: "none" } });
    expect(await suggestPriorPlan({ planId: plan.id, companyId: company.id, pageNumber: A101 })).toBeNull();

    // The layout check decides, not the titles: A001 laid over Baker's elevations sheet
    // (same paper, same scale) does not line up, and is not offered.
    const doc = await openPlanPdf(readFileSync(PDF));
    try {
      const strokes = async (n: number) => ({ page: n, ...(await doc.pageStrokes(n)) });
      const [a101, a201, a001] = [await strokes(A101), await strokes(A201), await strokes(A001)];
      expect(linedUpDemo(a101, [a001], 288)).toMatchObject({ demoPage: A001 });
      const elevations = linedUpDemo(a201, [a001], 288);
      console.log(`BAKER_SUGGEST elevations ${JSON.stringify(elevations)}`);
      expect(elevations).toBeNull();
    } finally {
      await doc.close();
    }

    // No scale, no layout check, no offer: never a guess.
    await prisma.takeoffPlanPage.update({ where: { id: page.id }, data: { priorPage: null, priorPageChoice: null } });
    await prisma.takeoffScaleCalibration.deleteMany({ where: { pageId: page.id } });
    expect(await suggestPriorPlan({ planId: plan.id, companyId: company.id, pageNumber: A101 })).toBeNull();
  }, 600_000);
});
