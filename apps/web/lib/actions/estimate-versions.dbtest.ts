import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Issue #289, against a real Postgres: EstimateVersion.versionNumber comes
 * from a counter row, not from MAX(versionNumber) + 1 read outside a
 * transaction.
 *
 * WHY THIS NEEDS A DATABASE. The defect was a race between two callers,
 * and a race is exactly what a mocked client cannot have. The old code read
 * the highest surviving version and added one; two people saving a
 * checkpoint on one job at once both read the same max and the second
 * violated @@unique([jobId, versionNumber]). Measured on this harness
 * before the fix: 49 of 50 rounds at two concurrent saves, 50 of 50 at
 * three. `saveEstimateVersion` returns void and does not catch, so that
 * throw reached the person as a redacted production digest.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it — CI has no
 * database for the unit job. Run it against a SCRATCH one, same invocation
 * as billing.dbtest.ts documents.
 */

const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { saveEstimateVersion } = await import("./estimating");

function form(note = "") {
  const fd = new FormData();
  fd.set("note", note);
  return fd;
}

describe("EstimateVersion numbers come from a counter — issue #289", () => {
  const ctx = { companyId: "" };

  /** A pre-award job: saveEstimateVersion is gated on ESTIMATE status by
   * assertEditableDirectly, which is the whole point of a checkpoint — it
   * records what the estimate said before the scope moved. */
  async function newJob(name: string) {
    const contact = await prisma.contact.create({ data: { companyId: ctx.companyId, name: `${name} GC` } });
    const job = await prisma.job.create({
      data: { companyId: ctx.companyId, contactId: contact.id, name, status: "ESTIMATE" },
    });
    return job.id;
  }

  const versionsOf = async (jobId: string) =>
    (
      await prisma.estimateVersion.findMany({
        where: { jobId },
        orderBy: { versionNumber: "asc" },
        select: { versionNumber: true },
      })
    ).map((v) => v.versionNumber);

  const counterOf = (jobId: string) => prisma.estimateVersionCounter.findUnique({ where: { jobId } });

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Estimate Version Counter Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: "clerk_estimate_version",
        email: "estimate-version@test.example",
        role: "OWNER",
      },
    });
    context.id = user.id;
  });

  afterAll(async () => {
    const jobs = await prisma.job.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    await prisma.estimateVersion.deleteMany({ where: { jobId: { in: jobIds } } });
    // The counter is a RESTRICT child of Job that deleting the versions does
    // not reach — the #227 shape, and the reason this line exists at all.
    await prisma.estimateVersionCounter.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.user.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
  });

  it("issues version 1, then 2, and records the counter alongside", async () => {
    const jobId = await newJob("Sequential Job");

    await saveEstimateVersion(jobId, form("before the backsplash"));
    await saveEstimateVersion(jobId, form("after the backsplash"));

    expect(await versionsOf(jobId)).toEqual([1, 2]);
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 2 });
  });

  it("two people saving at once BOTH get a version — the bug this replaced", async () => {
    // THE CASE #289 IS ABOUT. Under MAX(versionNumber) + 1 this lost one of
    // the two saves to P2002 in 49 of 50 rounds, as a redacted digest.
    const jobId = await newJob("Concurrent Job");

    const results = await Promise.allSettled([
      saveEstimateVersion(jobId, form("tab A")),
      saveEstimateVersion(jobId, form("tab B")),
    ]);

    // Both settled, neither rejected — asserted before the numbers, because
    // a rejection is the failure this test exists for and it must be named
    // as one rather than showing up as a short array.
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await versionsOf(jobId)).toEqual([1, 2]);
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 2 });
  });

  it("survives a wider burst without losing or duplicating a number", async () => {
    // Four at once, the shape that was 50 of 50 broken before.
    const jobId = await newJob("Burst Job");

    const results = await Promise.allSettled(
      ["w", "x", "y", "z"].map((n) => saveEstimateVersion(jobId, form(n))),
    );

    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    const versions = await versionsOf(jobId);
    expect(versions).toEqual([1, 2, 3, 4]);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("does not reissue a number after the row it belonged to is removed", async () => {
    // Nothing in the PRODUCT deletes an EstimateVersion — this is reached
    // here through prisma directly. The case is kept anyway because it pins
    // what the counter guarantees, so a delete path added later cannot
    // quietly reintroduce the half of the defect that is currently
    // unreachable.
    const jobId = await newJob("No Reissue Job");
    await saveEstimateVersion(jobId, form("one"));
    await saveEstimateVersion(jobId, form("two"));

    const v2 = await prisma.estimateVersion.findFirstOrThrow({ where: { jobId, versionNumber: 2 } });
    await prisma.estimateVersion.delete({ where: { id: v2.id } });

    await saveEstimateVersion(jobId, form("three"));

    expect(await versionsOf(jobId)).toEqual([1, 3]);
  });

  it("a failed insert does not burn a version number — the bump and the insert are one transaction", async () => {
    // The case #283 learned the hard way: a mutation moving the bump
    // outside the transaction survives every other test here, because the
    // upsert is atomic by itself and nothing collides. The difference only
    // shows when the INSERT fails — inside the transaction the bump rolls
    // back, outside it the number is burned and the versions gain a hole.
    // The insert is failed by naming a user who does not exist, which trips
    // EstimateVersion_createdByUserId_fkey.
    const jobId = await newJob("Burned Number Job");
    await saveEstimateVersion(jobId, form("one"));
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 1 });

    const realUserId = context.id;
    context.id = "user_that_does_not_exist";
    try {
      await expect(saveEstimateVersion(jobId, form("doomed"))).rejects.toThrow();
    } finally {
      context.id = realUserId;
    }

    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 1 });
    expect(await versionsOf(jobId)).toEqual([1]);

    // And the next real save is 2, not 3 — no hole.
    await saveEstimateVersion(jobId, form("two"));
    expect(await versionsOf(jobId)).toEqual([1, 2]);
  });
});

