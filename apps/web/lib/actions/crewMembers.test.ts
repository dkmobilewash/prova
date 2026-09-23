import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Putting a person on the crew, against a fake database.
 *
 * WHAT THIS FILE IS DEFENDING. A union drywall sub has fifteen to forty
 * field workers and none of them has a company login. Until this action
 * existed the only way to create a `CrewMember` from the UI was an
 * owner-only CSV import inside Settings, and the crew section on /team did
 * not render at all while the crew was empty — so a pilot contractor could
 * not get his crew into the product, and the person whose weekly job is
 * certified payroll could not either.
 *
 * Three claims are worth a test rather than a comment, and each one is a
 * PAIR, because a single positive assertion also passes on an action that
 * has dropped its guards entirely:
 *
 *   1. the office manager (PAYROLL_COMPLIANCE) may ADD and may not ARCHIVE;
 *   2. the craft is written in the SAME transaction as the person, and is
 *      refused outright to somebody without MANAGE_COMPLIANCE;
 *   3. an edit never names the legal name, which a database trigger refuses
 *      — so a form offering it would be a dead button in production.
 *
 * The fake records every write as `table.op@tx` or `table.op@bare`, so "one
 * transaction" is observed rather than assumed, and it throws on any call
 * it does not implement, so a test cannot pass against a fiction.
 */

type Row = Record<string, unknown> & { id: string };

const state = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  seq: 0,
  writes: [] as string[],
  /** The `data` of every update, so a test can ask what a write NAMED. */
  updates: [] as { table: string; data: Record<string, unknown> }[],
  failNextUnique: false,
  context: {
    id: "user_1",
    role: "OWNER" as string,
    jobFunction: null as string | null,
    company: { id: "co_A" },
  },
}));

function table(name: string): Row[] {
  let rows = state.tables.get(name);
  if (!rows) {
    rows = [];
    state.tables.set(name, rows);
  }
  return rows;
}

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function uniqueError() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function model(name: string, viaTx: boolean) {
  const write = (op: string) => state.writes.push(`${name}.${op}@${viaTx ? "tx" : "bare"}`);
  return {
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      table(name).find((row) => matches(row, where)) ?? null,
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      table(name).find((row) => matches(row, where)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      write("create");
      if (state.failNextUnique) {
        state.failNextUnique = false;
        throw uniqueError();
      }
      const row = { id: `${name}_${++state.seq}`, ...data } as Row;
      table(name).push(row);
      return row;
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      write("update");
      state.updates.push({ table: name, data });
      if (state.failNextUnique) {
        state.failNextUnique = false;
        throw uniqueError();
      }
      const row = table(name).find((r) => matches(r, where));
      if (!row) throw new Error(`no ${name} to update`);
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      write("deleteMany");
      const keep = table(name).filter((row) => !matches(row, where));
      const count = table(name).length - keep.length;
      state.tables.set(name, keep);
      return { count };
    },
  };
}

function clientFor(viaTx: boolean): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "then" || typeof property === "symbol") return undefined;
        if (property === "$transaction") {
          if (viaTx) throw new Error("nested transactions are not faked");
          return async (fn: (tx: unknown) => Promise<unknown>) => {
            if (typeof fn !== "function") throw new Error("only interactive transactions are faked");
            return fn(clientFor(true));
          };
        }
        return model(String(property), viaTx);
      },
    },
  );
}

vi.mock("@prova/db", () => ({ prisma: clientFor(false), Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => state.context }));

const { archiveCrewMember, createCrewMember, updateCrewMember } = await import("./crewMembers");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  state.tables = new Map();
  state.seq = 0;
  state.writes = [];
  state.updates = [];
  state.failNextUnique = false;
  state.context.role = "OWNER";
  state.context.jobFunction = null;

  table("craftClassification").push({ id: "craft_carp", companyId: "co_A", name: "Carpenter" });
  // Another company's classification, so "this company's" is a claim with
  // something to fail against rather than a sentence in a comment.
  table("craftClassification").push({ id: "craft_theirs", companyId: "co_B", name: "Carpenter" });
});

const crewIn = (companyId: string) => table("crewMember").filter((row) => row.companyId === companyId);

