import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * A HIRING HALL DISPATCHES FIELD CREW, AND THE SLIP COULD NOT NAME THEM.
 *
 * `DispatchSlip.employeeUserId` was a REQUIRED key to `User`, so a dispatch
 * could only be recorded for somebody with a login — and the people a hall
 * sends are `CrewMember` rows with none. 20260921120000_allow_crew_dispatch_slips
 * adds `crewMemberId`, loosens `employeeUserId`, and adds the XOR CHECK
 * `DispatchSlip_employee_or_crew`, mirroring what #412 did for TimeEntry.
 *
 * Against a real Postgres because the CHECK is the point, and a CHECK
 * written by hand in a migration is exactly the thing a faked Prisma client
 * cannot see. The "both" and "neither" cases go straight to Prisma rather
 * than through the action: the action's own branching already refuses them,
 * so going through it would prove the action and not the database. The
 * database is the rule; the action is the manners.
 *
 * Run against a SCRATCH database only — vitest.db.setup.mts refuses anything
 * that is not local.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { uploadDispatchSlip } = await import("./labor");

const stamp = Date.now();
let jobId = "";
let userId = "";
let crewMemberId = "";
let archivedCrewId = "";
let otherCompanyId = "";
let otherCrewId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

/** Postgres's own words for a CHECK violation, whichever way Prisma wraps it. */
const CHECK_VIOLATION = /DispatchSlip_employee_or_crew|check constraint/i;

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Dispatch Crew Co ${stamp}` } });
  context.company.id = company.id;
  const owner = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `dispatch_owner_${stamp}`,
      email: `dispatch_owner_${stamp}@example.test`,
      name: "Office Owner",
      role: "OWNER",
    },
  });
  context.id = owner.id;
  userId = owner.id;

  const luis = await prisma.crewMember.create({
    data: { companyId: company.id, legalFirstName: "Luis", legalLastName: "Ortega" },
  });
  crewMemberId = luis.id;
  const gone = await prisma.crewMember.create({
    data: { companyId: company.id, legalFirstName: "Former", legalLastName: "Hand", archivedAt: new Date() },
  });
  archivedCrewId = gone.id;

  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
  const job = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: "Northgate Clinic TI — level 2 drywall" },
  });
  jobId = job.id;

  const other = await prisma.company.create({ data: { name: `Other Dispatch Co ${stamp}` } });
  otherCompanyId = other.id;
  const theirs = await prisma.crewMember.create({
    data: { companyId: other.id, legalFirstName: "Not", legalLastName: "Yours" },
  });
  otherCrewId = theirs.id;
});

afterAll(async () => {
  await prisma.dispatchSlip.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId: context.company.id } });
  await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
  for (const companyId of [context.company.id, otherCompanyId]) {
    await prisma.crewMember.deleteMany({ where: { companyId } });
  }
  await prisma.user.deleteMany({ where: { companyId: context.company.id } });
  await prisma.company.deleteMany({ where: { id: { in: [context.company.id, otherCompanyId] } } });
  await prisma.$disconnect();
});

describe("uploadDispatchSlip for a crew member", () => {
  it("records a dispatch for a crew member with no login", async () => {
    const result = await uploadDispatchSlip(
      jobId,
      form({ worker: `crew:${crewMemberId}`, dispatchDate: "2026-09-21", dispatchNumber: "D-1001" }),
    );
    expect(result).toEqual({ ok: true });

    const slip = await prisma.dispatchSlip.findFirstOrThrow({
      where: { jobId, dispatchNumber: "D-1001" },
      include: { crewMember: true },
    });
    expect(slip.crewMemberId).toBe(crewMemberId);
    expect(slip.employeeUserId).toBeNull();
    expect(slip.crewMember?.legalLastName).toBe("Ortega");
  });

  it("still records a dispatch for a teammate, through the new field and the old one", async () => {
    expect(
      await uploadDispatchSlip(jobId, form({ worker: `user:${userId}`, dispatchDate: "2026-09-20", dispatchNumber: "D-1002" })),
    ).toEqual({ ok: true });
    // The old field name — what a tab left open on the previous build posts.
    expect(
      await uploadDispatchSlip(jobId, form({ employeeUserId: userId, dispatchDate: "2026-09-19", dispatchNumber: "D-1003" })),
    ).toEqual({ ok: true });

    const slips = await prisma.dispatchSlip.findMany({
      where: { jobId, dispatchNumber: { in: ["D-1002", "D-1003"] } },
    });
    expect(slips).toHaveLength(2);
    for (const slip of slips) {
      expect(slip.employeeUserId).toBe(userId);
      expect(slip.crewMemberId).toBeNull();
    }
  });

  it("refuses another company's crew member, and an archived one, with a sentence", async () => {
    const before = await prisma.dispatchSlip.count({ where: { jobId } });

    const foreign = await uploadDispatchSlip(jobId, form({ worker: `crew:${otherCrewId}`, dispatchDate: "2026-09-21" }));
    expect(foreign).toEqual({ ok: false, error: "That person isn't on your team." });

    const archived = await uploadDispatchSlip(jobId, form({ worker: `crew:${archivedCrewId}`, dispatchDate: "2026-09-21" }));
    expect(archived.ok).toBe(false);
    if (!archived.ok) expect(archived.error).toMatch(/archived/);

    const nobody = await uploadDispatchSlip(jobId, form({ dispatchDate: "2026-09-21" }));
    expect(nobody.ok).toBe(false);

    expect(await prisma.dispatchSlip.count({ where: { jobId } })).toBe(before);
  });
});

describe("the DispatchSlip_employee_or_crew CHECK", () => {
  it("refuses a slip naming NEITHER a user nor a crew member", async () => {
    await expect(
      prisma.dispatchSlip.create({ data: { jobId, dispatchDate: new Date("2026-09-21T00:00:00.000Z") } }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });

  it("refuses a slip naming BOTH a user and a crew member", async () => {
    await expect(
      prisma.dispatchSlip.create({
        data: {
          jobId,
          employeeUserId: userId,
          crewMemberId,
          dispatchDate: new Date("2026-09-21T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });

  it("accepts exactly one — the control that keeps the two refusals honest", async () => {
    const asUser = await prisma.dispatchSlip.create({
      data: { jobId, employeeUserId: userId, dispatchDate: new Date("2026-09-18T00:00:00.000Z") },
    });
    const asCrew = await prisma.dispatchSlip.create({
      data: { jobId, crewMemberId, dispatchDate: new Date("2026-09-18T00:00:00.000Z") },
    });
    expect(asUser.id).toBeTruthy();
    expect(asCrew.id).toBeTruthy();
  });

  it("refuses to delete a crew member a slip names — RESTRICT, as TimeEntry does", async () => {
    await expect(prisma.crewMember.delete({ where: { id: crewMemberId } })).rejects.toThrow(/DispatchSlip_crewMemberId_fkey/);
    expect(await prisma.crewMember.count({ where: { id: crewMemberId } })).toBe(1);
  });
});
