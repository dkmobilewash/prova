import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { loadAddendumChanges } from "./addendumChanges";

/**
 * The newest plan file against the sheets it replaces, on a real database:
 * A101 issued twice, one wall kept, one gone, one new; A102 revised with no
 * scale yet; A103 a new sheet.
 */
let companyId = "";
let jobId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Addendum Co" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Addendum Job", status: "ESTIMATE" } })).id;
  // A page width is 100 ft on both issues.
  const cal = { x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" };

  const first = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:bid.pdf", fileName: "bid.pdf", createdAt: new Date(Date.now() - 86_400_000) } });
  const oldA101 = await prisma.takeoffPlanPage.create({ data: { planId: first.id, pageNumber: 3, label: "A101" } });
  await prisma.takeoffPlanPage.create({ data: { planId: first.id, pageNumber: 4, label: "A102" } });
  const oldCal = await prisma.takeoffScaleCalibration.create({ data: { pageId: oldA101.id, ...cal } });
  const s6a = await prisma.wallType.create({ data: { companyId, code: "S6A", name: "6in stud", sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
  const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "S6A walls", type: "LINEAR", colorHex: "#111111", wallTypeId: s6a.id, heightFt: "10", sides: 2 } });
  // Kept: 30 ft. Gone: 20 ft. 50 ft on the job, priced at $1,000 → $20 a foot.
  await prisma.takeoffMeasurement.create({ data: { pageId: oldA101.id, calibrationId: oldCal.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.4], ys: [0.2, 0.2], itemId: item.id } });
  await prisma.takeoffMeasurement.create({ data: { pageId: oldA101.id, calibrationId: oldCal.id, kind: "LINEAR", source: "DETECTED", xs: [0.1, 0.3], ys: [0.5, 0.5], itemId: item.id } });
  await prisma.jobLineItem.create({ data: { jobId, takeoffItemId: item.id, description: "S6A studs", quantity: "50", unit: "lin ft", unitPrice: "20" } });

  const addendum = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:add1.pdf", fileName: "add1.pdf", revisionLabel: "Addendum 1" } });
  const newA101 = await prisma.takeoffPlanPage.create({ data: { planId: addendum.id, pageNumber: 1, label: "A-101" } });
  await prisma.takeoffPlanPage.create({ data: { planId: addendum.id, pageNumber: 2, label: "A102" } });
  await prisma.takeoffPlanPage.create({ data: { planId: addendum.id, pageNumber: 5, label: "A103" } });
  const newCal = await prisma.takeoffScaleCalibration.create({ data: { pageId: newA101.id, ...cal } });
  // The finder's walls on the revised A101: the kept wall, and a new 12 ft one.
  await prisma.takeoffWallProposal.create({ data: { pageId: newA101.id, calibrationId: newCal.id, thicknessInches: 6, source: "REMAINDER", runs: [{ x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.2, thicknessFeet: 0.5 }, { x1: 0.6, y1: 0.7, x2: 0.72, y2: 0.7, thicknessFeet: 0.5 }] } });
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffWallProposal.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { jobId } } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("loadAddendumChanges", () => {
  it("each revised sheet against the one it replaces, and the change by wall type with LF, SF and $", async () => {
    const changes = await loadAddendumChanges(companyId, jobId);
    expect(changes?.planLabel).toBe("Addendum 1");
    expect(changes?.sheets).toEqual([
      { pageNumber: 1, sheetNumber: "A-101", replaces: { label: "bid.pdf", pageNumber: 3 }, status: "compared", runs: 2, matched: 1 },
      { pageNumber: 2, sheetNumber: "A102", replaces: { label: "bid.pdf", pageNumber: 4 }, status: "no scale", runs: 0, matched: 0 },
      { pageNumber: 5, sheetNumber: "A103", replaces: null, status: "new sheet", runs: 0, matched: 0 },
    ]);
    const rows = changes!.rows.map((r) => ({ ...r, oldFt: Math.round(r.oldFt), newFt: Math.round(r.newFt), deltaFt: Math.round(r.deltaFt), deltaSqFt: r.deltaSqFt === null ? null : Math.round(r.deltaSqFt), deltaDollars: r.deltaDollars === null ? null : Math.round(r.deltaDollars) }));
    expect(rows).toEqual([
      // 50 → 30 ft: −20 LF × 10 ft × 2 faces = −400 SF, at $20 a foot = −$400.
      { itemId: expect.any(String), code: "S6A", name: "S6A walls", oldFt: 50, newFt: 30, deltaFt: -20, deltaSqFt: -400, deltaDollars: -400 },
      { itemId: null, code: null, name: "New walls, no type yet", oldFt: 0, newFt: 12, deltaFt: 12, deltaSqFt: null, deltaDollars: null },
    ]);
  });

  it("a job whose newest file replaces nothing has no changes to show", async () => {
    const other = await prisma.job.create({ data: { companyId, contactId: (await prisma.contact.findFirstOrThrow({ where: { companyId } })).id, name: "One file", status: "ESTIMATE" } });
    await prisma.takeoffPlan.create({ data: { companyId, jobId: other.id, fileUrl: "local:x.pdf", fileName: "x.pdf" } });
    expect(await loadAddendumChanges(companyId, other.id)).toBeNull();
    await prisma.takeoffPlan.deleteMany({ where: { jobId: other.id } });
    await prisma.job.delete({ where: { id: other.id } });
  });
});
