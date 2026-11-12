import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { loadBidChecks } from "./bidCheckQuery";

/**
 * ── THE BID CHECK'S EXISTING WALLS, ON A SET WITH NO DEMOLITION PLAN (Totem Lake Dental) ──
 *
 * Totem's A2.1 is titled "DEMOLITION FLOOR PLAN & FLOOR PLAN": one drawing, the demolition and the
 * new work on the same floor plan (its wall legend: shaded = new, dashed = to be removed, outline =
 * existing to remain). There is no other sheet to pair it with, and the bid check said "none
 * compared with a demolition plan" with a fix that read "Pair A2.1 with its demolition plan". Now:
 * it says the set has none and the fix opens the sheet to set the existing walls aside; a set-aside
 * a person made answers the check; a set that does have one is still told to pair.
 */
let companyId = "";
let jobId = "";
let planId = "";
let a21PageId = "";
/** A sheet proposal as the keyless namer writes one. */
const named = (ingestJobId: string, pageNumber: number, number: string, title: string | null) => ({
  ingestJobId, planId, pageNumber, proposedSheetNumber: number, proposedTitle: title,
  proposedReason: "read from the title block", proposedConfidence: "HIGH" as const, model: "keyless", promptVersion: "keyless",
});

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `Totem Bid Check ${Date.now()}` } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Totem Lake Dental", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "https://example.test/totem.pdf" } })).id;
  const ingestJobId = (await prisma.planIngestJob.create({ data: { planId, companyId, stage: "PAGE_INVENTORY", pageCount: 10 } })).id;
  // Totem's sheets as the inventory names them: no sheet is a demolition plan.
  for (const [pageNumber, number] of [[1, "A0.1"], [5, "A2.1"], [6, "A2.2"]] as const) {
    await prisma.planSheetProposal.create({ data: named(ingestJobId, pageNumber, number, pageNumber === 5 ? "FLOOR PLAN" : null) });
  }
  await prisma.planSheetText.create({ data: { planId, pageNumber: 5, hasTextLayer: true, widthPt: 2592, heightPt: 1728, renovationMarks: ["EXISTING CONSTRUCTION TO REMAIN"] } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 5, pageWidthPt: 2592 } });
  a21PageId = page.id;
  const scale = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5, declaredDistanceFeet: "72" } });
  for (let i = 0; i < 3; i += 1) await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: scale.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.3], ys: [0.2 + i * 0.05, 0.2 + i * 0.05] } });
});

afterAll(async () => {
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

const existing = async () => (await loadBidChecks(companyId, jobId)).find((c) => c.key === "existing")!;

describe("the bid check's existing walls on Totem Lake Dental", () => {
  it("no demolition plan in the set: says so, and the fix opens the sheet to set them aside", async () => {
    const c = await existing();
    expect(c.open).toBe(true);
    expect(c.lines[0]).toBe(
      "A2.1: shows existing work on the plan itself (the set has no separate demolition plan for it), 3 walls taken off, none set aside as existing — existing walls to remain may be priced as new",
    );
    expect(c.fix).toEqual({ label: "Set aside the existing walls on A2.1", href: `/takeoff/${jobId}?page=5`, newTab: true });
  });

  it("walls a person set aside, drawn like one they picked: the check is answered", async () => {
    const row = await prisma.takeoffSheetExclusion.create({ data: { pageId: a21PageId, kind: "EXCLUDE_LIKE", xs: [0.1, 0.3], ys: [0.2, 0.2] } });
    expect((await existing()).open).toBe(false);
    await prisma.takeoffSheetExclusion.delete({ where: { id: row.id } });
  });

  it("a set that has a demolition plan for the sheet is still told to pair it", async () => {
    const ingestJobId = (await prisma.planIngestJob.findFirstOrThrow({ where: { planId }, select: { id: true } })).id;
    await prisma.planSheetProposal.create({ data: named(ingestJobId, 4, "A1.1", "DEMOLITION FLOOR PLAN") });
    await prisma.company.update({ where: { id: companyId }, data: { planCompareOn: true } });
    const c = await existing();
    expect(c.lines[0]).toMatch(/^A2\.1: shows existing work, 3 walls taken off, none compared with a demolition plan/);
    expect(c.fix?.label).toBe("Pair A2.1 with its demolition plan");
  });
});
