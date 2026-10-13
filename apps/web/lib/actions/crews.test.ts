import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saved crews. The tables are new; what these pin is the part the database
 * cannot: every ticked person becomes exactly one membership in the XOR
 * shape the CHECK demands, nobody from another company gets in, re-saving a
 * name replaces its people (and un-archives it), and every refusal comes
 * back as a sentence rather than a thrown, redacted digest.
 */

const tx = vi.hoisted(() => ({
  crew: { upsert: vi.fn() },
  crewMembership: { deleteMany: vi.fn(), createMany: vi.fn() },
}));
const db = vi.hoisted(() => ({
  user: { count: vi.fn() },
  crewMember: { count: vi.fn() },
  crew: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
const ctx = vi.hoisted(() => ({ value: { id: "u1", role: "OWNER", jobFunction: null as string | null, company: { id: "co1" } } }));
const can = vi.hoisted(() => vi.fn());

vi.mock("@prova/db", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ctx.value }));
vi.mock("@/lib/permissions", () => ({ can }));

const { saveCrew, renameCrew, archiveCrew } = await import("./crews");

function form(values: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  ctx.value = { id: "u1", role: "OWNER", jobFunction: null, company: { id: "co1" } };
  can.mockReturnValue(true);
  db.user.count.mockResolvedValue(1);
  db.crewMember.count.mockResolvedValue(2);
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.crew.upsert.mockResolvedValue({ id: "crew1" });
});

describe("saveCrew", () => {
  it("writes one membership per ticked person, each with exactly one worker id", async () => {
    const result = await saveCrew(form({ crewName: " Ray's crew ", worker: ["user:u7", "crew:c1", "crew:c2", "crew:c1"] }));

    expect(result).toEqual({ ok: true });
    expect(tx.crew.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_name: { companyId: "co1", name: "Ray's crew" } },
        // Re-saving an archived name brings it back rather than colliding.
        update: { archivedAt: null },
      }),
    );
    // Replaces, never appends: the old people go before the new ones land.
    expect(tx.crewMembership.deleteMany).toHaveBeenCalledWith({ where: { crewId: "crew1" } });
    expect(tx.crewMembership.createMany.mock.calls[0][0].data).toEqual([
      { crewId: "crew1", scheduledUserId: "u7" },
      { crewId: "crew1", crewMemberId: "c1" },
      { crewId: "crew1", crewMemberId: "c2" },
    ]);
  });

  it("re-reads every person through this company and refuses one that is not on it", async () => {
    db.crewMember.count.mockResolvedValue(1); // one of the two crew ids is foreign or archived
    const result = await saveCrew(form({ crewName: "A", worker: ["crew:c1", "crew:other"] }));

    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/not on your account/) });
    expect(db.crewMember.count.mock.calls[0][0].where).toEqual({ id: { in: ["c1", "other"] }, companyId: "co1", archivedAt: null });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a nameless crew, an empty crew and a forged value — returned, not thrown", async () => {
    expect(await saveCrew(form({ crewName: "", worker: "user:u7" }))).toMatchObject({ ok: false, error: "Give the crew a name." });
    expect(await saveCrew(form({ crewName: "A" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Tick the people/) });
    expect(await saveCrew(form({ crewName: "A", worker: "admin:1" }))).toMatchObject({ ok: false });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("answers to the same capability as the schedule", async () => {
    can.mockReturnValue(false);
    expect(await saveCrew(form({ crewName: "A", worker: "user:u7" }))).toMatchObject({ ok: false, error: expect.stringMatching(/field access/) });
    expect(can).toHaveBeenCalledWith(expect.anything(), "MANAGE_FIELD");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("renameCrew", () => {
  it("is company-scoped and turns a name clash into a sentence", async () => {
    db.crew.updateMany.mockResolvedValue({ count: 1 });
    expect(await renameCrew("crew1", form({ crewName: "Tapers" }))).toEqual({ ok: true });
    expect(db.crew.updateMany.mock.calls[0][0]).toEqual({ where: { id: "crew1", companyId: "co1" }, data: { name: "Tapers" } });

    db.crew.updateMany.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await renameCrew("crew1", form({ crewName: "Tapers" }))).toMatchObject({ ok: false, error: 'There is already a crew called "Tapers".' });
  });
});

describe("archiveCrew", () => {
  it("is owner-only, and the refusal is RETURNED", async () => {
    ctx.value = { ...ctx.value, role: "MEMBER" };
    expect(await archiveCrew("crew1")).toEqual({ ok: false, error: "Only the account owner can archive a crew." });
    expect(db.crew.updateMany).not.toHaveBeenCalled();
  });

  it("hides the crew without deleting anything", async () => {
    db.crew.updateMany.mockResolvedValue({ count: 1 });
    expect(await archiveCrew("crew1")).toEqual({ ok: true });
    expect(db.crew.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "crew1", companyId: "co1", archivedAt: null },
      data: { archivedAt: expect.any(Date) },
    });
  });
});
