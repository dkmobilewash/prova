import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * ADDING A GROUP OF FOUND WALLS — all of them, or none.
 *
 * ── WHY THIS NEEDS A DATABASE ──
 *
 * The claim is about ROWS: that a hundred-odd runs arrive together, carry the
 * sheet's current calibration, and that a batch with one bad shape in it writes
 * NOTHING. The wall finder returns 143 runs on a real sheet and 542 on another,
 * so "some of my walls arrived" is a state an estimator could easily be left in
 * — and would have no way to detect, because a partly-added group looks exactly
 * like a group.
 *
 * `lib/fake-prisma.ts` cannot express `createMany`, and faking it would only
 * prove the fake behaves as expected.
 *
 * NOT RUN LOCALLY by the session that wrote it is NOT true of this file: it was
 * run against a throwaway Postgres 16 before being committed, and CI's `dbtest`
 * job runs it again. Said plainly because "I wrote a test" and "a test ran" are
 * different claims.
 *
 * Named `.dbtest.ts` so the ordinary suite does not collect it. Runs against a
 * SCRATCH database — `vitest.db.setup.mts` refuses anything that is not
 * localhost or a unix socket.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { saveTakeoffMeasurements } = await import("./takeoff");

let companyId = "";
let jobId = "";
let pageId = "";
let calibrationId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Found Walls Test Co" } });
  companyId = company.id;
  context.company.id = companyId;

  // A REAL user row: `createdByUserId` is a foreign key, and the first run of
  // this file found out the honest way — `Foreign key constraint violated on
  // TakeoffMeasurement_createdByUserId_fkey`. A mocked context with an empty id
  // is not a user.
  const owner = await prisma.user.create({
    data: {
      companyId,
      clerkId: `walls_${Date.now()}`,
      email: `walls_${Date.now()}@example.test`,
      role: "OWNER",
    },
  });
  context.id = owner.id;

  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Found Walls Job", status: "ESTIMATE" },
  });
  jobId = job.id;

  const plan = await prisma.takeoffPlan.create({
    data: { companyId, jobId, fileUrl: "https://example.test/sheet.pdf" },
  });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } });
  pageId = page.id;

  // Full page width = 100 ft, so a run across 0.2 of it is 20 ft and the
  // arithmetic below stays checkable by hand.
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" },
  });
  calibrationId = calibration.id;
});

afterAll(async () => {
  // CHILDREN FIRST, in this exact order, and every line of it was found the
  // honest way — one failing constraint at a time: `User_companyId_fkey`, then
  // `Contact_companyId_fkey`. These are RESTRICT children, not cascades, which
  // is the same shape CLAUDE.md records for `InvoiceCounter` and the reason
  // both cleanup scripts keep an explicit delete order rather than trusting a
  // parent delete to reach everything under it.
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

function body(shapes: { xs: number[]; ys: number[] }[], label = '4-7/8" wall') {
  const form = new FormData();
  form.set("pageId", pageId);
  form.set("label", label);
  for (const shape of shapes) form.append("shape", JSON.stringify(shape));
  return form;
}

const run = (y: number) => ({ xs: [0.1, 0.3], ys: [y, y] });

describe("adding a group of found walls", () => {
  it("writes every run in the group, with the sheet's calibration", async () => {
    const result = await saveTakeoffMeasurements(jobId, body([run(0.1), run(0.2), run(0.3)]));
    expect(result).toEqual({ ok: true });

    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId }, orderBy: { ys: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "LINEAR")).toBe(true);
    expect(rows.every((r) => r.calibrationId === calibrationId)).toBe(true);
    // The label is what the measurement list shows and what an estimator picks
    // a wall type for — a group added as one thing reads as one thing.
    expect(rows.every((r) => r.label === '4-7/8" wall')).toBe(true);
    await prisma.takeoffMeasurement.deleteMany({ where: { pageId } });
  });

  it("WRITES NOTHING when one shape in the batch is bad", async () => {
    // The property the whole action exists for. A partly-added group is
    // indistinguishable from a complete one, so the estimator would bid short
    // with nothing on screen looking wrong.
    const result = await saveTakeoffMeasurements(
      jobId,
      body([run(0.1), { xs: [0.1], ys: [0.1] }, run(0.3)]),
    );
    expect(result.ok).toBe(false);
    expect(await prisma.takeoffMeasurement.count({ where: { pageId } })).toBe(0);
  });

  it("NAMES the run that failed, so somebody knows which one to look at", async () => {
    const result = await saveTakeoffMeasurements(jobId, body([run(0.1), { xs: [0.1], ys: [0.1] }]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Wall 2 of 2");
  });

  it("refuses a run drawn off the sheet", async () => {
    // 0..1 is the page. `verticesProblem` owns this rule; the batch must not
    // bypass it just because the shapes came from a geometry library rather
    // than a person's clicks.
    const result = await saveTakeoffMeasurements(jobId, body([{ xs: [0, 20], ys: [0, 0] }]));
    expect(result.ok).toBe(false);
    expect(await prisma.takeoffMeasurement.count({ where: { pageId } })).toBe(0);
  });

  it("refuses an empty batch rather than reporting a silent success", async () => {
    const result = await saveTakeoffMeasurements(jobId, body([]));
    expect(result.ok).toBe(false);
  });

  it("refuses a sheet on another company's job", async () => {
    const other = await prisma.company.create({ data: { name: "Someone Else Ltd" } });
    context.company.id = other.id;
    const result = await saveTakeoffMeasurements(jobId, body([run(0.1)]));
    context.company.id = companyId;
    expect(result.ok).toBe(false);
    expect(await prisma.takeoffMeasurement.count({ where: { pageId } })).toBe(0);
    await prisma.company.deleteMany({ where: { id: other.id } });
  });

  it("refuses a sheet with no scale, because there is no calibration to point at", async () => {
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId } });
    const bare = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 2 } });
    const form = new FormData();
    form.set("pageId", bare.id);
    form.append("shape", JSON.stringify(run(0.1)));
    const result = await saveTakeoffMeasurements(jobId, form);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Set the scale");
  });
});
