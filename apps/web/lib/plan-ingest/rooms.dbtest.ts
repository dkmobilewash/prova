import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { roomsForSheet } from "./rooms";
import { wholeSetSummary } from "./walls";
/**
 * Rooms and ceilings after whole-set walls, on a scratch database and the
 * fixture sheet: the gates (switch off, no walls, already done) and the real
 * path once — a rectangle of found walls on `plan-sheet.pdf` becomes ONE
 * room on the "Rooms" item with `source: ROOM_FINDER`, and the summary says so.
 */
process.env.TAKEOFF_LOCAL_PLAN_DIR = `${process.cwd()}/e2e/fixtures`;
let companyId = "";
let jobId = "";
let planId = "";
let pageId = "";
let calibrationId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Rooms After Walls Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Rooms Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan-sheet.pdf", fileName: "plan-sheet.pdf" } });
  planId = plan.id;
  await prisma.planSheetText.create({ data: { planId, pageNumber: 1, hasTextLayer: true, widthPt: 200, heightPt: 200 } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } });
  pageId = page.id;
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  calibrationId = cal.id;
});
const ask = () => roomsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null });
describe("rooms after walls", () => {
  it("is skipped while room finding is off", async () => {
    expect(await ask()).toEqual({ kind: "skipped", why: "room finding is off" });
  });
  it("is skipped on a sheet with no walls found", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { roomFinderOn: true } });
    expect(await ask()).toEqual({ kind: "skipped", why: "no walls found" });
  });
  it("WRITES THE ROOM once walls close one, and the summary counts it", async () => {
    // A 30 x 20 ft rectangle of walls, page-width units at 100 ft per unit.
    const runs = [
      { x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.2, thicknessFeet: 0.5 },
      { x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.4, thicknessFeet: 0.5 },
      { x1: 0.5, y1: 0.4, x2: 0.2, y2: 0.4, thicknessFeet: 0.5 },
      { x1: 0.2, y1: 0.4, x2: 0.2, y2: 0.2, thicknessFeet: 0.5 },
    ];
    await prisma.takeoffWallProposal.create({ data: { pageId, calibrationId, thicknessInches: 6, source: "REMAINDER", runs } });
    const outcome = await ask();
    expect(outcome.kind, JSON.stringify(outcome)).toBe("written");
    if (outcome.kind !== "written") return;
    expect(outcome.rooms).toBe(1);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId, source: "ROOM_FINDER" }, include: { item: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("AREA");
    expect(rows[0]!.item?.name).toBe("Rooms");
    const summary = await wholeSetSummary(planId, companyId, 3);
    const row = summary.find((r) => r.pageNumber === 1);
    expect(row?.status.kind).toBe("walls");
    if (row?.status.kind === "walls") expect(row.status.rooms).toBe(1);
  });
  it("never writes twice", async () => {
    expect(await ask()).toEqual({ kind: "skipped", why: "rooms already on the sheet" });
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, source: "ROOM_FINDER" } })).toBe(1);
  });
});
