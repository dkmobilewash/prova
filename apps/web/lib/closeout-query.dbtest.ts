import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Click-list test 2, executed against a real Postgres.
 *
 * The assertion it exists for: **an open punch item holds closeout open
 * even when "punch list sign-off" is ticked.** That is the headline claim
 * of the readiness feature, and until now nothing executed it. The unit
 * suite covered `closeoutReadiness` with inputs a test wrote by hand; the
 * step that turns real punch rows into those inputs lived inline in the
 * page and could not be run at all.
 *
 * So this is not a duplicate of the unit test. It is the half that was
 * missing: that the query READS the rows it claims to.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadCloseoutJobs } = await import("./closeout-query");

const TODAY = "2026-09-02";
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let companyId = "";
let userId = "";
let jobId = "";

const REQUIRED = ["Final unconditional lien waiver", "Punch list sign-off"];

async function job() {
  const rows = await loadCloseoutJobs(companyId, TODAY);
  return rows.find((r) => r.id === jobId)!;
}

describe("closeout readiness, composed from real rows", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Closeout Query Test Co" } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `cq_${Date.now()}`,
        email: `cq_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const j = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Readiness Job" },
    });
    companyId = company.id;
    userId = user.id;
    jobId = j.id;
  });

  afterAll(async () => {
    await prisma.punchListItem.deleteMany({ where: { jobId } });
    await prisma.closeoutSubmission.deleteMany({ where: { companyId } });
    await prisma.closeoutSubmissionCounter.deleteMany({ where: { jobId } });
    await prisma.closeoutItem.deleteMany({ where: { companyId } });
    await prisma.retainageRelease.deleteMany({ where: { jobId } });
    await prisma.invoice.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("treats a job with no checklist as not ready, never as complete", async () => {
    const row = await job();
    expect(row.readiness.stage).toBe("NOT_READY");
    expect(row.readiness.blockers.map((b) => b.kind)).toEqual(["NO_CHECKLIST"]);
  });

  it("is ready to submit once every required item is done", async () => {
    await prisma.closeoutItem.createMany({
      data: REQUIRED.map((name) => ({ companyId, jobId, name, isRequired: true })),
    });
    expect((await job()).readiness.stage).toBe("NOT_READY");

    await prisma.closeoutItem.updateMany({ where: { jobId }, data: { completedOn: utc("2026-09-01") } });
    const row = await job();
    expect(row.readiness.stage).toBe("READY_TO_SUBMIT");
    expect(row.readiness.blockers).toEqual([]);
  });

  it("an OPEN PUNCH ITEM holds closeout open even with sign-off ticked", async () => {
    // The assertion the whole feature rests on, and the one the click-list
    // calls step 5. "Punch list sign-off" is complete from the test above;
    // the punch rows say otherwise, and the real data has to win.
    await prisma.punchListItem.create({
      data: { companyId, jobId, description: "Open item", isDone: false, raisedByUserId: userId },
    });

    const row = await job();
    expect(row.openPunchItems).toBe(1);
    expect(row.readiness.stage).toBe("NOT_READY");
    expect(row.readiness.blockers.map((b) => b.kind)).toEqual(["OPEN_PUNCH_ITEMS"]);
    expect(row.readiness.blockers[0].count).toBe(1);

    // And the checklist still claims it is signed off, which is the point:
    // the contradiction is visible rather than resolved in favour of the
    // tickbox.
    expect(row.items.every((i) => i.completedOn !== null)).toBe(true);
  });

  it("returns to ready when the punch item is done", async () => {
    await prisma.punchListItem.updateMany({
      where: { jobId },
      data: { isDone: true, completedAt: utc("2026-09-02") },
    });
    expect((await job()).readiness.stage).toBe("READY_TO_SUBMIT");
  });

  it("carries the retainage balance through the one implementation of that sum", async () => {
    await prisma.invoice.create({
      data: { jobId, number: 1, amount: "100000", retainageWithheld: "10000", issuedAt: utc("2026-07-01") },
    });
    expect((await job()).readiness.retainageAtStake).toBe(10000);

    await prisma.retainageRelease.create({
      data: { jobId, amount: "4000", releasedAt: utc("2026-08-20") },
    });
    // Withheld minus released — not a second sum written here.
    expect((await job()).readiness.retainageAtStake).toBe(6000);
  });

  it("moves to With the GC once a package is submitted, and counts the days", async () => {
    await prisma.closeoutSubmission.create({
      data: { companyId, jobId, attempt: 1, submittedOn: utc("2026-08-12"), status: "SUBMITTED" },
    });
    const row = await job();
    expect(row.readiness.stage).toBe("AWAITING_GC");
    expect(row.readiness.daysWithGc).toBe(21);
  });

  it("keeps an accepted package accepted when a callback arrives afterwards", async () => {
    await prisma.closeoutSubmission.updateMany({
      where: { jobId },
      data: { status: "ACCEPTED", respondedOn: utc("2026-08-20") },
    });
    await prisma.warrantyServiceRequest.create({
      data: { companyId, jobId, reportedOn: utc("2026-08-28"), description: "Sticking door" },
    });

    const row = await job();
    // A callback the week after acceptance is warranty work, not something
    // that un-closes the closeout.
    expect(row.readiness.stage).toBe("ACCEPTED");
    expect(row.readiness.blockers.map((b) => b.kind)).toEqual(["OPEN_CALLBACKS"]);

    await prisma.warrantyServiceRequest.deleteMany({ where: { jobId } });
  });
});
