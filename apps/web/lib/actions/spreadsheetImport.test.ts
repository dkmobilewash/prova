import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The confirm half of /settings/import, against a fake database holding TWO
 * companies.
 *
 * The second company is the point. Every claim these actions make about
 * scope — "matched against THIS company's clients", "never another
 * company's" — passes trivially against a database holding one company,
 * because there is nothing else to match. So company B is seeded with rows
 * that WOULD match the upload by name, and the tests require that they are
 * neither matched, nor attached to, nor changed.
 *
 * The fake honours `where` (every key, by equality) and `select` (including
 * a job's `contact.name`), and it knows whether a write happened inside
 * `$transaction` — so "one transaction" is observed, not assumed. It is
 * deliberately small: a call it does not implement throws rather than
 * answering, so a test cannot pass against a fiction.
 */

type Row = Record<string, unknown> & { id: string };

const state = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  seq: 0,
  txDepth: 0,
  /** Every write as `table.op@tx` or `table.op@bare`. */
  writes: [] as string[],
  txOptions: [] as unknown[],
  failNext: null as string | null,
  /** The Prisma error code the next failure carries, if any. */
  failCode: null as string | null,
  context: {
    id: "user_1",
    role: "OWNER" as string,
    jobFunction: null as string | null,
    company: { id: "co_A" },
  },
  denied: new Set<string>(),
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

function pick(name: string, row: Row, select?: Record<string, unknown>): Record<string, unknown> {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(select)) {
    if (!value) continue;
    if (name === "job" && key === "contact") {
      const contact = table("contact").find((c) => c.id === row.contactId);
      out.contact = contact ? pick("contact", contact, (value as { select: Record<string, unknown> }).select) : null;
    } else {
      out[key] = row[key];
    }
  }
  return out;
}

function model(name: string) {
  const write = (op: string) => {
    const what = `${name}.${op}`;
    state.writes.push(`${what}@${state.txDepth > 0 ? "tx" : "bare"}`);
    if (state.failNext === what) {
      state.failNext = null;
      throw Object.assign(new Error(`simulated failure: ${what}`), state.failCode ? { code: state.failCode } : {});
    }
  };
  const insert = (data: Record<string, unknown>) => {
    const row = { id: `${name}_${++state.seq}`, ...data } as Row;
    table(name).push(row);
    return row;
  };
  return {
    findMany: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> } = {}) =>
      table(name)
        .filter((row) => matches(row, args.where))
        .map((row) => pick(name, row, args.select)),
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      write("createMany");
      data.forEach(insert);
      return { count: data.length };
    },
    createManyAndReturn: async ({ data, select }: { data: Record<string, unknown>[]; select?: Record<string, unknown> }) => {
      write("createManyAndReturn");
      return data.map(insert).map((row) => pick(name, row, select));
    },
  };
}

const client: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_target, property) => {
      if (property === "then" || typeof property === "symbol") return undefined;
      if (property === "$transaction") {
        return async (fn: (tx: unknown) => Promise<unknown>, options: unknown) => {
          if (typeof fn !== "function") throw new Error("only interactive transactions are faked");
          state.txOptions.push(options);
          const snapshot = new Map([...state.tables].map(([k, rows]) => [k, [...rows]]));
          state.txDepth++;
          try {
            return await fn(client);
          } catch (err) {
            state.tables = snapshot;
            throw err;
          } finally {
            state.txDepth--;
          }
        };
      }
      return model(String(property));
    },
  },
);

vi.mock("@prova/db", () => ({ prisma: client, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => state.context }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...real,
    can: (user: Parameters<typeof real.can>[0], capability: Parameters<typeof real.can>[1]) =>
      !state.denied.has(capability) && real.can(user, capability),
  };
});

const { importClients, importJobs, importCrew } = await import("./spreadsheetImport");
const { planClientImport, planCrewImport, planJobImport } = await import("@/lib/spreadsheet-import");

function form(csv: string) {
  const fd = new FormData();
  fd.set("csv", csv);
  return fd;
}

const rows = (name: string, companyId?: string) =>
  table(name).filter((row) => companyId === undefined || row.companyId === companyId);

