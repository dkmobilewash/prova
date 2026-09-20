import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";

/**
 * What the DATABASE enforces about a punch item's state, against a real
 * Postgres — none of which a unit test can see.
 *
 *   - the CHECK constraints: one assignee at most, no blank typed name,
 *     and no state without the witness that state claims. Those last two
 *     are what replaced `isDone`/`completedAt`: when the work was finished
 *     is `readyAt`, and it cannot disagree with `status` because a state
 *     without its stamp is refused outright.
 *   - that the two dropped columns are really gone. A migration that
 *     "removes" a column the app has stopped writing but the table still
 *     has looks identical from the app, and the next person to read the
 *     table finds a stale boolean nobody maintains.
 *   - the migration's BACKFILL, which is the one piece of this change that
 *     runs exactly once against real rows and can never be re-run.
 */

let companyId = "";
let jobId = "";
let userId = "";

async function makeItem(data: Record<string, unknown> = {}) {
  return prisma.punchListItem.create({
    data: { companyId, jobId, description: "Grid out of level", ...data },
  });
}

describe("a punch item's state, as the database keeps it", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Punch Co" } });
    companyId = company.id;
    const user = await prisma.user.create({
      data: {
        companyId,
        clerkId: `pu_${Date.now()}`,
        email: `pu_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    userId = user.id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Punch Job" } })).id;
  });

  afterAll(async () => {
    await prisma.punchListItem.deleteMany({ where: { companyId } });
    await prisma.backcharge.deleteMany({ where: { companyId } });
    await prisma.backchargeCounter.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("starts open", async () => {
    const item = await makeItem();
    expect(item.status).toBe("OPEN");
    expect(item.readyAt).toBeNull();
    expect(item.verifiedAt).toBeNull();
  });

  it("no longer has the two columns that stored what the status already says", async () => {
    // The assertion that the drop happened, rather than that the app
    // stopped writing them — those look the same from TypeScript, and only
    // one of them stops the next reader finding a stale boolean.
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'PunchListItem' AND column_name IN ('isDone', 'completedAt')`,
    );
    expect(columns).toEqual([]);
  });

  it("carries the state and its stamps, on the way up and back down", async () => {
    const item = await makeItem();
    const readyAt = new Date("2026-09-18T15:00:00.000Z");

    const ready = await prisma.punchListItem.update({
      where: { id: item.id },
      data: { status: "READY_FOR_REVIEW", readyAt, readyByUserId: userId },
    });
    expect(ready.status).toBe("READY_FOR_REVIEW");
    // When the work was finished, which is what `completedAt` used to hold.
    expect(ready.readyAt?.toISOString()).toBe(readyAt.toISOString());

    const verified = await prisma.punchListItem.update({
      where: { id: item.id },
      data: { status: "VERIFIED", verifiedAt: new Date(), verifiedByUserId: userId },
    });
    expect(verified.status).toBe("VERIFIED");
    // Still the crew's finish time, not the sign-off's.
    expect(verified.readyAt?.toISOString()).toBe(readyAt.toISOString());

    const reopened = await prisma.punchListItem.update({
      where: { id: item.id },
      data: { status: "OPEN", readyAt: null, readyByUserId: null, verifiedAt: null, verifiedByUserId: null },
    });
    expect(reopened.status).toBe("OPEN");
    expect(reopened.readyAt).toBeNull();
  });

  it("refuses a state with no witness for it", async () => {
    await expect(makeItem({ status: "READY_FOR_REVIEW" })).rejects.toThrow(/ready_has_time/i);
    await expect(makeItem({ status: "VERIFIED" })).rejects.toThrow(/verified_has_witness/i);
  });

  it("refuses two answers to who is fixing it, and a blank one", async () => {
    await expect(makeItem({ assignedUserId: userId, assignedName: "Mike" })).rejects.toThrow(
      /one_assignee/i,
    );
    await expect(makeItem({ assignedName: "   " })).rejects.toThrow(/assigned_name_not_blank/i);

    // One at a time is fine, which is the other half of the assertion — a
    // constraint that refused everything would pass the two lines above.
    const byName = await makeItem({ assignedName: "Ramirez Drywall" });
    expect(byName.assignedName).toBe("Ramirez Drywall");
    const byUser = await makeItem({ assignedUserId: userId });
    expect(byUser.assignedUserId).toBe(userId);
  });

  it("keeps the item when the backcharge it was evidence for is deleted", async () => {
    const backcharge = await prisma.backcharge.create({
      data: {
        companyId,
        jobId,
        number: 1,
        description: "Cleanup after another trade",
        claimedAmount: "1200.00",
        issuedOn: new Date("2026-09-10T00:00:00.000Z"),
      },
    });
    const item = await makeItem({
      causedByOthers: true,
      responsibleParty: "OTHER_TRADE",
      backchargeId: backcharge.id,
    });

    await prisma.backcharge.delete({ where: { id: backcharge.id } });

    const after = await prisma.punchListItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.backchargeId).toBeNull();
    // The evidence itself outlives the deduction it was attached to.
    expect(after.causedByOthers).toBe(true);
    expect(after.responsibleParty).toBe("OTHER_TRADE");
  });

  it("backfills a ticked-off item to READY_FOR_REVIEW, not to VERIFIED, and keeps its date", async () => {
    // The world before this migration, reproduced the only way it can be
    // once the columns are gone: put them back on a scratch table, write
    // the old shape, and run the migration's own statements against it.
    //
    // READY_FOR_REVIEW rather than VERIFIED is the whole point. The old
    // checkbox meant "the crew says it is fixed" and nothing more, so
    // calling these verified would invent a witness for every item in
    // every database this ships to. And the order matters as much: the
    // backfill reads `completedAt`, so a migration that dropped first
    // would silently reopen every closed item in the table.
    await prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE punch_backfill_probe AS
      SELECT id, "updatedAt", 'OPEN'::text AS status, NULL::timestamp AS "readyAt",
             true AS "isDone", timestamp '2026-09-01 12:00:00' AS "completedAt"
      FROM "PunchListItem" LIMIT 1
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE punch_backfill_probe
      SET status = 'READY_FOR_REVIEW',
          "readyAt" = COALESCE("completedAt", "updatedAt")
      WHERE "isDone" = true
    `);

    const [row] = await prisma.$queryRawUnsafe<{ status: string; readyAt: Date }[]>(
      `SELECT status, "readyAt" FROM punch_backfill_probe`,
    );
    expect(row.status).toBe("READY_FOR_REVIEW");
    expect(row.readyAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });
});
