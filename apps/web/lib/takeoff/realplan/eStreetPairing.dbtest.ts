import { basename, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { pageInventoryWork, realDeps } from "@/lib/plan-ingest/pageInventory";
import { pdfPageCount } from "@/lib/ask/pageCount";
import { ensureSheetNames, pairingsForPlan } from "@/lib/takeoff/priorPlanLoad";
import { detectWallsForCalibration, EXISTING_WALLS_READ } from "@/lib/takeoff/detectWallsForCalibration";

/**
 * E Street 421 in the app: "No demolition plan is paired" on A2.1 and an
 * EMPTY "Compare with" list, while the eval paired the set. The inventory
 * recorded the keyless sheet names only with plan-text reading on, so a
 * company with plan comparison on and plan reading off had no names to pair
 * by, and the picker had no sheets to offer.
 *
 * On the real drawing (ESTREET_PDF, outside the repository; skipped without
 * it), through the product's own inventory and loader:
 *   1. a set inventoried with no names gets them once (`ensureSheetNames`),
 *      and A2.1 is paired with its demolition plan;
 *   2. the inventory itself now names the sheets with plan comparison on and
 *      plan reading off.
 */
const PDF = process.env.ESTREET_PDF ?? "";

async function inventoried(name: string, planCompareOn: boolean, sheetNamesOn?: () => Promise<boolean>) {
  process.env.TAKEOFF_LOCAL_PLAN_DIR = dirname(PDF);
  const company = await prisma.company.create({ data: { name, planCompareOn } });
  // Plan reading OFF, as the E Street company had it.
  await prisma.companyAiSettings.create({ data: { companyId: company.id, aiEnabled: false, disabledFeatures: [], optedInFeatures: [], modelOverride: null } });
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "E Street", status: "ESTIMATE" } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId: company.id, jobId: job.id, fileUrl: `local:${basename(PDF)}`, fileName: basename(PDF) } });
  const pages = pdfPageCount(readFileSync(PDF)) ?? 0;
  const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId: company.id, stage: "PAGE_INVENTORY", pageCount: pages, finishedAt: new Date() } });
  const work = pageInventoryWork({ planId: plan.id, companyId: company.id, ingestJobId: ingest.id, jobId: job.id, startedByUserId: null }, { ...realDeps, ...(sheetNamesOn ? { sheetNamesOn } : {}) });
  for (let n = 1; n <= pages; n++) expect((await work({ id: `inv-${n}`, pageNumber: n, stage: "PAGE_INVENTORY", attempts: 1 })).ok).toBe(true);
  return { companyId: company.id, planId: plan.id };
}

async function a21Pairing(planId: string) {
  const { byPage, sheets } = await pairingsForPlan(planId);
  const a21 = sheets.find((s) => s.sheetNumber?.replace(/\s/g, "") === "A2.1");
  return { sheets, a21, pairing: a21 ? byPage.get(a21.pageNumber) : undefined };
}

describe.skipIf(PDF === "")("E Street 421: A2.1 is paired with its demolition plan in the app", () => {
  it("a set inventoried without names gets them once, and A2.1 pairs", async () => {
    const { companyId, planId } = await inventoried("E Street before", true, async () => false);
    expect((await pairingsForPlan(planId)).sheets).toHaveLength(0);
    expect(await ensureSheetNames(planId, companyId)).toBeGreaterThan(10);
    expect(await ensureSheetNames(planId, companyId)).toBe(0);
    const { sheets, a21, pairing } = await a21Pairing(planId);
    expect(sheets.length).toBeGreaterThan(10);
    expect(a21, "A2.1 was not named").toBeDefined();
    expect(pairing, "A2.1 has no demolition plan").toBeDefined();
    const demo = sheets.find((s) => s.pageNumber === pairing!.demoPage);
    expect(`${demo?.sheetNumber} ${demo?.title}`).toMatch(/D|DEMO/i);
  }, 600_000);

  it("the inventory names the sheets itself with plan comparison on and plan reading off", async () => {
    const { planId } = await inventoried("E Street after", true);
    const { a21, pairing } = await a21Pairing(planId);
    expect(a21).toBeDefined();
    expect(pairing).toBeDefined();
  }, 600_000);

  // The new-customer walk counted existing walls and nothing said how much.
  // With plan comparison OFF, detection on A2.1 runs it dry and keeps the
  // footage it would set aside, for the whole-set panel; ON, it applies it
  // and keeps nothing.
  it("plan comparison off: A2.1's detection keeps how much existing wall is in its count, against its demolition plan", async () => {
    for (const on of [false, true]) {
      // Named, as a set is once the owner turns plan reading or plan comparison on.
      const { companyId, planId } = await inventoried(`E Street existing ${on}`, on, async () => true);
      const { a21, sheets, pairing } = await a21Pairing(planId);
      const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: a21!.pageNumber } });
      const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "144" } });
      await detectWallsForCalibration({ pageId: page.id, calibrationId: cal.id, planId, companyId, pageNumber: a21!.pageNumber, feetPerUnit: 144, wallTypes: [] });
      const read = await prisma.takeoffPlanTextRead.findUnique({ where: { planId_pageNumber_kind: { planId, pageNumber: a21!.pageNumber, kind: EXISTING_WALLS_READ } } });
      if (on) {
        expect(read).toBeNull();
        continue;
      }
      const value = read?.value as { calibrationId: string; feet: number; against: string } | undefined;
      expect(value?.calibrationId).toBe(cal.id);
      expect(value?.feet).toBeGreaterThan(20);
      expect(value?.against).toBe(sheets.find((s) => s.pageNumber === pairing!.demoPage)?.sheetNumber);
    }
  }, 900_000);
});
