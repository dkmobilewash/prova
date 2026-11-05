import { basename, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { pageInventoryWork, realDeps } from "@/lib/plan-ingest/pageInventory";
import { pdfPageCount } from "@/lib/ask/pageCount";
import { ensureSheetNames, pairingsForPlan } from "@/lib/takeoff/priorPlanLoad";
import { wallsPlan, wallsSheetsFor } from "@/lib/plan-ingest/walls";

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

  // Chrome's re-test: A1.1, the demolition plan, was counted for A2.1's level
  // because it had walls already, and A2.1 read "same level as A1.1".
  it("the NEW floor plan A2.1 is the level's counted plan, even when the demolition plan A1.1 already has walls on the job", async () => {
    const { companyId, planId } = await inventoried("E Street counted plan", true, async () => true);
    const sheets = await wallsSheetsFor(planId, companyId);
    const a11 = sheets.find((s) => s.sheetNumber === "A1.1")!;
    const a21 = sheets.find((s) => s.sheetNumber === "A2.1")!;
    expect(a11.title).toMatch(/DEMOLITION/);
    const scaled = sheets.map((s) => ({ ...s, hasScale: true, ...(s === a11 ? { hasWalls: true, onJob: true } : {}) }));
    const plan = wallsPlan(scaled);
    expect(plan.get(a21.pageNumber)).toBeNull();
    expect(plan.get(a11.pageNumber)).toBe("not a floor plan");
  }, 600_000);
});