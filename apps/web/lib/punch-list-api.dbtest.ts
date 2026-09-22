import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@prova/db";

/**
 * The phone's punch list endpoints against a real Postgres, and in
 * particular the REPLAY — a queued write arriving more than once.
 *
 * The case that matters here only exists against a real database: two
 * requests carrying the same idempotency key, overlapping, so both pass the
 * "have I seen this key?" read before either inserts. Production did that
 * on 2026-09-20 when the phone ran two flushes at once, and the loser came
 * back as a 500 — `P2002: Unique constraint failed on
 * (companyId, clientOperationId)` — on a request whose entire purpose is to
 * be safely repeatable. A fake Prisma cannot fail that way, which is why
 * this is a dbtest and not a unit test.
 */

const context = {
  company: { id: "" },
  companyId: "",
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
  requireApiContext: async () => context,
}));

const collection = await import("@/app/api/v1/jobs/[id]/punch-list/route");
const item = await import("@/app/api/v1/jobs/[id]/punch-list/[itemId]/route");

let jobId = "";

function post(body: Record<string, unknown>) {
  const request = new NextRequest(`http://test/api/v1/jobs/${jobId}/punch-list`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return collection.POST(request, { params: Promise.resolve({ id: jobId }) });
}

function patch(itemId: string, body: Record<string, unknown>) {
  const request = new NextRequest(`http://test/api/v1/jobs/${jobId}/punch-list/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return item.PATCH(request, { params: Promise.resolve({ id: jobId, itemId }) });
}

describe("the punch list endpoints the phone talks to", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Queue Co" } });
    context.company.id = company.id;
    context.companyId = company.id;
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `q_${Date.now()}`,
        email: `q_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    context.id = owner.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Queue Job" } })).id;
  });

  afterAll(async () => {
    await prisma.punchListItem.deleteMany({ where: { companyId: context.companyId } });
    await prisma.job.deleteMany({ where: { companyId: context.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: context.companyId } });
    await prisma.user.deleteMany({ where: { companyId: context.companyId } });
    await prisma.company.delete({ where: { id: context.companyId } });
    await prisma.$disconnect();
  });

  it("creates the item once, however many times the same queued write arrives", async () => {
    const first = await post({ description: "Grid out of level", area: "L3", clientOperationId: "op_a" });
    expect(first.status).toBe(201);

    const replay = await post({ description: "Grid out of level", area: "L3", clientOperationId: "op_a" });
    expect(replay.status).toBe(200);

    expect(await prisma.punchListItem.count({ where: { jobId, clientOperationId: "op_a" } })).toBe(1);
  });

  it("survives two replays landing AT THE SAME TIME — the 500 seen on production", async () => {
    // Both requests are in flight before either has inserted, which is what
    // makes the read-then-insert check insufficient on its own. Neither may
    // 500; the loser reads back the winner's row.
    const [a, b] = await Promise.all([
      post({ description: "Corner bead missing", clientOperationId: "op_b" }),
      post({ description: "Corner bead missing", clientOperationId: "op_b" }),
    ]);

    expect([a.status, b.status].filter((s) => s >= 500)).toEqual([]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await prisma.punchListItem.count({ where: { jobId, clientOperationId: "op_b" } })).toBe(1);
  });

  it("takes a status change and stamps who said it was ready", async () => {
    const created = await (await post({ description: "Door rubs", clientOperationId: "op_c" })).json();

    const res = await patch(created.id, { status: "READY_FOR_REVIEW" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "READY_FOR_REVIEW" });

    const row = await prisma.punchListItem.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.readyByUserId).toBe(context.id);
    expect(row.readyAt).toBeInstanceOf(Date);
  });

  it("replays a status change without complaint — setting it twice is the same row", async () => {
    const created = await (await post({ description: "Trim gap", clientOperationId: "op_d" })).json();
    expect((await patch(created.id, { status: "READY_FOR_REVIEW" })).status).toBe(200);
    // The queue carries no idempotency key for a status change precisely
    // because of this: a repeat is not a duplicate, it is the same answer.
    expect((await patch(created.id, { status: "READY_FOR_REVIEW" })).status).toBe(200);
    expect(await prisma.punchListItem.count({ where: { jobId, clientOperationId: "op_d" } })).toBe(1);
  });

  it("still takes the old {isDone} body from a build that predates the split", async () => {
    const created = await (await post({ description: "Old build", clientOperationId: "op_e" })).json();
    const res = await patch(created.id, { isDone: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "READY_FOR_REVIEW" });
  });

  it("refuses to reopen a verified item from the phone, where no reason can be given", async () => {
    const created = await (await post({ description: "Verified one", clientOperationId: "op_f" })).json();
    await prisma.punchListItem.update({
      where: { id: created.id },
      data: { status: "VERIFIED", verifiedAt: new Date(), verifiedByUserId: context.id },
    });

    const res = await patch(created.id, { status: "OPEN" });
    expect(res.status).toBe(409);
    expect((await prisma.punchListItem.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("VERIFIED");
  });
});
