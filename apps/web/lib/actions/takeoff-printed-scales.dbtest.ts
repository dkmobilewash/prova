import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `applyPrintedScales` against a real Postgres: every sheet the rail names is
 * set from ITS OWN reading, an already-scaled sheet and a sheet with no
 * reading are skipped and named, and the note on each calibration says which
 * reading it came from. The one thing it must never do is copy one sheet's
 * scale onto another, so the two readings here declare DIFFERENT feet and the
 * test reads them back per page.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { applyPrintedScales } = await import("./takeoff");

const SHEET_PT = 36 * 72;
let companyId = "";
let jobId = "";
let planId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Printed Scales Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const user = await prisma.user.create({ data: { clerkId: `printed-scales-${Date.now()}`, email: `printed-scales-${Date.now()}@example.test`, companyId } });
  context.id = user.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Printed Scales Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "https://example.test/set.pdf" } });
  planId = plan.id;
  for (const n of [1, 2, 3, 4]) {
    await prisma.planSheetText.create({
      data: { planId, pageNumber: n, hasTextLayer: true, widthPt: SHEET_PT, heightPt: 24 * 72, rotation: 0 },
    });
  }
  // Pages 1 and 2 print 1/8"; page 1's reading was checked against dimensions, page 2's was not.
  // Page 3 printed nothing readable. Page 4 prints 1/8" and already has a scale.
  const reading = (pageNumber: number, feet: number, source: string) => ({
    planId,
    pageNumber,
    scaleName: "1/8\" = 1'-0\"",
    source,
    x1: 0.1,
    y1: 0.5,
    x2: 0.6,
    y2: 0.5,
    declaredDistanceFeet: String(feet),
    declaredText: `${feet}'-0"`,
  });
  await prisma.planSheetScaleReading.create({ data: reading(1, 144, "DIMENSIONS") });
  await prisma.planSheetScaleReading.create({ data: reading(2, 120, "PRINTED") });
  await prisma.planSheetScaleReading.create({ data: { planId, pageNumber: 3, scaleName: null, source: "DIMENSIONS", declineReason: "no scale printed" } });
  await prisma.planSheetScaleReading.create({ data: reading(4, 144, "PRINTED") });
  const page4 = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 4, pageWidthPt: SHEET_PT } });
  await prisma.takeoffScaleCalibration.create({
    data: { pageId: page4.id, x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.5, declaredDistanceFeet: "99", createdByUserId: context.id },
  });
});

afterAll(async () => {
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe("applyPrintedScales", () => {
  it("sets each named sheet from its own reading, skips the scaled and the unread, and says so", async () => {
    const result = await applyPrintedScales(jobId, planId, [1, 2, 3, 4, 4]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.applied).toEqual([1, 2]);
    expect(result.value.skipped).toEqual([
      { pageNumber: 3, why: "no scale was read off this sheet" },
      { pageNumber: 4, why: "already has a scale" },
    ]);
    const pages = await prisma.takeoffPlanPage.findMany({
      where: { planId },
      orderBy: { pageNumber: "asc" },
      include: { calibrations: { orderBy: { createdAt: "desc" } } },
    });
    expect(pages.map((p) => [p.pageNumber, p.calibrations.length])).toEqual([
      [1, 1],
      [2, 1],
      [4, 1],
    ]);
    // Page 1's feet are page 1's, page 2's are page 2's: nothing was copied across.
    expect(Number(pages[0].calibrations[0].declaredDistanceFeet)).toBe(144);
    expect(Number(pages[1].calibrations[0].declaredDistanceFeet)).toBe(120);
    expect(pages[0].calibrations[0].note).toMatch(/checked against its dimensions/);
    expect(pages[1].calibrations[0].note).toMatch(/not checked against a dimension/);
    expect(pages[0].calibrations[0].createdByUserId).toBe(context.id);
    // Page 4 kept the scale it had.
    expect(Number(pages[2].calibrations[0].declaredDistanceFeet)).toBe(99);
  });

  it("refuses a plan that is not the caller's, and an empty list", async () => {
    const other = await prisma.company.create({ data: { name: "Someone Else" } });
    context.company.id = other.id;
    const refused = await applyPrintedScales(jobId, planId, [1]);
    expect(refused.ok).toBe(false);
    context.company.id = companyId;
    await prisma.company.delete({ where: { id: other.id } });
    const empty = await applyPrintedScales(jobId, planId, []);
    expect(empty).toEqual({ ok: false, error: "No sheets were named." });
  });
});
