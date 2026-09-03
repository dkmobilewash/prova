import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The backcharge lifecycle, executed against a real Postgres.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it — CI has no
 * database. Run it against a SCRATCH one (it creates and deletes
 * companies), exactly as integrations.dbtest.ts documents:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * It is here because the guards that matter on this feature are guards
 * about ROWS — a number that must never be reissued, an amount that must
 * stop being editable once we have answered — and none of them can be
 * checked by reading a return value. This project has already shipped a
 * card that could never show a number and an action that returned ok while
 * the page showed nothing; "the action returned ok" is not a result.
 *
 * Only the auth boundary and revalidatePath are faked. The actions, Prisma,
 * the transaction and the schema are real.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const {
  createBackcharge,
  deleteBackcharge,
  disputeBackcharge,
  reopenBackcharge,
  resolveBackcharge,
  updateBackcharge,
} = await import("./backcharges");

let jobId = "";
let otherCompanyJobId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function newBackcharge(overrides: Record<string, string> = {}) {
  return form({
    jobId,
    category: "CLEANUP",
    description: "Level 3 corridor cleanup",
    claimedAmount: "4200",
    issuedOn: "2026-08-10",
    receivedOn: "2026-08-14",
    respondByDate: "2026-08-24",
    ...overrides,
  });
}

async function latest() {
  const row = await prisma.backcharge.findFirst({
    where: { jobId },
    orderBy: { number: "desc" },
  });
  if (!row) throw new Error("no backcharge found");
  return row;
}