describe("adding somebody to the crew", () => {
  it("takes a first and last name and nothing else", async () => {
    expect(await createCrewMember(form({ legalFirstName: "Luis", legalLastName: "Ortega" }))).toEqual({
      ok: true,
    });
    expect(crewIn("co_A")).toHaveLength(1);
    expect(crewIn("co_A")[0]).toMatchObject({
      legalFirstName: "Luis",
      legalLastName: "Ortega",
      legalMiddleName: null,
      employeeNumber: null,
    });
  });

  it("refuses a missing name with a sentence, and writes nothing", async () => {
    // RETURNED, not thrown. A thrown Server Action message is redacted to a
    // digest in production, so "Last name is required" would reach a real
    // contractor as two hundred characters about production builds.
    expect(await createCrewMember(form({ legalFirstName: "Luis", legalLastName: "  " }))).toEqual({
      ok: false,
      error: expect.stringContaining("Last name"),
    });
    expect(await createCrewMember(form({ legalFirstName: "", legalLastName: "Ortega" }))).toEqual({
      ok: false,
      error: expect.stringContaining("First name"),
    });
    expect(state.writes).toEqual([]);
  });

  it("names a taken employee number rather than throwing a constraint at the screen", async () => {
    state.failNextUnique = true;
    expect(
      await createCrewMember(form({ legalFirstName: "Luis", legalLastName: "Ortega", employeeNumber: "114" })),
    ).toEqual({ ok: false, error: expect.stringContaining("employee number") });
  });

  it("writes the person and their craft in ONE transaction", async () => {
    expect(
      await createCrewMember(
        form({ legalFirstName: "Luis", legalLastName: "Ortega", craftClassificationId: "craft_carp" }),
      ),
    ).toEqual({ ok: true });
    // Both @tx: a craft row pointing at a person whose creation then failed
    // is not a state anything downstream knows how to read.
    expect(state.writes).toEqual(["crewMember.create@tx", "workerCraft.create@tx"]);
    expect(table("workerCraft")[0]).toMatchObject({
      companyId: "co_A",
      craftClassificationId: "craft_carp",
      crewMemberId: table("crewMember")[0].id,
    });
  });

  it("will not take another company's craft classification", async () => {
    expect(
      await createCrewMember(
        form({ legalFirstName: "Luis", legalLastName: "Ortega", craftClassificationId: "craft_theirs" }),
      ),
    ).toEqual({ ok: false, error: expect.stringContaining("no longer exists") });
    expect(state.writes).toEqual([]);
  });
});

describe("who may touch the crew", () => {
  /**
   * The office manager. She holds MANAGE_FIELD and MANAGE_COMPLIANCE and is
   * not the owner — and certified payroll is her weekly chore. Gating crew
   * creation to OWNER meant she could import a payroll register whose rows
   * had to match crew members only somebody else could create.
   */
  it("lets PAYROLL_COMPLIANCE add a crew member with their craft", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "PAYROLL_COMPLIANCE";
    expect(
      await createCrewMember(
        form({ legalFirstName: "Luis", legalLastName: "Ortega", craftClassificationId: "craft_carp" }),
      ),
    ).toEqual({ ok: true });
    expect(crewIn("co_A")).toHaveLength(1);
  });

  /** The other half of the pair. Archiving is the one-way door: there is no
   *  un-archive in this app, so it keeps the owner gate the add path drops. */
  it("still refuses her the archive, and writes nothing", async () => {
    table("crewMember").push({
      id: "m_luis", companyId: "co_A", legalFirstName: "Luis", legalMiddleName: null,
      legalLastName: "Ortega", archivedAt: null,
    });
    state.context.role = "MEMBER";
    state.context.jobFunction = "PAYROLL_COMPLIANCE";
    expect(await archiveCrewMember("m_luis")).toEqual({
      ok: false,
      error: expect.stringContaining("owner"),
    });
    expect(state.writes).toEqual([]);
  });

  it("refuses a job function with no field capability at all", async () => {
    state.context.role = "MEMBER";
    // ACCOUNTING: billing and financials, no field. The honest negative —
    // this is not a capability every member happens to hold.
    state.context.jobFunction = "ACCOUNTING";
    expect(await createCrewMember(form({ legalFirstName: "Luis", legalLastName: "Ortega" }))).toEqual({
      ok: false,
      error: expect.stringContaining("job function"),
    });
    expect(state.writes).toEqual([]);
  });

  /**
   * A craft classification is what fringe rates and the apprentice-ratio
   * check are computed from, and `setWorkerCraft` on /union-compliance
   * asks for MANAGE_COMPLIANCE. Writing the same row from this form under a
   * weaker capability would be a hole opened by a second door. FIELD — a
   * foreman — holds MANAGE_FIELD and not MANAGE_COMPLIANCE, so he may add
   * the person and not decide the craft.
   */
  it("refuses a craft to a foreman, and adds nobody on the way past", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    expect(
      await createCrewMember(
        form({ legalFirstName: "Luis", legalLastName: "Ortega", craftClassificationId: "craft_carp" }),
      ),
    ).toEqual({ ok: false, error: expect.stringContaining("job function") });
    expect(state.writes).toEqual([]);

    // ...and the same foreman may add the person without one.
    expect(await createCrewMember(form({ legalFirstName: "Luis", legalLastName: "Ortega" }))).toEqual({
      ok: true,
    });
  });
});

