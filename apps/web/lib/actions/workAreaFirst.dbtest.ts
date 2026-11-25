import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Diego's audit order (2026-11-25), coordination/work-area-first.md W3, W5, W7, on real Postgres: the whole sheet as new
 * work is a stored work area, the whole-set summary knows a sheet is answered, and the estimate's warning agrees with
 * the screen (answered by a work area only).
 */
const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", async (actual) => ({ ...(await actual<typeof import("next/server")>()), after: () => {} }));
const exclusions = (await import("./takeoffExclusions")) as unknown as { markWholeSheetNewWork: (planId: string, pageNumber: number) => Promise<{ ok: boolean; error?: string }> };
const { syncTakeoffItemLines } = await import("@/lib/estimating/takeoff-item-lines");
const { wholeSetSummary } = await import("@/lib/plan-ingest/walls");
const { insideWorkArea } = await import("@/lib/takeoff/userExclusions");

let companyId = "";
let jobId = "";
let planId = "";
const pages: string[] = [];
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Work Area First Co" } })).id;
  Object.assign(context, { companyId, company: { id: companyId } });
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `waf_${Date.now()}`, email: `waf_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Work Area First Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:R.pdf", fileName: "R.pdf" } })).id;
  const type = await prisma.wallType.create({ data: { companyId, code: "W1", name: "W1", defaultHeightFt: 10, sides: 2, components: { create: [{ description: "track", basis: "LINEAR_FT", unit: "lin ft", factor: 1 }] } } });
  const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "W1 walls", type: "LINEAR", colorHex: "#111111", wallTypeId: type.id, heightFt: 10, sides: 2 } });
  for (const n of [1, 2]) {
    const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: n, label: `A-10${n}` } });
    const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
    await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: cal.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.4], ys: [0.2, 0.2], itemId: item.id } });
    await prisma.planSheetText.create({ data: { planId, pageNumber: n, renovationMarks: ["(E)"], widthPt: 3024, heightPt: 2160, hasTextLayer: true } });
    pages.push(page.id);
  }
});
afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.planSheetText.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.takeoffItem.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

const unchecked = async () => (await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId))).renovationUnchecked ?? [];

describe("W7: the estimate's warning is answered by a work area only", () => {
  it("the control: both renovation sheets are named", async () => {
    expect((await unchecked()).sort()).toEqual(["A-101", "A-102"]);
  });
  it("an exclusion of walls drawn like one does not answer it (on main it did)", async () => {
    await prisma.takeoffSheetExclusion.create({ data: { pageId: pages[0]!, kind: "EXCLUDE_LIKE", xs: [0.1, 0.4], ys: [0.2, 0.2] } });
    expect(await unchecked()).toContain("A-101");
  });
});

describe("W3: Whole sheet is new work", () => {
  it("stores one work area over the whole sheet, and the estimate no longer names it", async () => {
    const done = await exclusions.markWholeSheetNewWork(planId, 1);
    expect(done).toEqual({ ok: true, value: expect.anything() });
    const rows = await prisma.takeoffSheetExclusion.findMany({ where: { pageId: pages[0]!, kind: "WORK_AREA" } });
    expect(rows).toHaveLength(1);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1.5], [1, 1.5]] as const) expect(insideWorkArea(x, y, [{ xs: rows[0]!.xs, ys: rows[0]!.ys }])).toBe(true);
    expect(await unchecked()).toEqual(["A-102"]);
  });
  it("refuses a page that is not on this company's plans", async () => {
    const other = await exclusions.markWholeSheetNewWork("plan_nobody", 1);
    expect(other.ok).toBe(false);
  });
});

describe("W5: the whole-set summary knows which renovation sheets are answered", () => {
  it("marks the page with a work area, and not the other", async () => {
    const rows = await wholeSetSummary(planId, companyId, 3);
    const byPage = new Map(rows.map((r) => [r.pageNumber, r as { workArea?: boolean }]));
    expect(byPage.get(1)?.workArea).toBe(true);
    expect(byPage.get(2)?.workArea ?? false).toBe(false);
  });
});
