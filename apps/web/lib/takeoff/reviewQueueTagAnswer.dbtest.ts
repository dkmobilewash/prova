import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { loadReviewQueue } from "./reviewQueueQuery";
import { UNTYPED_ITEM } from "./untypedItem";

// "Tag 2A = W2", answered once: the next group detected with tag 2A on this job is offered W2,
// read back from what was typed (`answeredTagTypes`) — nothing stored, so an Undo forgets it.
let companyId = "", jobId = "", planId = "";
const run = (y: number) => ({ x1: 0.1, y1: y, x2: 0.6, y2: y, thicknessFeet: 5 / 12 });
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Tag Answer Co" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Tag Answer Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  const w2 = await prisma.wallType.create({ data: { companyId, code: "W2", name: "Partition W2", thicknessIn: 5 } });
  await prisma.wallType.create({ data: { companyId, code: "W1", name: "Partition W1", thicknessIn: 5 } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 5 } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffWallProposal.createMany({ data: [
    { pageId: page.id, calibrationId: cal.id, thicknessInches: 5, source: "TAG", sourceLabel: "2A", namedCode: "2A", runs: [run(0.2)] },
    { pageId: page.id, calibrationId: cal.id, thicknessInches: 5, source: "TAG", sourceLabel: "2A", namedCode: "2A", runs: [run(0.4)] },
    { pageId: page.id, calibrationId: cal.id, thicknessInches: 5, source: "TAG", sourceLabel: "3B", namedCode: "3B", runs: [run(0.6)] },
  ] });
  const typed = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "W2 walls", type: "LINEAR", colorHex: "#22c55e", wallTypeId: w2.id } });
  const untyped = await prisma.takeoffItem.create({ data: { companyId, jobId, name: UNTYPED_ITEM, type: "LINEAR", colorHex: "#9ca3af" } });
  const m = (y: number, itemId: string) => ({ pageId: page.id, kind: "LINEAR" as const, source: "DETECTED" as const, xs: [0.1, 0.6], ys: [y, y], itemId, calibrationId: cal.id });
  await prisma.takeoffMeasurement.createMany({ data: [m(0.2, typed.id), m(0.4, untyped.id), m(0.6, untyped.id)] });
});
afterAll(async () => {
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("a printed tag answered once is offered again for this job", () => {
  it("the open 2A group is pre-filled W2 from the answer; 3B, never answered, carries its tag and no type", async () => {
    const types = (await loadReviewQueue(companyId, jobId)).items.filter((i) => i.kind === "type");
    const byTag = Object.fromEntries(types.map((i) => [i.kind === "type" ? i.tag : "", i.kind === "type" ? i.suggested : null]));
    expect(byTag["2A"]).toMatchObject({ code: "W2", from: "your answer for tag 2A on this job" });
    expect(byTag["3B"]).toBeNull();
  });
});
