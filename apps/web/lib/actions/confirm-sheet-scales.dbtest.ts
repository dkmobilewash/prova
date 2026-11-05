import { prisma } from "@prova/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ── CONFIRM SCALES SAVES ONLY WHAT THE READER IS SURE OF, WHATEVER IS ASKED ──
 *
 * The button sends the sure pages, but a form can send anything: the action
 * rebuilds the rows from the stored readings and saves a page only while it is
 * still "high" — or, with the printed fix, one page whose title block is all
 * there is. Run against a SCRATCH database (`vitest.db.setup.mts` refuses
 * anything else).
 */
const context = { company: { id: "", name: "Scales Co" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const detected: number[] = [];
vi.mock("@/lib/takeoff/detectWallsForCalibration", () => ({ detectWallsAfterResponse: (t: { pageNumber: number }) => detected.push(t.pageNumber) }));

const { confirmSheetScales } = await import("./takeoff");

let companyId = "";
let jobId = "";
let planId = "";
const QUARTER = '1/4" = 1\'-0"';

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Scales Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({ data: { companyId, clerkId: `scales_${Date.now()}`, email: `scales_${Date.now()}@example.test`, role: "OWNER" } });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Scales", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "https://example.invalid/set.pdf" } })).id;
  for (const pageNumber of [1, 2, 3]) {
    await prisma.planSheetText.create({ data: { planId, pageNumber, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
  }
  await prisma.planSheetScaleReading.create({ data: { planId, pageNumber: 1, scaleName: QUARTER, source: "DIMENSIONS", x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.5, declaredDistanceFeet: "72", declaredText: "72'-0\"", agreedText: "72'-0\"\n24'-0\"", consideredCount: 3, inheritedError: 0.002 } });
  await prisma.planSheetScaleReading.create({ data: { planId, pageNumber: 2, scaleName: QUARTER, source: "CAPTION", x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "144", declaredText: QUARTER } });
});

afterAll(async () => {
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

const saved = async () =>
  (await prisma.takeoffScaleCalibration.findMany({ where: { page: { planId } }, select: { declaredDistanceFeet: true, page: { select: { pageNumber: true } } } }))
    .map((c) => [c.page.pageNumber, Number(c.declaredDistanceFeet)])
    .sort();

describe("Confirm scales", () => {
  it("asked for every page, saves only the sure one, and starts the wall finder on it", async () => {
    expect(await confirmSheetScales(jobId, planId, [1, 2, 3])).toEqual({ ok: true, value: { confirmed: 1, skipped: 2 } });
    expect(await saved()).toEqual([[1, 72]]);
    expect(detected).toEqual([1]);
  });

  it("never saves a page twice", async () => {
    expect(await confirmSheetScales(jobId, planId, [1])).toEqual({ ok: true, value: { confirmed: 0, skipped: 1 } });
    expect(await saved()).toEqual([[1, 72]]);
  });

  it("the printed fix: one page, and only one whose title block is all there is", async () => {
    expect((await confirmSheetScales(jobId, planId, [2, 3], true)).ok).toBe(false);
    expect(await confirmSheetScales(jobId, planId, [3], true)).toEqual({ ok: true, value: { confirmed: 0, skipped: 1 } });
    expect(await confirmSheetScales(jobId, planId, [2], true)).toEqual({ ok: true, value: { confirmed: 1, skipped: 0 } });
    expect(await saved()).toEqual([[1, 72], [2, 144]]);
  });

  it("refuses a plan set that is not this job's newest", async () => {
    const result = await confirmSheetScales(jobId, "not-this-plan", [1]);
    expect(result.ok).toBe(false);
  });
});