function seed() {
  state.tables = new Map();
  state.seq = 0;
  state.writes = [];
  state.txOptions = [];
  state.failNext = null;
  state.failCode = null;
  state.denied = new Set();
  state.context.role = "OWNER";
  state.context.jobFunction = null;

  // Ours.
  table("contact").push({ id: "c_A_acme", companyId: "co_A", name: "Acme Builders" });
  table("job").push({ id: "j_A_tower", companyId: "co_A", contactId: "c_A_acme", name: "Tower" });
  table("crewMember").push({
    id: "m_A_maria", companyId: "co_A", legalFirstName: "Maria", legalMiddleName: null, legalLastName: "Lopez", employeeNumber: null,
  });
  // Theirs — every one of these would match the uploads below by name.
  table("contact").push({ id: "c_B_zenith", companyId: "co_B", name: "Zenith GC" });
  table("job").push({ id: "j_B_harbor", companyId: "co_B", contactId: "c_B_zenith", name: "Harbor" });
  table("crewMember").push({
    id: "m_B_john", companyId: "co_B", legalFirstName: "John", legalMiddleName: null, legalLastName: "Smith", employeeNumber: "E-1",
  });
}

beforeEach(seed);

const theirs = () => JSON.stringify(["contact", "job", "crewMember"].map((t) => rows(t, "co_B")));

describe("importClients", () => {
  const CSV = "Name,Type,Email\nacme builders,GC,\nZenith GC,,pm@zenith.co\nNorth Supply,vendor,\n,gc,\nBad,architect,";

  it("writes exactly the previewed creates, for this company only, and a second run creates nothing", async () => {
    const before = theirs();
    // What the page would have previewed, from what the page would have read.
    const preview = planClientImport(CSV, rows("contact", "co_A").map((c) => c.name as string));
    const first = await importClients(form(CSV));
    expect(rows("contact", "co_A").slice(1).map((c) => c.name)).toEqual(preview.create.map((r) => r.name));
    expect(first).toEqual({ ok: true, value: expect.objectContaining({ created: 2, alreadyThere: 1, skipped: 2 }) });

    const ours = rows("contact", "co_A").map((c) => [c.name, c.accountType, c.email]);
    expect(ours).toEqual([
      ["Acme Builders", undefined, undefined],
      // Company B's "Zenith GC" did not count as already here.
      ["Zenith GC", "GENERAL_CONTRACTOR", "pm@zenith.co"],
      ["North Supply", "VENDOR", null],
    ]);
    expect(theirs()).toBe(before);

    const again = await importClients(form(CSV));
    expect(again).toEqual({ ok: true, value: expect.objectContaining({ created: 0, alreadyThere: 3 }) });
    expect(rows("contact", "co_A")).toHaveLength(3);
    expect(rows("contact")).toHaveLength(4);
  });

  it("writes inside one serializable transaction", async () => {
    await importClients(form(CSV));
    expect(state.writes).toEqual(["contact.createMany@tx"]);
    expect(state.txOptions).toEqual([expect.objectContaining({ isolationLevel: "Serializable" })]);
  });

  it("returns a sentence, not a throw, when Postgres refuses an overlapping import (P2034)", async () => {
    state.failNext = "contact.createMany";
    state.failCode = "P2034";
    const result = await importClients(form(CSV));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("at the same moment") });
    expect(rows("contact", "co_A")).toHaveLength(1);
  });
});

describe("importJobs", () => {
  const CSV = [
    "Job Name,Client,Status,Start Date,End Date,Contract Value",
    "tower,ACME BUILDERS,Contracted,,,$90000",
    "Harbor,Zenith GC,In progress,2026-03-01,4/15/2026,$120000",
    "Pier,Brand New GC,,,,",
    "Dock,brand new gc,complete,,,",
    "Bad,Acme Builders,,2026-02-30,,",
  ].join("\n");

  it("attaches to this company's clients, creates each new client once, and never touches company B", async () => {
    const before = theirs();
    const preview = planJobImport(
      CSV,
      rows("contact", "co_A").map((c) => c.name as string),
      [{ name: "Tower", clientName: "Acme Builders" }],
    );
    const result = await importJobs(form(CSV));
    expect(rows("job", "co_A").slice(1).map((j) => j.name)).toEqual(preview.create.map((r) => r.name));
    expect(rows("contact", "co_A").slice(1).map((c) => c.name)).toEqual(preview.newClients);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ created: 3, alreadyThere: 1, skipped: 1, clientsCreated: 2 }),
    });

    const contacts = rows("contact", "co_A");
    expect(contacts.map((c) => c.name)).toEqual(["Acme Builders", "Zenith GC", "Brand New GC"]);
    const idOf = (name: string) => contacts.find((c) => c.name === name)?.id;

    const created = rows("job", "co_A").filter((j) => j.id !== "j_A_tower");
    expect(created.map((j) => [j.name, j.contactId, j.status])).toEqual([
      ["Harbor", idOf("Zenith GC"), "ESTIMATE"],
      ["Pier", idOf("Brand New GC"), "ESTIMATE"],
      ["Dock", idOf("Brand New GC"), "ESTIMATE"],
    ]);
    // Never company B's Zenith, whose name matched.
    expect(created.map((j) => j.contactId)).not.toContain("c_B_zenith");
    expect((created[0].startDate as Date).toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect((created[0].endDate as Date).toISOString()).toBe("2026-04-15T00:00:00.000Z");
    // No money column exists to write, and none was.
    for (const job of created) expect(Object.keys(job).sort()).toEqual(
      ["companyId", "contactId", "endDate", "id", "name", "scope", "startDate", "status"],
    );
    expect(theirs()).toBe(before);

    const again = await importJobs(form(CSV));
    expect(again).toEqual({ ok: true, value: expect.objectContaining({ created: 0, alreadyThere: 4, clientsCreated: 0 }) });
    expect(rows("job", "co_A")).toHaveLength(4);
    expect(rows("contact", "co_A")).toHaveLength(3);
  });

  it("is all-or-nothing: a failed job insert takes the new clients with it", async () => {
    state.failNext = "job.createMany";
    await expect(importJobs(form(CSV))).rejects.toThrow("simulated failure");
    expect(rows("contact", "co_A").map((c) => c.name)).toEqual(["Acme Builders"]);
    expect(rows("job", "co_A")).toHaveLength(1);
    expect(state.writes).toEqual(["contact.createManyAndReturn@tx", "job.createMany@tx"]);
  });
});

