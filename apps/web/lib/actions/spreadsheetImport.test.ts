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

/** Rows inserted through the transaction client of the transaction now
 * running. A rollback removes exactly these — a write made through the BARE
 * client in the middle of a transaction is committed on its own, exactly as
 * Postgres would, and survives the rollback. That is what lets the tests see
 * a write that escaped the transaction, rather than the fake quietly
 * undoing it along with everything else. */
const txInserted = new Set<Row>();

function model(name: string, viaTx: boolean) {
  const write = (op: string) => {
    const what = `${name}.${op}`;
    state.writes.push(`${what}@${viaTx ? "tx" : "bare"}`);
    if (state.failNext === what) {
      state.failNext = null;
      throw Object.assign(new Error(`simulated failure: ${what}`), state.failCode ? { code: state.failCode } : {});
    }
  };
  const insert = (data: Record<string, unknown>) => {
    const row = { id: `${name}_${++state.seq}`, ...data } as Row;
    table(name).push(row);
    if (viaTx) txInserted.add(row);
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

/** The transaction client handed to an interactive transaction's callback —
 * a DIFFERENT object from `client`, as Prisma's is, so a write through
 * `prisma` inside the callback is recorded as `@bare`, not `@tx`. */
const txClient: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_target, property) => {
      if (property === "then" || typeof property === "symbol") return undefined;
      if (property === "$transaction") throw new Error("nested transactions are not faked");
      return model(String(property), true);
    },
  },
);

const client: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_target, property) => {
      if (property === "then" || typeof property === "symbol") return undefined;
      if (property === "$transaction") {
        return async (fn: (tx: unknown) => Promise<unknown>, options: unknown) => {
          if (typeof fn !== "function") throw new Error("only interactive transactions are faked");
          state.txOptions.push(options);
          txInserted.clear();
          state.txDepth++;
          try {
            return await fn(txClient);
          } catch (err) {
            for (const [name, rows] of state.tables) {
              state.tables.set(name, rows.filter((row) => !txInserted.has(row)));
            }
            throw err;
          } finally {
            txInserted.clear();
            state.txDepth--;
          }
        };
      }
      return model(String(property), false);
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

const { importClients, importJobs, importCrew, importPhaseCodes } = await import("./spreadsheetImport");
const { planClientImport, planCrewImport, planJobImport, planPhaseCodeImport } = await import(
  "@/lib/spreadsheet-import"
);

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
  table("phaseCode").push({ id: "pc_A_04112", companyId: "co_A", code: "04112", name: "Plywood" });
  // Theirs — every one of these would match the uploads below by name.
  table("contact").push({ id: "c_B_zenith", companyId: "co_B", name: "Zenith GC" });
  table("job").push({ id: "j_B_harbor", companyId: "co_B", contactId: "c_B_zenith", name: "Harbor" });
  table("crewMember").push({
    id: "m_B_john", companyId: "co_B", legalFirstName: "John", legalMiddleName: null, legalLastName: "Smith", employeeNumber: "E-1",
  });
  table("phaseCode").push({ id: "pc_B_09250", companyId: "co_B", code: "09250", name: "Drywall" });
}

beforeEach(seed);

const theirs = () => JSON.stringify(["contact", "job", "crewMember", "phaseCode"].map((t) => rows(t, "co_B")));

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

describe("importPhaseCodes", () => {
  const CSV = ["Code,Name,Unit", "04112,Plywood again,SF", "09250,drywall,SF", "04220,,SF", "17400,Framing,LF"].join(
    "\n",
  );

  it("creates only this company's missing codes, matched EXACTLY (not case-folded), and a second run creates nothing", async () => {
    const before = theirs();
    const preview = planPhaseCodeImport(
      CSV,
      rows("phaseCode", "co_A").map((c) => c.code as string),
    );
    const result = await importPhaseCodes(form(CSV));
    expect(rows("phaseCode", "co_A").slice(1).map((c) => c.code)).toEqual(preview.create.map((r) => r.code));
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ created: 2, alreadyThere: 1, skipped: 1 }) });

    const created = rows("phaseCode", "co_A").filter((c) => c.id !== "pc_A_04112");
    expect(created.map((c) => [c.code, c.name, c.unit])).toEqual([
      // "04112" already exists on co_A (added by seed as "Plywood") — the
      // upload's own "04112,Plywood again" is left alone, not overwritten.
      // "09250" is company B's code, matched by exact code only when it is
      // company A's own row, so co_A's line for 09250 IS new here.
      ["09250", "drywall", "SF"],
      ["17400", "Framing", "LF"],
    ]);
    // Company B's "09250" is untouched, and never counted as "already here"
    // for company A.
    expect(theirs()).toBe(before);

    const again = await importPhaseCodes(form(CSV));
    expect(again).toEqual({ ok: true, value: expect.objectContaining({ created: 0, alreadyThere: 3, skipped: 1 }) });
    expect(rows("phaseCode", "co_A")).toHaveLength(3);
    expect(rows("phaseCode")).toHaveLength(4);
  });

  it("writes inside one serializable transaction", async () => {
    await importPhaseCodes(form(CSV));
    expect(state.writes).toEqual(["phaseCode.createMany@tx"]);
    expect(state.txOptions).toEqual([expect.objectContaining({ isolationLevel: "Serializable" })]);
  });

  it("returns a sentence, not a throw, when Postgres refuses an overlapping import (P2034)", async () => {
    state.failNext = "phaseCode.createMany";
    state.failCode = "P2034";
    const result = await importPhaseCodes(form(CSV));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("at the same moment") });
    expect(rows("phaseCode", "co_A")).toHaveLength(1);
  });

  it("is owner-only and answers to MANAGE_COMPLIANCE, before any query", async () => {
    state.context.role = "MEMBER";
    expect(await importPhaseCodes(form(CSV))).toEqual({ ok: false, error: expect.stringContaining("Only the account owner") });
    state.context.role = "OWNER";

    state.denied = new Set(["MANAGE_COMPLIANCE"]);
    expect(await importPhaseCodes(form(CSV))).toEqual({ ok: false, error: expect.stringContaining("job function") });
    expect(state.writes).toEqual([]);
    expect(state.txOptions).toEqual([]);

    // MANAGE_JOBS, the capability the other three imports answer to, does
    // NOT gate this one.
    state.denied = new Set(["MANAGE_JOBS"]);
    expect(await importPhaseCodes(form(CSV))).toEqual({ ok: true, value: expect.anything() });
  });
});