describe("backcharges against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Backcharge Test Co" } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `bc_test_${Date.now()}`,
        email: `bc_owner_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    const contact = await prisma.contact.create({
      data: { companyId: company.id, name: "Test GC" },
    });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Backcharge Test Job" },
    });
    context.company.id = company.id;
    context.id = user.id;
    jobId = job.id;

    // A second company's job, to prove the company scope is enforced by the
    // action rather than only by which links the UI renders.
    const other = await prisma.company.create({ data: { name: "Someone Else Ltd" } });
    const otherContact = await prisma.contact.create({
      data: { companyId: other.id, name: "Their GC" },
    });
    const otherJob = await prisma.job.create({
      data: { companyId: other.id, contactId: otherContact.id, name: "Not ours" },
    });
    otherCompanyJobId = otherJob.id;
  });

  afterAll(async () => {
    const otherJob = await prisma.job.findUnique({ where: { id: otherCompanyJobId } });
    await prisma.backcharge.deleteMany({ where: { companyId: context.company.id } });
    await prisma.backchargeCounter.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    if (otherJob) {
      await prisma.backcharge.deleteMany({ where: { jobId: otherCompanyJobId } });
      await prisma.job.delete({ where: { id: otherCompanyJobId } });
      await prisma.contact.deleteMany({ where: { companyId: otherJob.companyId } });
      await prisma.company.delete({ where: { id: otherJob.companyId } });
    }
    await prisma.$disconnect();
  });

  it("writes a row with the dates as entered, not as stamped", async () => {
    expect(await createBackcharge(newBackcharge())).toEqual({ ok: true });

    const row = await latest();
    expect(row.number).toBe(1);
    expect(Number(row.claimedAmount)).toBe(4200);
    expect(row.status).toBe("RECEIVED");
    // Backdated on purpose. A stamped issue date would make the response
    // window this record exists to evidence a fiction.
    expect(row.issuedOn.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(row.receivedOn?.toISOString()).toBe("2026-08-14T00:00:00.000Z");
    expect(row.loggedByUserId).toBe(context.id);
    expect(revalidated).toContain("/backcharges");
  });

  it("refuses a job belonging to another company", async () => {
    const result = await createBackcharge(newBackcharge({ jobId: otherCompanyJobId }));
    expect(result).toEqual({ ok: false, error: "Job not found" });
    expect(await prisma.backcharge.count({ where: { jobId: otherCompanyJobId } })).toBe(0);
  });

  it("refuses dates that contradict each other", async () => {
    expect(await createBackcharge(newBackcharge({ receivedOn: "2026-08-01" }))).toEqual({
      ok: false,
      error: "We can't have received it before the GC issued it",
    });
    expect(await createBackcharge(newBackcharge({ claimedAmount: "0" }))).toEqual({
      ok: false,
      error: "Amount claimed has to be more than $0",
    });
    // Neither attempt burned a number.
    expect((await latest()).number).toBe(1);
  });

  it("never reissues a number, even after the highest row is deleted", async () => {
    expect(await createBackcharge(newBackcharge({ description: "Second" }))).toEqual({ ok: true });
    const second = await latest();
    expect(second.number).toBe(2);

    expect(await deleteBackcharge(second.id)).toEqual({ ok: true });
    expect(await prisma.backcharge.findUnique({ where: { id: second.id } })).toBeNull();

    expect(await createBackcharge(newBackcharge({ description: "Third" }))).toEqual({ ok: true });
    // 3, not 2. max(number)+1 would have reissued 2 here, and a GC quoting
    // "backcharge 2" would then be pointing at two different deductions.
    expect((await latest()).number).toBe(3);
  });

  it("records the objection with its own date and locks the claimed amount", async () => {
    const row = await latest();
    expect(
      await disputeBackcharge(
        row.id,
        form({ disputeReason: "Debris was the demo contractor's", disputedOn: "2026-08-20" }),
      ),
    ).toEqual({ ok: true });

    const disputed = await prisma.backcharge.findUniqueOrThrow({ where: { id: row.id } });
    expect(disputed.status).toBe("DISPUTED");
    expect(disputed.disputedOn?.toISOString()).toBe("2026-08-20T00:00:00.000Z");

    // The edit form renders these read-only once we have answered; the
    // action has to refuse them too, or the savings figure is computed
    // against an amount nobody ever claimed.
    const attempt = await updateBackcharge(
      row.id,
      form({
        category: "CLEANUP",
        description: "Level 3 corridor cleanup",
        claimedAmount: "999",
        issuedOn: "2026-08-10",
      }),
    );
    expect(attempt.ok).toBe(false);
    expect(Number((await prisma.backcharge.findUniqueOrThrow({ where: { id: row.id } })).claimedAmount)).toBe(
      4200,
    );
  });

  it("refuses a second objection to something already answered", async () => {
    const row = await latest();
    expect(await disputeBackcharge(row.id, form({ disputeReason: "Again" }))).toEqual({
      ok: false,
      error: "This backcharge has already been answered.",
    });
  });

  it("will not let a settlement exceed or equal the claim", async () => {
    const row = await latest();
    const over = await resolveBackcharge(
      row.id,
      form({ outcome: "SETTLED", resolvedAmount: "5000", resolvedOn: "2026-08-28" }),
    );
    expect(over.ok).toBe(false);

    const equal = await resolveBackcharge(
      row.id,
      form({ outcome: "SETTLED", resolvedAmount: "4200", resolvedOn: "2026-08-28" }),
    );
    expect(equal.ok).toBe(false);

    expect((await prisma.backcharge.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("DISPUTED");
  });

  it("will not resolve something before it was objected to", async () => {
    const row = await latest();
    expect(
      await resolveBackcharge(
        row.id,
        form({ outcome: "SETTLED", resolvedAmount: "1500", resolvedOn: "2026-08-15" }),
      ),
    ).toEqual({ ok: false, error: "It can't have been resolved before we objected to it." });
  });

  it("settles at the negotiated figure", async () => {
    const row = await latest();
    expect(
      await resolveBackcharge(
        row.id,
        form({
          outcome: "SETTLED",
          resolvedAmount: "1500",
          resolvedOn: "2026-08-28",
          resolutionNote: "Split with the demo contractor",
        }),
      ),
    ).toEqual({ ok: true });

    const settled = await prisma.backcharge.findUniqueOrThrow({ where: { id: row.id } });
    expect(settled.status).toBe("SETTLED");
    expect(Number(settled.resolvedAmount)).toBe(1500);
    expect(settled.resolvedOn?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });

  it("refuses to delete one we have already answered", async () => {
    const row = await latest();
    const result = await deleteBackcharge(row.id);
    expect(result.ok).toBe(false);
    expect(await prisma.backcharge.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("reopens back to DISPUTED, keeping the objection date", async () => {
    const row = await latest();
    expect(await reopenBackcharge(row.id)).toEqual({ ok: true });

    const reopened = await prisma.backcharge.findUniqueOrThrow({ where: { id: row.id } });
    // Not RECEIVED: we objected, and re-entering that objection later would
    // stamp it with today's date and destroy the evidence of when we
    // actually answered.
    expect(reopened.status).toBe("DISPUTED");
    expect(reopened.disputedOn?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(reopened.resolvedAmount).toBeNull();
    expect(reopened.resolvedOn).toBeNull();
  });

  it("stores no conceded figure when a backcharge is accepted in full", async () => {
    expect(await createBackcharge(newBackcharge({ description: "Accepted one", claimedAmount: "900" }))).toEqual({
      ok: true,
    });
    const row = await latest();
    expect(await resolveBackcharge(row.id, form({ outcome: "ACCEPTED", resolvedOn: "2026-08-30" }))).toEqual({
      ok: true,
    });

    const accepted = await prisma.backcharge.findUniqueOrThrow({ where: { id: row.id } });
    expect(accepted.status).toBe("ACCEPTED");
    // The row already carries 900. A second copy of it could drift from the
    // first — concededAmount() derives it from the status instead.
    expect(accepted.resolvedAmount).toBeNull();
  });

  it("refuses everything for a backcharge in another company", async () => {
    const foreign = await prisma.backcharge.create({
      data: {
        companyId: (await prisma.job.findUniqueOrThrow({ where: { id: otherCompanyJobId } })).companyId,
        jobId: otherCompanyJobId,
        number: 1,
        description: "Theirs",
        claimedAmount: "100",
        issuedOn: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    const notFound = { ok: false, error: "Backcharge not found" };
    expect(await updateBackcharge(foreign.id, newBackcharge())).toEqual(notFound);
    expect(await disputeBackcharge(foreign.id, form({ disputeReason: "x" }))).toEqual(notFound);
    expect(await resolveBackcharge(foreign.id, form({ outcome: "ACCEPTED" }))).toEqual(notFound);
    expect(await reopenBackcharge(foreign.id)).toEqual(notFound);
    expect(await deleteBackcharge(foreign.id)).toEqual(notFound);

    expect(await prisma.backcharge.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });

  it("lets a non-owner do everything except delete", async () => {
    context.role = "MEMBER";
    try {
      expect(await createBackcharge(newBackcharge({ description: "Member logged this" }))).toEqual({
        ok: true,
      });
      const row = await latest();
      expect(await deleteBackcharge(row.id)).toEqual({
        ok: false,
        error: "Only the account owner can delete a backcharge",
      });
      expect(await prisma.backcharge.findUnique({ where: { id: row.id } })).not.toBeNull();
    } finally {
      context.role = "OWNER";
    }
  });
});
