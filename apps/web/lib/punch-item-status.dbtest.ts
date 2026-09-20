import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";

/**
 * What the DATABASE enforces about a punch item's state, against a real
 * Postgres — none of which a unit test can see.
 *
 * Three things live here and nowhere else:
 *
 *   - `isDone` and `completedAt` are derived from `status` by a trigger.
 *     CLAUDE.md's rule is that derived state is never stored; keeping the
 *     two columns was a deliberate trade (six readers outside this lane),
 *     and the trigger is what buys back the property the rule is about.
 *     A test that only went through the actions would pass with the
 *     trigger dropped, because the actions never write those columns.
 *   - the CHECK constraints: one assignee at most, no blank typed name,
 *     and no state without the witness that state claims.
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

  it("starts open, and open is not done", async () => {
    const item = await makeItem();
    expect(item.status).toBe("OPEN");
    expect(item.isDone).toBe(false);
    expect(item.completedAt).toBeNull();
  });

  it("derives isDone and completedAt from the status, on the way up and back down", async () => {
    const item = await makeItem();
    const readyAt = new Date("2026-09-18T15:00:00.000Z");

    const ready = await prisma.punchListItem.update({
      where: { id: item.id },
      data: { status: "READY_FOR_REVIEW", readyAt, readyByUserId: userId },
    });
    expect(ready.isDone).toBe(true);
    // When the work was finished, not when somebody got round to agreeing.
    expect(ready.completedAt?.toISOString()).toBe(readyAt.toISOString());

    const verified = await prisma.punchListItem.update({
      where: { id: item.id },
      data: { status: "VERIFIED", verifiedAt: new Date(), verifiedByUserId: userId },
    });
    expect(verified.isDone).toBe(true);
    expect(verified.completedAt?.toISOString()).toBe(readyAt.toISOString());

    const reopened = await prisma.punchListItem.update({
      where: { id: item.id },
      data: { status: "OPEN", readyAt: null, readyByUserId: null, verifiedAt: null, verifiedByUserId: null },
    });
    expect(reopened.isDone).toBe(false);
    expect(reopened.completedAt).toBeNull();
  });

  it("overrules a caller that writes isDone by hand — that column has an owner now", async () => {
    // The shape that matters: an old caller, or a new one written from
    // memory of how this table used to work, setting the boolean directly.
    // It does not get to disagree with the status.
    const item = await makeItem({ isDone: true, completedAt: new Date() });
    expect(item.status).toBe("OPEN");
    expect(item.isDone).toBe(false);
    expect(item.completedAt).toBeNull();

    const lied = await prisma.punchListItem.update({
      where: { id: item.id },
      data: { isDone: true },
    });
    expect(lied.isDone).toBe(false);
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

  it("backfills a ticked-off item to READY_FOR_REVIEW, not to VERIFIED", async () => {
    // The world before this migration, reproduced the only way it can be
    // now that the trigger owns `isDone`: switch the trigger off, write the
    // old shape, then run the migration's own UPDATE against it.
    //
    // READY_FOR_REVIEW rather than VERIFIED is the whole point. The old
    // checkbox meant "the crew says it is fixed" and nothing more, so
    // calling these verified would invent a witness for every item in
    // every database this ships to.
    const item = await makeItem();
    await prisma.$executeRawUnsafe(`ALTER TABLE "PunchListItem" DISABLE TRIGGER prova_punch_item_status_sync`);
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "PunchListItem" SET "isDone" = true, "completedAt" = '2026-09-01T12:00:00Z' WHERE id = $1`,
        item.id,
      );
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "PunchListItem" ENABLE TRIGGER prova_punch_item_status_sync`);
    }

    await prisma.$executeRawUnsafe(`
      UPDATE "PunchListItem"
      SET "status" = 'READY_FOR_REVIEW',
          "readyAt" = COALESCE("completedAt", "updatedAt")
      WHERE "isDone" = true
    `);

    const after = await prisma.punchListItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.status).toBe("READY_FOR_REVIEW");
    expect(after.readyAt?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    // And the constraint that refuses a state with no witness did not fire
    // on the backfill, which is what would have made the migration fail
    // halfway through somebody's production table.
    expect(after.isDone).toBe(true);
  });
});