/**
 * The migration, exercised as the file that will actually run.
 *
 * The SQL is READ FROM DISK rather than restated here: a copy of it in a
 * test proves the copy works. `migrate deploy` has already applied it to
 * this database; what is checked is the BACKFILL, against jobs whose
 * versions were created without a counter — which is exactly the state
 * every existing job is in when the migration runs.
 */
describe("the counter migration backfills from the versions already saved — issue #289", () => {
  const ctx = { companyId: "" };
  let backfillSql = "";

  async function jobWithVersions(name: string, versions: number[]) {
    const contact = await prisma.contact.create({ data: { companyId: ctx.companyId, name: `${name} GC` } });
    const job = await prisma.job.create({
      data: { companyId: ctx.companyId, contactId: contact.id, name, status: "ESTIMATE" },
    });
    for (const versionNumber of versions) {
      await prisma.estimateVersion.create({
        data: { jobId: job.id, versionNumber, snapshot: [] },
      });
    }
    return job.id;
  }

  const counterOf = (jobId: string) => prisma.estimateVersionCounter.findUnique({ where: { jobId } });

  /** Puts this company's jobs back into the state the migration actually
   * finds them in — versions saved, no counter row — and runs the shipped
   * backfill against that.
   *
   * The real statement has no ON CONFLICT and does not need one: it runs
   * once, against a table the same migration has just created. Re-running
   * it three times is an artifact of testing it three times, so the reset
   * belongs here rather than as a weakening of the SQL. */
  async function runBackfillFromScratch() {
    const jobs = await prisma.job.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
    await prisma.estimateVersionCounter.deleteMany({ where: { jobId: { in: jobs.map((j) => j.id) } } });
    await prisma.$executeRawUnsafe(backfillSql);
  }

  beforeEach(async () => {
    // Nothing to reset before the first test; harmless after it.
    if (ctx.companyId) {
      const jobs = await prisma.job.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
      await prisma.estimateVersionCounter.deleteMany({ where: { jobId: { in: jobs.map((j) => j.id) } } });
    }
  });

  beforeAll(async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      new URL(
        "../../../../packages/db/prisma/schema/migrations/20260916170000_add_estimate_version_counter/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    // The file has to be the real one: an empty or wrong read would make
    // every assertion below pass against nothing.
    expect(sql).toContain('INSERT INTO "EstimateVersionCounter"');
    // Only the backfill is re-runnable — the CREATE TABLE ran once already.
    backfillSql = sql.slice(sql.indexOf('INSERT INTO "EstimateVersionCounter"'));
    expect(backfillSql).toContain("MAX(\"versionNumber\")");

    const company = await prisma.company.create({ data: { name: "Estimate Backfill Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    // This block saves a version through the real action, and
    // createdByUserId is a foreign key — the previous block's user is gone
    // by now, so this one needs its own.
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: "clerk_estimate_backfill",
        email: "estimate-backfill@test.example",
        role: "OWNER",
      },
    });
    context.id = user.id;
  });

  afterAll(async () => {
    const jobs = await prisma.job.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    await prisma.estimateVersion.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.estimateVersionCounter.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.user.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
  });

  it("starts an existing job's counter at its highest saved version", async () => {
    // Without this, the job issues 1 on its next save and collides with its
    // own history — the reason every counter migration in this repo carries
    // a backfill.
    const jobId = await jobWithVersions("Existing Versions Job", [1, 2, 3]);
    expect(await counterOf(jobId)).toBeNull();

    await runBackfillFromScratch();

    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 3 });
  });

  it("invents no counter for a job that has never saved a version", async () => {
    const jobId = await jobWithVersions("No Versions Job", []);

    await runBackfillFromScratch();

    expect(await counterOf(jobId)).toBeNull();
  });

  it("leaves a backfilled job issuing the next number, not a colliding one", async () => {
    const jobId = await jobWithVersions("Backfilled Job", [1, 2]);

    await runBackfillFromScratch();
    await saveEstimateVersion(jobId, form("after the backfill"));

    const versions = (
      await prisma.estimateVersion.findMany({
        where: { jobId },
        orderBy: { versionNumber: "asc" },
        select: { versionNumber: true },
      })
    ).map((v) => v.versionNumber);
    expect(versions).toEqual([1, 2, 3]);
  });
});
