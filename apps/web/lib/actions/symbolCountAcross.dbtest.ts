import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveSymbolCountAcrossSheets } = await import("./symbolCount");
const { saveTakeoffMeasurement } = await import("./takeoff");
const { loadTakeoffWorkspace } = await import("@/lib/takeoff/workspaceLoad");

let companyId = "", jobId = "", planId = "";
let job: { id: string; status: "ESTIMATE" };
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Symbols Across Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({ data: { companyId, clerkId: `syma_${Date.now()}`, email: `syma_${Date.now()}@example.test`, role: "OWNER" } });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const created = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Across", status: "ESTIMATE" } });
  jobId = created.id;
  job = { id: created.id, status: "ESTIMATE" };
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
  planId = plan.id;
  // Page 3 has a scale; page 5 prints one that a count must not apply; page 7 has nothing.
  const p3 = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 3, label: "E2.01", pageWidthPt: 2592 } });
  await prisma.takeoffScaleCalibration.create({ data: { pageId: p3.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "288", createdByUserId: owner.id } });
  await prisma.planSheetText.create({ data: { planId, pageNumber: 5, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
  await prisma.planSheetScaleReading.create({ data: { planId, pageNumber: 5, scaleName: '1/8" = 1\'-0"', x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "288", source: "CAPTION" } });
});
afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { planId } });
  await prisma.planSheetScaleReading.deleteMany({ where: { planId } });
  await prisma.planSheetText.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("saveSymbolCountAcrossSheets", () => {
  it("saves on every sheet: a scaled one records its scale, and one with no scale or no page row still counts", async () => {
    const result = await saveSymbolCountAcrossSheets(jobId, planId, {
      label: "2x4 troffer",
      sheets: [
        { pageNumber: 3, xs: [0.2, 0.3], ys: [0.4, 0.4] },
        { pageNumber: 5, xs: [0.5, 0.6, 0.7], ys: [0.1, 0.1, 0.1] },
        { pageNumber: 7, xs: [0.9], ys: [0.9] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.saved.map((s) => [s.pageNumber, s.count])).toEqual([[3, 2], [5, 3], [7, 1]]);
    expect(result.value.total).toBe(6);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { page: { planId } }, include: { page: { include: { calibrations: true } } } });
    expect(rows.map((r) => r.page.pageNumber).sort()).toEqual([3, 5, 7]);
    expect(rows.every((r) => r.kind === "COUNT" && r.label === "2x4 troffer")).toBe(true);
    const onSheet = (n: number) => rows.find((r) => r.page.pageNumber === n)!;
    expect(onSheet(3).calibrationId).toBe(onSheet(3).page.calibrations[0]!.id);
    // No scale was invented for a count: the unscaled sheets stay unscaled.
    expect(onSheet(5).calibrationId).toBeNull();
    expect(onSheet(5).page.calibrations).toHaveLength(0);
    expect(onSheet(7).calibrationId).toBeNull();
    expect(onSheet(7).page.calibrations).toHaveLength(0);
  });

  it("the single save counts with no scale, a line is refused, and the database refuses an unscaled line itself", async () => {
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
    const points = JSON.stringify({ xs: [0.1, 0.2], ys: [0.1, 0.2] });
    const count = await saveTakeoffMeasurement(jobId, form({ planId, pageNumber: "9", kind: "COUNT", label: "floor drain", points }));
    expect(count.ok).toBe(true);
    const line = await saveTakeoffMeasurement(jobId, form({ planId, pageNumber: "9", kind: "LINEAR", points }));
    expect(line).toEqual({ ok: false, error: "Set the scale on this sheet before measuring it." });
    const page = await prisma.takeoffPlanPage.findUniqueOrThrow({ where: { planId_pageNumber: { planId, pageNumber: 9 } } });
    const direct = await saveTakeoffMeasurement(jobId, form({ pageId: page.id, kind: "AREA", points: JSON.stringify({ xs: [0.1, 0.2, 0.2], ys: [0.1, 0.1, 0.2] }) }));
    expect(direct).toEqual({ ok: false, error: "Set the scale on this sheet before measuring it." });
    await expect(prisma.takeoffMeasurement.create({ data: { pageId: page.id, kind: "LINEAR", xs: [0, 1], ys: [0, 1] } })).rejects.toThrow(/TakeoffMeasurement_scale_unless_count/);
  });

  it("a count on an unscaled sheet reads back through the workspace, not out of date", async () => {
    const loaded = await loadTakeoffWorkspace({ id: companyId }, job);
    const sheet = loaded?.sheets.find((p) => p.pageNumber === 9) ?? null;
    expect(sheet?.calibration).toBeNull();
    const row = sheet?.measurements.find((m) => m.label === "floor drain");
    expect(row?.calibration).toBeNull();
    expect(row?.outOfDate).toBe(false);
  });
  it("a named count becomes one item, however many sheets or saves it took", async () => {
    const across = await saveSymbolCountAcrossSheets(jobId, planId, { label: "ZZ Troffer", sheets: [{ pageNumber: 1, xs: [0.1, 0.2], ys: [0.1, 0.2] }, { pageNumber: 2, xs: [0.3], ys: [0.3] }] });
    expect(across.ok).toBe(true);
    const items = await prisma.takeoffItem.findMany({ where: { jobId, name: "ZZ Troffer" }, include: { measurements: true } });
    expect(items.map((i) => [i.type, i.measurements.length])).toEqual([["COUNT", 2]]);
  });
  it("refuses an empty label, a foreign item and an empty set", async () => {
    expect((await saveSymbolCountAcrossSheets(jobId, planId, { label: " ", sheets: [{ pageNumber: 3, xs: [0.1], ys: [0.1] }] })).ok).toBe(false);
    expect((await saveSymbolCountAcrossSheets(jobId, planId, { label: "x", itemId: "nope", sheets: [{ pageNumber: 3, xs: [0.1], ys: [0.1] }] })).ok).toBe(false);
    expect((await saveSymbolCountAcrossSheets(jobId, planId, { label: "x", sheets: [] })).ok).toBe(false);
  });
});
