import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { hasInclusionsAndExclusions, loadGcProposal } from "./gc-proposal";

/**
 * What the GC reads beside the price, against a real database: the scope by
 * wall type from the takeoff (the same geometry the estimate lines are priced
 * from), the clauses grouped in print order, and the terms on file.
 */

const made: string[] = [];
afterAll(async () => {
  for (const companyId of made) {
    await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { companyId } } } });
    await prisma.takeoffItem.deleteMany({ where: { companyId } });
    await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { companyId } } } });
    await prisma.takeoffPlanPage.deleteMany({ where: { plan: { companyId } } });
    await prisma.takeoffPlan.deleteMany({ where: { companyId } });
    await prisma.jobProposalClause.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.wallType.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

async function job(contact: { paymentTermsDays?: number; defaultRetainagePercent?: string } = {}, retainagePercent?: string) {
  const company = await prisma.company.create({ data: { name: `GC Proposal ${made.length}` } });
  made.push(company.id);
  const gc = await prisma.contact.create({ data: { companyId: company.id, name: "GC Proposal GC", ...contact } });
  const row = await prisma.job.create({ data: { companyId: company.id, contactId: gc.id, name: "GC Proposal Job", status: "ESTIMATE", ...(retainagePercent ? { retainagePercent } : {}) } });
  return { companyId: company.id, jobId: row.id };
}

/** One sheet whose page width is 100 ft, and a run along it `feet` long. */
async function sheet(companyId: string, jobId: string) {
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
  const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "100" } });
  return async (itemId: string, feet: number, y: number) =>
    prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0, feet / 100], ys: [y, y], itemId } });
}

describe("loadGcProposal", () => {
  it("scope by wall type: linear feet, square feet from the height and sides, untyped walls as feet only", async () => {
    const { companyId, jobId } = await job();
    const run = await sheet(companyId, jobId);
    const w1 = await prisma.wallType.create({ data: { companyId, code: "W1", name: "Steel stud, board both sides", defaultHeightFt: 10, sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
    const p1 = await prisma.wallType.create({ data: { companyId, code: "PL1", name: "Plaster, one face", defaultHeightFt: 12, sides: 1, components: { create: [{ description: "lath", basis: "FACE_SQFT", factor: 1 }] } } });
    const w1Item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "W1 walls", type: "LINEAR", colorHex: "#111111", wallTypeId: w1.id } });
    const p1Item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "PL1 walls", type: "LINEAR", colorHex: "#222222", wallTypeId: p1.id } });
    const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "Walls — untyped", type: "LINEAR", colorHex: "#888888" } });
    await run(w1Item.id, 30, 0.3);
    await run(w1Item.id, 20, 0.4);
    await run(p1Item.id, 25, 0.5);
    await run(untyped.id, 12, 0.6);

    const { scope } = await loadGcProposal(companyId, jobId);
    expect(scope).toEqual([
      // PL1 sorts before W1; 25 ft × 12 ft × one face.
      { code: "PL1", name: "Plaster, one face", linearFt: 25, squareFeet: 300, heightFt: 12 },
      // Two runs of one type are one row: 50 ft × 10 ft × 2 sides.
      { code: "W1", name: "Steel stud, board both sides", linearFt: 50, squareFeet: 1000, heightFt: 10 },
      { code: null, name: "Walls with no type yet", linearFt: 12, squareFeet: null, heightFt: null },
    ]);
  });

  it("an item's own height wins over its type's default", async () => {
    const { companyId, jobId } = await job();
    const run = await sheet(companyId, jobId);
    const w1 = await prisma.wallType.create({ data: { companyId, code: "W1", name: "Partition", defaultHeightFt: 10, sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "W1 walls", type: "LINEAR", colorHex: "#111111", wallTypeId: w1.id, heightFt: "15" } });
    await run(item.id, 40, 0.3);
    expect((await loadGcProposal(companyId, jobId)).scope).toEqual([{ code: "W1", name: "Partition", linearFt: 40, squareFeet: 1200, heightFt: 15 }]);
  });

  it("clauses grouped in print order, and the terms on file — the job's retainage over the GC's default", async () => {
    const { companyId, jobId } = await job({ paymentTermsDays: 30, defaultRetainagePercent: "10" }, "5");
    await prisma.jobProposalClause.createMany({
      data: [
        { companyId, jobId, kind: "EXCLUSION", text: "Fire caulking" },
        { companyId, jobId, kind: "INCLUSION", text: "Framing and board per the wall types" },
        { companyId, jobId, kind: "EXCLUSION", text: "Paint" },
      ],
    });
    const proposal = await loadGcProposal(companyId, jobId);
    expect(proposal.clauses).toEqual([
      { kind: "INCLUSION", heading: "Inclusions", texts: ["Framing and board per the wall types"] },
      { kind: "EXCLUSION", heading: "Exclusions", texts: ["Fire caulking", "Paint"] },
    ]);
    expect(proposal.terms).toEqual({ paymentTermsDays: 30, retainagePercent: "5" });
    expect(proposal.scope).toEqual([]);
  });

  it("no terms on file reads as none, and a GC's default retainage stands when the job has none", async () => {
    const bare = await job();
    expect((await loadGcProposal(bare.companyId, bare.jobId)).terms).toEqual({ paymentTermsDays: null, retainagePercent: null });
    const gcDefault = await job({ defaultRetainagePercent: "10" });
    expect((await loadGcProposal(gcDefault.companyId, gcDefault.jobId)).terms).toEqual({ paymentTermsDays: null, retainagePercent: "10" });
  });
});

describe("hasInclusionsAndExclusions", () => {
  it("needs one of each", () => {
    expect(hasInclusionsAndExclusions([])).toBe(false);
    expect(hasInclusionsAndExclusions([{ kind: "INCLUSION" }])).toBe(false);
    expect(hasInclusionsAndExclusions([{ kind: "INCLUSION" }, { kind: "CLARIFICATION" }])).toBe(false);
    expect(hasInclusionsAndExclusions([{ kind: "INCLUSION" }, { kind: "EXCLUSION" }])).toBe(true);
  });
});
