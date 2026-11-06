import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The guided takeoff by voice, against a real Postgres: "how many linear feet
 * of S6A on Baker" reads the proposal's own scope rows, "what's left to review"
 * reads the queue the stepper counts, and "set S6B walls to 15 feet" writes
 * through the queue's own Set height, after which the first read follows.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { HANDLERS } = await import("../handlers");
const { loadReviewQueue } = await import("@/lib/takeoff/reviewQueueQuery");
const { setWallHeightCommand } = await import("./takeoff");

let companyId = "", jobId = "", s6bItem = "";
const ctx = () => ({ companyId, userId: context.id, principal: { role: "OWNER" as const, jobFunction: null }, today: "2026-11-06" });

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "ASK-TAKEOFF-REVIEW Co" } });
  companyId = context.company.id = company.id;
  const user = await prisma.user.create({ data: { companyId, clerkId: `atr_${Date.now()}`, email: `atr_${Date.now()}@example.test`, role: "OWNER" } });
  context.id = user.id;
  const gc = await prisma.contact.create({ data: { companyId, name: "ASK-TAKEOFF-REVIEW GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: "ASK-TAKEOFF-REVIEW Baker", status: "ESTIMATE" } })).id;
  // One sheet 100 ft wide; a run `feet` long along it.
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101", pageWidthPt: 2592 } });
  const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0.1, x2: 1, y2: 0.1, declaredDistanceFeet: "100" } });
  const run = (itemId: string, feet: number, y: number) =>
    prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", source: "DETECTED", xs: [0, feet / 100], ys: [y, y], itemId } });
  const component = { components: { create: [{ description: "studs", basis: "LINEAR_FT" as const, factor: 1 }] } };
  const s6a = await prisma.wallType.create({ data: { companyId, code: "S6A", name: "6in stud, board both sides", defaultHeightFt: 10, sides: 2, ...component } });
  const s6b = await prisma.wallType.create({ data: { companyId, code: "S6B", name: "6in stud, one layer each side", sides: 2, ...component } });
  const a = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "S6A walls", type: "LINEAR", colorHex: "#111111", wallTypeId: s6a.id } });
  const b = await prisma.takeoffItem.create({ data: { companyId, jobId, name: "S6B walls", type: "LINEAR", colorHex: "#222222", wallTypeId: s6b.id } });
  s6bItem = b.id;
  await run(a.id, 30, 0.3);
  await run(a.id, 20, 0.4);
  await run(b.id, 25, 0.5);
  // One line with neither a price nor a cost: the queue asks for it.
  await prisma.jobLineItem.create({ data: { jobId, description: "Hang, tape and finish", quantity: 100, unit: "SF" } });
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { companyId } } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { companyId } } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { companyId } } });
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("the guided takeoff by voice", () => {
  it("how many linear feet of S6A: the scope row, matched however the code was said", async () => {
    const result = await HANDLERS.takeoff_quantities(companyId, { jobName: "takeoff-review baker", wallType: "s6a" });
    expect(result.unavailable).toBeUndefined();
    expect(result.data).toEqual({ job: "ASK-TAKEOFF-REVIEW Baker", wallTypes: [{ wallType: "S6A", name: "6in stud, board both sides", linearFeet: 50, squareFeet: 1000, heightFt: 10, inPrice: false }] });
    // No estimate line is written for S6A here, so it is measured and not in the price: off the GC's scope.
  });

  it("a type not on the takeoff is said so, with the types that are — never a zero", async () => {
    const result = await HANDLERS.takeoff_quantities(companyId, { jobName: "takeoff-review baker", wallType: "W9" });
    expect(result.unavailable).toMatch(/No walls .* typed W9\. Typed so far: S6A, S6B/);
  });

  it("what's left to review: the stepper's queue, by kind", async () => {
    const result = await HANDLERS.takeoff_review(companyId, { jobName: "takeoff-review baker" });
    const data = result.data as { total: number; left: { what: string; count: number; examples: string[] }[]; open: string };
    expect(data.total).toBe((await loadReviewQueue(companyId, jobId)).items.length);
    expect(data.left.find((k) => k.what === "estimate lines with no cost or price")).toMatchObject({ count: 1, examples: ["Hang, tape and finish: 100 SF"] });
    expect(data.open).toBe(`/takeoff/${jobId}?open=review`);
  });

  it("set S6B walls to 15 feet: the card shows it, the tap writes it, and the feet read follows", async () => {
    const card = await setWallHeightCommand.resolve(ctx(), { jobName: "takeoff-review baker", wallType: "s6b", height: "15 feet" });
    if (card.kind !== "ready") throw new Error(`expected ready, got ${JSON.stringify(card)}`);
    expect(card.preview.find((l) => l.label === "S6B walls")?.value).toBe("no height → 15 ft (1 wall)");
    // Resolving writes nothing.
    expect((await prisma.takeoffItem.findUniqueOrThrow({ where: { id: s6bItem } })).heightFt).toBeNull();

    const done = await setWallHeightCommand.execute(ctx(), card.resolved);
    expect(done).toMatchObject({ ok: true });
    expect(Number((await prisma.takeoffItem.findUniqueOrThrow({ where: { id: s6bItem } })).heightFt)).toBe(15);
    const after = await HANDLERS.takeoff_quantities(companyId, { jobName: "takeoff-review baker", wallType: "S6B" });
    expect(after.data).toMatchObject({ wallTypes: [{ wallType: "S6B", linearFeet: 25, squareFeet: 750, heightFt: 15 }] });
  });

  it("a type with no walls on the takeoff is refused with the queue to go to", async () => {
    const card = await setWallHeightCommand.resolve(ctx(), { jobName: "takeoff-review baker", wallType: "W9", height: "12" });
    expect(card).toMatchObject({ kind: "refuse", href: `/takeoff/${jobId}?open=review` });
  });
});