describe("importCrew", () => {
  const CSV = [
    "First Name,Last Name,Employee #,Last 4 of SSN,Hire Date",
    "MARIA,lopez,,,",
    "John,Smith,E-1,0042,3/2/2024",
    "Ana,Ruiz,E-9,123-45-6789,",
    "Peta,Ng,,XXX-XX-7788,",
  ].join("\n");

  it("creates only this company's missing crew, stores four digits at most, and a second run creates nothing", async () => {
    const before = theirs();
    const preview = planCrewImport(CSV, [
      { legalFirstName: "Maria", legalMiddleName: null, legalLastName: "Lopez", employeeNumber: null },
    ]);
    const result = await importCrew(form(CSV));
    expect(rows("crewMember", "co_A").slice(1).map((m) => m.legalFirstName)).toEqual(
      preview.create.map((r) => r.legalFirstName),
    );
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ created: 2, alreadyThere: 1, skipped: 1 }) });

    const created = rows("crewMember", "co_A").filter((m) => m.id !== "m_A_maria");
    expect(created.map((m) => [m.legalFirstName, m.employeeNumber, m.identifyingNumberLast4])).toEqual([
      // Company B's John Smith E-1 is someone else's employee.
      ["John", "E-1", "0042"],
      ["Peta", null, "7788"],
    ]);
    expect((created[0].hiredOn as Date).toISOString()).toBe("2024-03-02T00:00:00.000Z");
    for (const member of rows("crewMember")) {
      expect(member.identifyingNumberLast4 ?? "0000").toMatch(/^\d{4}$/);
    }
    expect(JSON.stringify([...state.tables])).not.toContain("6789");
    expect(theirs()).toBe(before);

    const again = await importCrew(form(CSV));
    expect(again).toEqual({ ok: true, value: expect.objectContaining({ created: 0, alreadyThere: 3 }) });
    expect(rows("crewMember", "co_A")).toHaveLength(3);
  });
});

describe("who may confirm", () => {
  it("refuses a non-owner before any query", async () => {
    state.context.role = "MEMBER";
    for (const action of [importClients, importJobs, importCrew]) {
      const result = await action(form("Name\nX"));
      expect(result).toEqual({ ok: false, error: expect.stringContaining("Only the account owner") });
    }
    expect(state.writes).toEqual([]);
    expect(state.txOptions).toEqual([]);
  });

  it("asks for MANAGE_JOBS on clients and jobs, and MANAGE_FIELD on crew", async () => {
    state.denied = new Set(["MANAGE_JOBS"]);
    expect(await importClients(form("Name\nX"))).toEqual({ ok: false, error: expect.stringContaining("job function") });
    expect(await importJobs(form("Job,Client\nX,Y"))).toEqual({ ok: false, error: expect.stringContaining("job function") });
    expect(state.txOptions).toEqual([]);
    // Crew does not answer to MANAGE_JOBS...
    expect(await importCrew(form("First,Last\nA,B"))).toEqual({ ok: true, value: expect.anything() });

    state.denied = new Set(["MANAGE_FIELD"]);
    state.txOptions = [];
    expect(await importCrew(form("First,Last\nC,D"))).toEqual({ ok: false, error: expect.stringContaining("job function") });
    expect(state.txOptions).toEqual([]);
    // ...and clients do not answer to MANAGE_FIELD.
    expect(await importClients(form("Name\nX"))).toEqual({ ok: true, value: expect.anything() });
  });
});
