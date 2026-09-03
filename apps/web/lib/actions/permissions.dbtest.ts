import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Job functions against a real Postgres.
 *
 * lib/permissions.test.ts already pins the capability MAP. What it cannot
 * check is the part that would actually hurt: that only an owner can
 * change one, that the column round-trips, and above all that an existing
 * row — which arrives with jobFunction NULL — keeps the access it had.
 * That last one is the whole safety argument for shipping this on a
 * company already using the app, and it is worth executing rather than
 * reasoning about.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { setJobFunction } = await import("./permissions");
const { capabilitiesFor, can, CAPABILITIES } = await import("@/lib/permissions");

let memberId = "";
let ownerId = "";
let outsiderId = "";

function form(jobFunction: string) {
  const fd = new FormData();
  fd.set("jobFunction", jobFunction);
  return fd;
}

const reload = async (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

describe("job functions against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Permissions Test Co" } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `perm_o_${Date.now()}`,
        email: `perm_o_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    const member = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `perm_m_${Date.now()}`,
        email: `perm_m_${Date.now()}@example.test`,
        role: "MEMBER",
      },
    });

    const other = await prisma.company.create({ data: { name: "Someone Else" } });
    const outsider = await prisma.user.create({
      data: {
        companyId: other.id,
        clerkId: `perm_x_${Date.now()}`,
        email: `perm_x_${Date.now()}@example.test`,
        role: "MEMBER",
      },
    });

    context.company.id = company.id;
    context.id = owner.id;
    ownerId = owner.id;
    memberId = member.id;
    outsiderId = outsider.id;
  });

  afterAll(async () => {
    const outsider = await prisma.user.findUnique({ where: { id: outsiderId } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    if (outsider) {
      await prisma.user.deleteMany({ where: { companyId: outsider.companyId } });
      await prisma.company.delete({ where: { id: outsider.companyId } });
    }
    await prisma.$disconnect();
  });

  it("arrives null on an existing row and loses that person nothing", async () => {
    const member = await reload(memberId);
    expect(member.jobFunction).toBeNull();
    // The migration-safety claim, executed rather than reasoned about.
    expect(capabilitiesFor(member).size).toBe(CAPABILITIES.length);
  });

  it("lets the owner narrow someone to the field tier", async () => {
    expect(await setJobFunction(memberId, form("FIELD"))).toEqual({ ok: true });

    const member = await reload(memberId);
    expect(member.jobFunction).toBe("FIELD");
    expect(can(member, "MANAGE_FIELD")).toBe(true);
    expect(can(member, "VIEW_JOB_COSTS")).toBe(false);
    expect(can(member, "VIEW_COMPANY_FINANCIALS")).toBe(false);
    expect(can(member, "MANAGE_BILLING")).toBe(false);
  });

  it("clears it back to the default with an empty value", async () => {
    expect(await setJobFunction(memberId, form(""))).toEqual({ ok: true });
    const member = await reload(memberId);
    expect(member.jobFunction).toBeNull();
    expect(capabilitiesFor(member).size).toBe(CAPABILITIES.length);
  });

  it("refuses a value that is not a job function", async () => {
    const result = await setJobFunction(memberId, form("SUPERUSER"));
    expect(result.ok).toBe(false);
    expect((await reload(memberId)).jobFunction).toBeNull();
  });

  it("refuses to set one on an owner, and says why", async () => {
    // An owner's capabilities never depend on it, so saving one would
    // have no effect while reading as though it had.
    const result = await setJobFunction(ownerId, form("FIELD"));
    expect(result.ok).toBe(false);
    expect((await reload(ownerId)).jobFunction).toBeNull();
  });

  it("refuses a member of another company", async () => {
    expect(await setJobFunction(outsiderId, form("FIELD"))).toEqual({
      ok: false,
      error: "That person isn't on your team",
    });
    expect((await reload(outsiderId)).jobFunction).toBeNull();
  });

  it("refuses a non-owner outright — a permission anyone can widen is not one", async () => {
    context.role = "MEMBER";
    try {
      const result = await setJobFunction(memberId, form("EXECUTIVE"));
      expect(result).toEqual({
        ok: false,
        error: "Only the account owner can change what someone's access covers",
      });
      expect((await reload(memberId)).jobFunction).toBeNull();
    } finally {
      context.role = "OWNER";
    }
  });

  it("never narrows an owner, whatever ends up in the column", async () => {
    // Belt and braces: even if a row somehow carried FIELD (a direct
    // database edit, a future import), an owner still holds everything.
    await prisma.user.update({ where: { id: ownerId }, data: { jobFunction: "FIELD" } });
    const owner = await reload(ownerId);
    expect(capabilitiesFor(owner).size).toBe(CAPABILITIES.length);
    await prisma.user.update({ where: { id: ownerId }, data: { jobFunction: null } });
  });
});