describe("every confirm writes inside one serializable transaction, and only there", () => {
  const cases = [
    ["importClients", () => importClients(form("Name\nNew Co")), ["contact.createMany@tx"]],
    [
      "importJobs",
      () => importJobs(form("Job,Client\nPier,Brand New GC")),
      ["contact.createManyAndReturn@tx", "job.createMany@tx"],
    ],
    ["importCrew", () => importCrew(form("First,Last\nAna,Ruiz")), ["crewMember.createMany@tx"]],
    ["importPhaseCodes", () => importPhaseCodes(form("Code,Name\n17400,Framing")), ["phaseCode.createMany@tx"]],
  ] as const;

  for (const [name, run, writes] of cases) {
    it(name, async () => {
      const result = await run();
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ created: 1 }) });
      // Through the transaction client, never the bare one: a bare write
      // commits on its own and survives a rollback of everything else.
      expect(state.writes).toEqual(writes);
      expect(state.txOptions).toEqual([expect.objectContaining({ isolationLevel: "Serializable" })]);
    });
  }
});

describe("size", () => {
  // A Server Action's request body is capped at 1 MB by Next (no
  // serverActions.bodySizeLimit in next.config.mjs). A text the action
  // would accept but Next refuses first never reaches the action at all: it
  // throws, production redacts the message, and the person sees the error
  // page instead of a sentence. So the action's own limit must sit BELOW
  // Next's, counted in BYTES — a 400,000-character paste of accented names
  // is well over a megabyte.
  it("refuses, with a sentence, a text too big to have been sent", async () => {
    const ascii = "Name\n" + "x".repeat(950_000);
    const accented = "Name\n" + "é".repeat(500_000); // 2 bytes each
    for (const text of [ascii, accented]) {
      expect(await importClients(form(text))).toEqual({ ok: false, error: expect.stringContaining("split it") });
    }
    expect(state.txOptions).toEqual([]);
  });
});

describe("who may confirm", () => {
  it("refuses a non-owner before any query", async () => {
    state.context.role = "MEMBER";
    // CREW IS NOT IN THIS LIST ANY MORE, and that is the decision rather
    // than an omission — see the test below and the block at the top of
    // lib/actions/crewMembers.ts.
    for (const action of [importClients, importJobs, importPhaseCodes]) {
      const result = await action(form("Name\nX"));
      expect(result).toEqual({ ok: false, error: expect.stringContaining("Only the account owner") });
    }
    expect(state.writes).toEqual([]);
    expect(state.txOptions).toEqual([]);
  });

  /**
   * THE OFFICE MANAGER CAN GET THE CREW IN.
   *
   * PAYROLL_COMPLIANCE is the job function of the person who runs certified
   * payroll every week. She could already import the payroll REGISTER —
   * that import is deliberately not owner-only, for exactly this reason —
   * and could not create the crew members its rows have to match, because
   * `importCrew` asked for OWNER. The person whose job this is could not do
   * it, and the register import she could reach was matching against a list
   * only somebody else could fill.
   *
   * The pair of assertions is the test: she may ADD, and she may not
   * ARCHIVE. Archiving is the one-way door — there is no un-archive
   * anywhere in the app — so it keeps the owner gate. A test asserting only
   * the first half would pass on an action that had dropped its guards
   * altogether.
   */
  it("lets the payroll & compliance manager import crew, owner or not", async () => {
    state.context.role = "MEMBER";
    state.context.jobFunction = "PAYROLL_COMPLIANCE";
    expect(await importCrew(form("First,Last\nLuis,Ortega"))).toEqual({
      ok: true,
      value: expect.anything(),
    });
    expect(rows("crewMember", "co_A").some((row) => row.legalLastName === "Ortega")).toBe(true);
  });

  it("still refuses crew to a job function without MANAGE_FIELD", async () => {
    state.context.role = "MEMBER";
    // ACCOUNTING holds billing and financials and no field capability at
    // all (lib/permissions.ts), so it is the honest negative case — this
    // is not a capability every member happens to hold.
    state.context.jobFunction = "ACCOUNTING";
    expect(await importCrew(form("First,Last\nLuis,Ortega"))).toEqual({
      ok: false,
      error: expect.stringContaining("job function"),
    });
    expect(state.writes).toEqual([]);
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