describe("editing a crew member", () => {
  beforeEach(() => {
    table("crewMember").push({
      id: "m_luis", companyId: "co_A", legalFirstName: "Luis", legalMiddleName: null,
      legalLastName: "Ortega", employeeNumber: null, archivedAt: null,
    });
  });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR, second only to the empty state.
   * `prova_crew_member_identity_lock` refuses any UPDATE that changes a
   * legal name, because a filed WH-347 names this person. An action that
   * put the name in its `data` would work in `next dev` against a schema
   * nobody had migrated and fail at the database in production, where the
   * thrown message is redacted to a digest — a dead button with no
   * explanation. The form does not offer it; this proves the action does
   * not write it even when the field is posted anyway.
   */
  it("never writes the legal name, even when the form posts one", async () => {
    expect(
      await updateCrewMember(
        "m_luis",
        form({ legalFirstName: "Luiz", legalLastName: "Ortegga", employeeNumber: "114" }),
      ),
    ).toEqual({ ok: true });

    const crewUpdates = state.updates.filter((u) => u.table === "crewMember");
    expect(crewUpdates).toHaveLength(1);
    expect(Object.keys(crewUpdates[0].data)).toEqual(["employeeNumber"]);
    expect(table("crewMember")[0]).toMatchObject({
      legalFirstName: "Luis",
      legalLastName: "Ortega",
      employeeNumber: "114",
    });
  });

  it("replaces the craft rather than stacking a second one", async () => {
    table("workerCraft").push({
      id: "wc_old", companyId: "co_A", crewMemberId: "m_luis", craftClassificationId: "craft_old",
    });
    expect(await updateCrewMember("m_luis", form({ craftClassificationId: "craft_carp" }))).toEqual({ ok: true });
    expect(table("workerCraft")).toHaveLength(1);
    expect(table("workerCraft")[0]).toMatchObject({ craftClassificationId: "craft_carp" });
  });

  /** The form does not render a craft select when the viewer cannot set
   *  crafts or the company has none, so the field is ABSENT — which must
   *  leave an existing craft alone rather than clearing it. Absent and
   *  "Not set yet" are different answers. */
  it("leaves the craft alone when the form did not offer the field", async () => {
    table("workerCraft").push({
      id: "wc_old", companyId: "co_A", crewMemberId: "m_luis", craftClassificationId: "craft_old",
    });
    expect(await updateCrewMember("m_luis", form({ employeeNumber: "114" }))).toEqual({ ok: true });
    expect(table("workerCraft")).toHaveLength(1);
    expect(table("workerCraft")[0]).toMatchObject({ craftClassificationId: "craft_old" });
  });

  it("clears the craft when the field was offered and left empty", async () => {
    table("workerCraft").push({
      id: "wc_old", companyId: "co_A", crewMemberId: "m_luis", craftClassificationId: "craft_old",
    });
    expect(await updateCrewMember("m_luis", form({ craftClassificationId: "" }))).toEqual({ ok: true });
    expect(table("workerCraft")).toHaveLength(0);
  });

  it("will not edit another company's crew member", async () => {
    table("crewMember").push({
      id: "m_theirs", companyId: "co_B", legalFirstName: "Not", legalMiddleName: null,
      legalLastName: "Yours", employeeNumber: null, archivedAt: null,
    });
    expect(await updateCrewMember("m_theirs", form({ employeeNumber: "999" }))).toEqual({
      ok: false,
      error: expect.stringContaining("gone"),
    });
    expect(state.writes).toEqual([]);
  });
});
