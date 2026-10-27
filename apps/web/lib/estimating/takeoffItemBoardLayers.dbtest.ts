import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { STARTER_TYPES } from "@/lib/wall-type-starters";
import { syncTakeoffItemLines } from "@/lib/estimating/takeoff-item-lines";

/**
 * A TRACED wall and a wall RUN of the same type must count the same board.
 * `syncTakeoffItemLines` prices takeoff items through `componentRunQuantity`
 * with the assembly's own `boardLayers`; if it handed in no answer, an
 * estimate built from traced walls would stay at one layer while the same
 * type's runs doubled. Against a real Postgres, SCRATCH only.
 *
 * Found by mutation: replacing the item path's `{ boardLayers:
 * assembly.boardLayers }` with `{ boardLayers: null }` left every test in the
 * repo green, because nothing exercised the item path with an answer.
 */

const t = `tibl_${Date.now()}`;
let companyId = "";
let jobId = "";
let typeId = "";

async function itemQuantities(): Promise<Record<string, number>> {
  const lines = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false, takeoffItemId: { not: null } } });
  return Object.fromEntries(lines.map((line) => [line.description.replace(/^.* — /, ""), Number(line.quantity)]));
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `TIBL ${t}` } })).id;
  const gc = await prisma.contact.create({ data: { companyId, name: `GC ${t}` } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: `Traced ${t}`, status: "ESTIMATE" } })).id;
  const w2 = STARTER_TYPES.find((type) => type.code === "W2")!;
  typeId = (
    await prisma.wallType.create({
      data: { companyId, code: `W2${t}`.toUpperCase(), name: w2.name, components: { create: w2.parts.map((part, sortOrder) => ({ ...part, sortOrder })) } },
    })
  ).id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:tibl.pdf", fileName: "tibl.pdf" } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A-101", pageWidthPt: 200 } });
  // Half the page width is 50 ft, so the whole width is 100 ft.
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: page.id, x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.5, declaredDistanceFeet: "50" },
  });
  const item = await prisma.takeoffItem.create({
    data: { companyId, jobId, name: "Corridor", type: "LINEAR", colorHex: "#facc15", heightFt: "10", sides: 2, wallTypeId: typeId },
  });
  // A 50 ft trace.
  await prisma.takeoffMeasurement.create({
    data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0.1, 0.6], ys: [0.3, 0.3], itemId: item.id },
  });
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { companyId } } } });
  await prisma.takeoffItem.deleteMany({ where: { companyId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { companyId } } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { companyId } } });
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.wallTypeComponent.deleteMany({ where: { wallType: { companyId } } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe("a traced wall follows its assembly's board layers", () => {
  it("unanswered prices one layer; two layers doubles the board and nothing else", async () => {
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId));
    const before = await itemQuantities();
    // 50 ft × 10 ft × 2 sides = 1,000 sq ft boarded; finish and batt are not per layer.
    expect(before["Hang, tape and finish ⅝″ board"]).toBe(1000);
    expect(before["R-13 batt insulation"]).toBe(500);
    const sheetsBefore = before["⅝″ Type X board, 4x8 sheets"]!;
    expect(sheetsBefore).toBeGreaterThan(0);

    await prisma.wallType.update({ where: { id: typeId }, data: { boardLayers: 2 } });
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId));
    const after = await itemQuantities();

    // 1,000 × factor × 2 × 1.10, rounded up once — about twice the one-layer count.
    expect(after["⅝″ Type X board, 4x8 sheets"]).toBeGreaterThanOrEqual(2 * sheetsBefore - 1);
    expect(after["⅝″ Type X board, 4x8 sheets"]).toBeLessThanOrEqual(2 * sheetsBefore);
    expect({ ...after, "⅝″ Type X board, 4x8 sheets": 0 }).toEqual({ ...before, "⅝″ Type X board, 4x8 sheets": 0 });
  });

  it("`onlyItemIds` re-derives THOSE items' lines and nothing else: another item's lines stay, an unsent item stays off", async () => {
    // A second item, of an assembly with one part, already on the estimate…
    const other = await prisma.wallType.create({
      data: { companyId, code: `B${t}`.toUpperCase(), name: "base", components: { create: [{ description: "Base trim", unit: "lin ft", basis: "LINEAR_FT" }] } },
    });
    const page = await prisma.takeoffPlanPage.findFirstOrThrow({ where: { plan: { companyId } } });
    const calibration = await prisma.takeoffScaleCalibration.findFirstOrThrow({ where: { pageId: page.id } });
    const trace = async (name: string, wallTypeId: string) => {
      const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name, type: "LINEAR", colorHex: "#facc15", wallTypeId } });
      await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0.1, 0.3], ys: [0.6, 0.6], itemId: item.id } });
      return item.id;
    };
    await trace("Base, sent", other.id);
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId)); // the job-wide Send
    // …and a third item traced AFTER the Send, never sent.
    await trace("Base, unsent", other.id);
    const before = await itemQuantities();
    expect(before["Base trim"]).toBe(20);

    const corridor = await prisma.takeoffItem.findFirstOrThrow({ where: { companyId, name: "Corridor" } });
    await prisma.wallType.update({ where: { id: typeId }, data: { boardLayers: 1 } });
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId, [corridor.id]));

    const after = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false, takeoffItemId: { not: null } }, select: { description: true } });
    const names = after.map((line) => line.description.split(" — ")[0]);
    expect(names.filter((name) => name === "Base, sent")).toHaveLength(1); // not retired
    expect(names.filter((name) => name === "Base, unsent")).toHaveLength(0); // not created
    // …and the one it was asked about DID move: 2 layers (from the test above) back to 1.
    // 1,000 sq ft × 0.0313 × 1.10 = 34.43 → 35, from 68.86 → 69.
    expect(before["⅝″ Type X board, 4x8 sheets"]).toBe(69);
    expect((await itemQuantities())["⅝″ Type X board, 4x8 sheets"]).toBe(35);
  });
});
