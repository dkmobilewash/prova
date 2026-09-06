import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { isUniqueConstraintError } from "./shared";

/**
 * The guards from #25 and #26, executed against a real Postgres.
 *
 * WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It proves the BEHAVIOUR the two issues asked for: a duplicate invite comes
 * back as a sentence a person can read, and re-assigning an already-assigned
 * teammate is a silent no-op instead of an error. Both are executed against
 * a genuine unique-constraint violation raised by Postgres — not a
 * hand-built error object, which would only prove the catch block matches
 * the fake.
 *
 * It does NOT prove the defect those issues describe is gone, and pretending
 * otherwise would make it one more test that cannot fail. The defect was
 * `error instanceof Prisma.PrismaClientKnownRequestError` evaluating to
 * FALSE in the running app, because Next bundles `@prova/db`
 * (`transpilePackages`) and the generated client's internal error class ends
 * up a different copy from the re-exported namespace. Under Vitest there is
 * no such split — Node resolves `@prisma/client` once — so `instanceof` is
 * TRUE here and the ORIGINAL BROKEN CODE PASSES THIS FILE. Measured
 * 2026-09-05 on a scratch Postgres: ctor `PrismaClientKnownRequestError`,
 * code `P2002`, `instanceof` true.
 *
 * The half that can actually fail on the defect is
 * `lib/prisma-error-guards.test.ts`, which checks the SOURCE, because the
 * source is the only place the divergence is visible outside a production
 * build. This file's job is the other half: that the sentence exists, is
 * reachable, and says something a person can act on.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** The signed-in person, swapped per test. */
let principal: { id: string; role: string; company: { id: string } } | null = null;
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => {
    if (!principal) throw new Error("test did not set a principal");
    return principal;
  },
}));

const { inviteTeamMember } = await import("./company");
const { assignCrewMember } = await import("./jobs");

const STAMP = Date.now();
let companyId = "";
let ownerId = "";
let memberId = "";
let jobId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Guard Test Co ${STAMP}` } });
  companyId = company.id;

  const owner = await prisma.user.create({
    data: {
      companyId,
      clerkId: `guard_owner_${STAMP}`,
      email: `guard_owner_${STAMP}@example.test`,
      role: "OWNER",
    },
  });
  ownerId = owner.id;

  const member = await prisma.user.create({
    data: {
      companyId,
      clerkId: `guard_member_${STAMP}`,
      email: `guard_member_${STAMP}@example.test`,
      role: "MEMBER",
    },
  });
  memberId = member.id;

  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: `Guard Test Job ${STAMP}` },
  });
  jobId = job.id;

  principal = { id: ownerId, role: "OWNER", company: { id: companyId } };
});

afterAll(async () => {
  await prisma.jobAssignment.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.invite.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

/**
 * The load-bearing fact underneath every call site of the helper: the error
 * REAL Prisma raises on a duplicate insert carries `code === "P2002"`.
 *
 * Worth pinning against real Prisma rather than a stub, because if a Prisma
 * upgrade ever moved or renamed that property, `isUniqueConstraintError`
 * would start returning false EVERYWHERE at once — silently, since a guard
 * that stops firing produces no failure of its own, just a 500 somewhere
 * else. This is the one assertion here that can catch that.
 */
describe("what real Prisma throws on a duplicate insert", () => {
  it("carries code P2002, and isUniqueConstraintError recognises it", async () => {
    const email = `dupe_${STAMP}@example.test`;
    await prisma.invite.create({ data: { companyId, email } });

    let captured: unknown = null;
    try {
      await prisma.invite.create({ data: { companyId, email } });
    } catch (err) {
      captured = err;
    }

    expect(captured, "the second insert must actually have been refused").not.toBeNull();
    expect((captured as { code?: unknown }).code).toBe("P2002");
    expect(isUniqueConstraintError(captured)).toBe(true);

    await prisma.invite.deleteMany({ where: { email } });
  });
});

describe("inviting the same address twice (#25)", () => {
  it("answers the second invite with a sentence, not a thrown error", async () => {
    const email = `twice_${STAMP}@example.test`;

    const first = await inviteTeamMember(formWith(email));
    expect(first).toEqual({ ok: true });

    // The whole point of #25: this is the path that used to escape as a raw
    // Prisma error because the guard translating it could never fire.
    const second = await inviteTeamMember(formWith(email));
    expect(second).toEqual({
      ok: false,
      error: "That email has already been invited (here or elsewhere)",
    });

    // Exactly one invite exists — the refusal is a refusal, not a silent
    // second row.
    expect(await prisma.invite.count({ where: { email } })).toBe(1);
    await prisma.invite.deleteMany({ where: { email } });
  });

  it("refuses a non-owner readably rather than by throwing (#166)", async () => {
    principal = { id: memberId, role: "MEMBER", company: { id: companyId } };
    const result = await inviteTeamMember(formWith(`member_${STAMP}@example.test`));
    principal = { id: ownerId, role: "OWNER", company: { id: companyId } };

    expect(result).toEqual({ ok: false, error: "Only the account owner can do that" });
    expect(await prisma.invite.count({ where: { companyId } })).toBe(0);
  });

  it("still refuses an address that already has an account", async () => {
    const result = await inviteTeamMember(formWith(`guard_member_${STAMP}@example.test`));
    expect(result).toEqual({
      ok: false,
      error: "Someone with that email already has an account",
    });
  });
});

describe("assigning the same teammate twice (#26)", () => {
  it("treats the second assignment as a no-op instead of a 500", async () => {
    await assignCrewMember(jobId, formWith(memberId, "userId"));
    expect(await prisma.jobAssignment.count({ where: { jobId } })).toBe(1);

    // Before #26 this rethrew the raw P2002 — the "already assigned, treat
    // as a no-op" comment sat directly under a guard that never ran.
    await expect(assignCrewMember(jobId, formWith(memberId, "userId"))).resolves.toBeUndefined();
    expect(await prisma.jobAssignment.count({ where: { jobId } })).toBe(1);
  });

  it("still refuses somebody who is not in this company", async () => {
    const outsiderCompany = await prisma.company.create({ data: { name: `Outsider ${STAMP}` } });
    const outsider = await prisma.user.create({
      data: {
        companyId: outsiderCompany.id,
        clerkId: `outsider_${STAMP}`,
        email: `outsider_${STAMP}@example.test`,
        role: "OWNER",
      },
    });

    await expect(assignCrewMember(jobId, formWith(outsider.id, "userId"))).rejects.toThrow(
      "Team member not found",
    );

    await prisma.user.deleteMany({ where: { companyId: outsiderCompany.id } });
    await prisma.company.deleteMany({ where: { id: outsiderCompany.id } });
  });
});

function formWith(value: string, key = "email"): FormData {
  const formData = new FormData();
  formData.set(key, value);
  return formData;
}
