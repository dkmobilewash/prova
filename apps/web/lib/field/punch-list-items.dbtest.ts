import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { createPunchListItems, JOB_NOT_FOUND, MAX_PUNCH_ITEMS, NO_DESCRIPTION } from "./punch-list-items";

/**
 * A whole list against a real Postgres, because "it writes N rows" is the
 * one claim a fake Prisma cannot make. The interesting cases are the ones a
 * unit test cannot see: that the rows are really there afterwards, in order,
 * attached to the job and the person; that a job in another company writes
 * nothing; and that a failure part-way through the list leaves NO rows,
 * which is the whole reason the create loop is inside a transaction.
 *
 * Scoped to its own company and torn down in afterAll, like
 * lib/ask/drafts.dbtest.ts. Run with vitest.db.config.mts against a scratch
 * or dev database — never production.
 */
let companyId = "";
let otherCompanyId = "";
let userId = "";
let jobId = "";
let otherCompanyJobId = "";

const THREE = ["Ceiling grid out of level, east corridor", "Missing corner bead at column B3", "Touch-up paint, stair 2"];

describe("createPunchListItems against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "PUNCH-CORE Co" } });
    companyId = company.id;
    const user = await prisma.user.create({
      data: {
        companyId,
        clerkId: `punch_core_${Date.now()}`,
        email: `punch_core_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    userId = user.id;
    const contact = await prisma.contact.create({ data: { companyId, name: "PUNCH-CORE Turner" } });
    const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "PUNCH-CORE job" } });
    jobId = job.id;

    const other = await prisma.company.create({ data: { name: "PUNCH-CORE Other Co" } });
    otherCompanyId = other.id;
    const otherContact = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "PUNCH-CORE GC" } });
    const otherJob = await prisma.job.create({
      data: { companyId: otherCompanyId, contactId: otherContact.id, name: "PUNCH-CORE other job" },
    });
    otherCompanyJobId = otherJob.id;
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      if (!id) continue;
      await prisma.punchListItem.deleteMany({ where: { companyId: id } });
      await prisma.job.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    }
  });

  it("writes one row per item, in order, attached to the job and the person who asked", async () => {
    const result = await createPunchListItems(companyId, jobId, { descriptions: THREE, raisedByUserId: userId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.items).toHaveLength(3);

    const rows = await prisma.punchListItem.findMany({
      where: { companyId, jobId },
      orderBy: { createdAt: "asc" },
      select: { id: true, description: true, isDone: true, completedAt: true, raisedByUserId: true },
    });
    expect(rows.map((row) => row.description)).toEqual(THREE);
    expect(rows.map((row) => row.id)).toEqual(result.value.items.map((item) => item.id));
    for (const row of rows) {
      expect(row.isDone).toBe(false);
      expect(row.completedAt).toBeNull();
      expect(row.raisedByUserId).toBe(userId);
    }
  });

  it("refuses a job in another company and writes nothing", async () => {
    const before = await prisma.punchListItem.count({ where: { companyId: otherCompanyId } });
    const result = await createPunchListItems(companyId, otherCompanyJobId, {
      descriptions: ["Should never exist"],
      raisedByUserId: userId,
    });
    expect(result).toEqual({ ok: false, error: JOB_NOT_FOUND });
    expect(await prisma.punchListItem.count({ where: { companyId: otherCompanyId } })).toBe(before);
    expect(await prisma.punchListItem.count({ where: { description: "Should never exist" } })).toBe(0);
  });

  it("refuses a list of nothing but blanks", async () => {
    expect(await createPunchListItems(companyId, jobId, { descriptions: ["  ", ""], raisedByUserId: userId })).toEqual({
      ok: false,
      error: NO_DESCRIPTION,
    });
  });

  it("leaves NO rows behind when a write part-way through the list fails", async () => {
    // The failure has to land on the SECOND item, or this proves nothing
    // about rollback — a list that fails on its first insert has nothing to
    // roll back. A NUL byte is a real per-row failure Postgres refuses
    // (22021, invalid byte sequence) while the row before it inserted
    // perfectly well, so the first item exists inside the transaction and
    // must not exist after it.
    const first = "PUNCH-CORE rollback marker";
    const before = await prisma.punchListItem.count({ where: { companyId } });

    await expect(
      createPunchListItems(companyId, jobId, {
        descriptions: [first, "second item with a \u0000 NUL in it"],
        raisedByUserId: userId,
      }),
    ).rejects.toThrow();

    expect(await prisma.punchListItem.count({ where: { companyId } })).toBe(before);
    expect(await prisma.punchListItem.count({ where: { description: first } })).toBe(0);
  });

  it("refuses more than the cap, and writes none of them", async () => {
    const before = await prisma.punchListItem.count({ where: { companyId } });
    const tooMany = Array.from({ length: MAX_PUNCH_ITEMS + 1 }, (_, i) => `PUNCH-CORE over cap ${i + 1}`);
    const result = await createPunchListItems(companyId, jobId, { descriptions: tooMany, raisedByUserId: userId });
    expect(result.ok).toBe(false);
    expect(await prisma.punchListItem.count({ where: { companyId } })).toBe(before);
  });
});
