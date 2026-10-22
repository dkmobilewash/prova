import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The two room actions against a throwaway Postgres: the switch is owner-only
 * and writes `Company.roomFinderOn`; the save refuses while the switch is off,
 * refuses a bad polygon by name, and lands every room in one transaction as an
 * AREA with `source: ROOM_FINDER` and the tag's name and number.
 *
 * Named `.dbtest.ts` so the ordinary suite does not collect it; runs under
 * `vitest.db.config.mts`, which refuses anything that is not a scratch database.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { saveRoomFinderSwitch, saveRoomMeasurements } = await import("./roomFinder");

let companyId = "";
let jobId = "";
let pageId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Rooms Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({
    data: { companyId, clerkId: `rooms_${Date.now()}`, email: `rooms_${Date.now()}@example.test`, role: "OWNER" },
  });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Rooms Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "https://example.test/sheet.pdf" } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } });
  pageId = page.id;
  await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
});

afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { jobId } } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

const square = (x: number, y: number, size: number) => ({ xs: [x, x + size, x + size, x], ys: [y, y, y + size, y + size] });
const body = (rooms: unknown[]) => {
  const form = new FormData();
  form.set("pageId", pageId);
  form.set("rooms", JSON.stringify(rooms));
  return form;
};

describe("saveRoomFinderSwitch", () => {
  it("refuses a member, and an owner turns it on and off", async () => {
    context.role = "MEMBER";
    const on = new FormData();
    on.set("roomFinderOn", "on");
    const refused = await saveRoomFinderSwitch(on);
    expect(refused.ok).toBe(false);
    context.role = "OWNER";
    expect((await saveRoomFinderSwitch(on)).ok).toBe(true);
    expect((await prisma.company.findUnique({ where: { id: companyId } }))?.roomFinderOn).toBe(true);
    expect((await saveRoomFinderSwitch(new FormData())).ok).toBe(true);
    expect((await prisma.company.findUnique({ where: { id: companyId } }))?.roomFinderOn).toBe(false);
  });
});

describe("saveRoomMeasurements", () => {
  it("refuses while the switch is off", async () => {
    const result = await saveRoomMeasurements(jobId, body([{ ...square(0.1, 0.1, 0.1), label: "A", roomName: "A", roomNumber: "1" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("off");
  });

  it("names the bad polygon and writes nothing", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { roomFinderOn: true } });
    const result = await saveRoomMeasurements(
      jobId,
      body([
        { ...square(0.1, 0.1, 0.1), label: "OFFICE 101", roomName: "OFFICE", roomNumber: "101" },
        { xs: [0, 0.1], ys: [0, 0], label: "LINE", roomName: null, roomNumber: null },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Room 2");
    expect(await prisma.takeoffMeasurement.count({ where: { pageId } })).toBe(0);
  });

  it("lands every room as an AREA from the room finder, with the tag", async () => {
    const result = await saveRoomMeasurements(
      jobId,
      body([
        { ...square(0.1, 0.1, 0.1), label: "OFFICE 101", roomName: "OFFICE", roomNumber: "101" },
        { ...square(0.3, 0.1, 0.1), label: "Room 2", roomName: null, roomNumber: null },
      ]),
    );
    expect(result).toEqual({ ok: true });
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, orderBy: { label: "asc" } });
    expect(rows.map((r) => [r.kind, r.source, r.label, r.roomName, r.roomNumber])).toEqual([
      ["AREA", "ROOM_FINDER", "OFFICE 101", "OFFICE", "101"],
      ["AREA", "ROOM_FINDER", "Room 2", null, null],
    ]);
  });
});

describe("saveRoomMeasurements with ceilings", () => {
  it("stores the five ceiling columns as sent, and refuses a type it does not know, writing nothing", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { roomFinderOn: true } });
    const before = await prisma.takeoffMeasurement.count({ where: { pageId } });
    const bad = await saveRoomMeasurements(
      jobId,
      body([{ ...square(0.5, 0.5, 0.05), label: "X", roomName: "X", roomNumber: "9", ceiling: { family: "TIN", code: null, heightFeet: 9, from: "tag", guess: false } }]),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("TIN");
    expect(await prisma.takeoffMeasurement.count({ where: { pageId } })).toBe(before);
    const good = await saveRoomMeasurements(
      jobId,
      body([
        { ...square(0.5, 0.5, 0.05), label: "STORAGE 106", roomName: "STORAGE", roomNumber: "106", ceiling: { family: "GYP", code: "GB", heightFeet: 10, from: "tag", guess: false } },
        { ...square(0.7, 0.5, 0.05), label: "ELEC 011B", roomName: "ELEC", roomNumber: "011B", ceiling: { family: "ACT", code: "AC01", heightFeet: 11, from: "prefix", guess: true } },
        { ...square(0.7, 0.7, 0.05), label: "HALL", roomName: "HALL", roomNumber: null, ceiling: null },
      ]),
    );
    expect(good.ok).toBe(true);
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId, roomNumber: { in: ["106", "011B"] } }, orderBy: { roomNumber: "asc" } });
    expect(rows.map((r) => [r.roomNumber, r.ceilingFamily, r.ceilingCode, r.ceilingHeightFeet, r.ceilingFrom, r.ceilingGuess])).toEqual([
      ["011B", "ACT", "AC01", 11, "prefix", true],
      ["106", "GYP", "GB", 10, "tag", false],
    ]);
    const hall = await prisma.takeoffMeasurement.findFirst({ where: { pageId, roomName: "HALL" } });
    expect(hall?.ceilingFamily ?? null).toBeNull();
    expect(hall?.ceilingGuess).toBe(false);
  });
});
