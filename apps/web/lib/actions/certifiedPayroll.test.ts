// The action that files a WH-347 week, executed.
//
// Every claim here is about a document filed with a government agency, so
// each test states the WRONG BEHAVIOUR it exists to catch and every one of
// them was verified by putting that behaviour back and watching the named
// test go red. The mutation log is in the PR body; the defects reintroduced
// were: the counter replaced by max(n)+1, the counter bumped outside the
// transaction, signedDate stamped from the clock, the duplicate-week guard
// removed, the capability check removed, weekEnding taken from the form,
// and the signature-date floor removed.
//
// WHAT THE FAKE DATABASE DOES AND DOES NOT PROVE. `prisma` is replaced by
// an in-memory store that enforces the two things this action's
// correctness rests on: the `@@unique([jobId, weekEnding])` constraint
// (throwing a `P2002`-shaped error, the same shape
// `isUniqueConstraintError` was measured against on 2026-08-28), and
// TRANSACTION ROLLBACK — state is snapshotted before the callback and
// restored if it throws. That rollback is what Postgres does; the claim
// under test is not that Postgres works, it is that THE COUNTER INCREMENT
// HAPPENS INSIDE THE CALLBACK, which is the half a unit test can see and
// the half that has been got wrong (`nextInvoiceNumber` in billing.ts
// still gets it wrong today).
//
// It cannot prove the constraint exists in the database. That lives in
// packages/db/prisma/schema/migrations/20260907160000_add_certified_payroll_filing/migration.sql,
// and the last test in this file reads that file rather than asserting it
// from memory.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type JobRow = {
  id: string;
  companyId: string;
  projectLocation: string | null;
  contractNumber: string | null;
};

type FilingRow = {
  id: string;
  jobId: string;
  weekEnding: Date;
  payrollNumber: number;
  isFinal: boolean;
  fringeMethod: string;
  exceptions: string | null;
  signedByUserId: string;
  signedDate: Date;
};

const { state, prismaStub, principal } = vi.hoisted(() => {
  const store = {
    jobs: [
      { id: "job-1", companyId: "company-1", projectLocation: null, contractNumber: null },
      { id: "job-other", companyId: "company-2", projectLocation: null, contractNumber: null },
    ] as JobRow[],
    filings: [] as FilingRow[],
    counters: new Map<string, number>(),
    /** Every counter value this run handed out, in order. Lets a test say
     * "the failed attempt consumed a number" precisely rather than
     * inferring it from the next success. */
    issued: [] as number[],
  };

  /** One Prisma-shaped client over `store`. The transaction client and the
   * top-level client are the same object graph, which is exactly what a
   * fake must NOT get wrong in the other direction: if `tx` wrote to a
   * different store, the rollback test below would pass for the wrong
   * reason. */
  function client() {
    return {
      job: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          store.jobs.find((j) => j.id === where.id) ?? null,
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Pick<JobRow, "projectLocation" | "contractNumber">>;
        }) => {
          const row = store.jobs.find((j) => j.id === where.id);
          if (!row) throw new Error("update on a job that does not exist");
          Object.assign(row, data);
          return row;
        },
      },
      certifiedPayrollFilingCounter: {
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { jobId: string };
          create: { jobId: string; lastNumber: number };
          update: { lastNumber: { increment: number } };
        }) => {
          const current = store.counters.get(where.jobId);
          const next =
            current === undefined ? create.lastNumber : current + update.lastNumber.increment;
          store.counters.set(where.jobId, next);
          store.issued.push(next);
          return { lastNumber: next };
        },
      },
      certifiedPayrollFiling: {
        findMany: async ({ where }: { where: { jobId: string } }) =>
          store.filings.filter((f) => f.jobId === where.jobId),
        findFirst: async ({ where }: { where: { jobId: string } }) =>
          store.filings.filter((f) => f.jobId === where.jobId).at(-1) ?? null,
        create: async ({ data }: { data: Omit<FilingRow, "id"> }) => {
          // @@unique([jobId, weekEnding]).
          const clash = store.filings.some(
            (f) => f.jobId === data.jobId && f.weekEnding.getTime() === data.weekEnding.getTime(),
          );
          if (clash) {
            const err = new Error(
              "Unique constraint failed on the fields: (`jobId`,`weekEnding`)",
            ) as Error & { code: string };
            err.code = "P2002";
            throw err;
          }
          const row: FilingRow = { id: `filing-${store.filings.length + 1}`, ...data };
          store.filings.push(row);
          return row;
        },
      },
    };
  }

  const stub = {
    ...client(),
    $transaction: async (fn: (tx: ReturnType<typeof client>) => Promise<unknown>) => {
      const filings = [...store.filings];
      const counters = new Map(store.counters);
      try {
        return await fn(client());
      } catch (err) {
        // What Postgres does. Without it, "the counter is bumped inside
        // the transaction" would be untestable from here.
        store.filings = filings;
        store.counters = counters;
        throw err;
      }
    },
  };

  return {
    state: store,
    prismaStub: stub,
    principal: {
      id: "user-signer",
      name: "Rosa Delgado" as string | null,
      email: "rosa@ridgeline.test",
      role: "MEMBER" as string,
      jobFunction: "PAYROLL_COMPLIANCE" as string | null,
      company: { id: "company-1" },
    },
  };
});

vi.mock("@prova/db", () => ({ prisma: prismaStub, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => principal }));

import { recordJobContractDetails, recordStatementOfCompliance } from "./certifiedPayroll";

/** Sunday 2026-03-01 through Saturday 2026-03-07. Chosen because the
 * signature-date tests need a fixed date that is provably not today, and
 * a hard-coded week makes that checkable. */
const WEEK_START = "2026-03-01";
const WEEK_ENDING = utc("2026-03-07");
/** After the week ended, and — asserted below — not today, so a test that
 * passes because the clock happened to agree cannot exist. */
const SIGNED_ON = "2026-03-09";

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  const fields: Record<string, string> = {
    jobId: "job-1",
    weekStart: WEEK_START,
    signedDate: SIGNED_ON,
    fringeMethod: "APPROVED_PLANS",
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== "") fd.set(key, value);
  }
  return fd;
}

/** The row written by the most recent successful call. */
const lastFiling = () => state.filings[state.filings.length - 1];

beforeEach(() => {
  state.jobs = [
    { id: "job-1", companyId: "company-1", projectLocation: null, contractNumber: null },
    { id: "job-other", companyId: "company-2", projectLocation: null, contractNumber: null },
  ];
  state.filings = [];
  state.counters = new Map();
  state.issued = [];
  principal.role = "MEMBER";
  principal.jobFunction = "PAYROLL_COMPLIANCE";
  principal.name = "Rosa Delgado";
});

describe("the fixtures this file's claims rest on", () => {
  // Guards the guard, twice. Every date assertion below compares against a
  // literal, and two of them would pass for the wrong reason if the
  // literals were badly chosen.
  it("signs on a date that is not today, so a stamped clock cannot masquerade as an entered date", () => {
    expect(SIGNED_ON).not.toBe(new Date().toISOString().slice(0, 10));
  });

  it("uses a week that really does start on a Sunday and end on a Saturday", () => {
    expect(utc(WEEK_START).getUTCDay()).toBe(0);
    expect(WEEK_ENDING.getUTCDay()).toBe(6);
  });

  it("writes a row at all, so every 'it did not do the wrong thing' assertion has something to read", async () => {
    expect(await recordStatementOfCompliance(form())).toEqual({ ok: true });
    expect(state.filings).toHaveLength(1);
  });
});

describe("the payroll number", () => {
  it("comes from a counter, so deleting a filing never reissues its number", async () => {
    // The defect: `max(payrollNumber) + 1` or `count() + 1`. An awarding
    // body reads the payroll sequence looking for gaps, so a second WH-347
    // filed under a number they already hold reads as a falsified payroll.
    // `nextInvoiceNumber` in billing.ts is this bug, live, today.
    await recordStatementOfCompliance(form({ weekStart: "2026-03-01" }));
    await recordStatementOfCompliance(form({ weekStart: "2026-03-08", signedDate: "2026-03-16" }));
    await recordStatementOfCompliance(form({ weekStart: "2026-03-15", signedDate: "2026-03-23" }));
    expect(state.filings.map((f) => f.payrollNumber)).toEqual([1, 2, 3]);

    // Somebody removes the third filing from the database directly — the
    // only way it can go, since this module has no delete path.
    state.filings = state.filings.filter((f) => f.payrollNumber !== 3);

    await recordStatementOfCompliance(form({ weekStart: "2026-03-22", signedDate: "2026-03-30" }));
    expect(
      lastFiling().payrollNumber,
      "the next filing reissued a number an agency already holds",
    ).toBe(4);
  });

  it("is bumped INSIDE the transaction, so a rejected filing consumes no number", async () => {
    // The defect: issuing the number before `prisma.$transaction`, or on
    // `prisma` rather than on `tx`. Both leave a permanent hole in the
    // sequence for every attempt that fails — and the most likely failure
    // is the duplicate week below, i.e. exactly the thing a person does by
    // clicking twice. A hole in the sequence is what an agency reads as a
    // missing week.
    await recordStatementOfCompliance(form({ weekStart: "2026-03-01" }));
    expect(state.issued).toEqual([1]);

    const duplicate = await recordStatementOfCompliance(form({ weekStart: "2026-03-01" }));
    expect(duplicate.ok).toBe(false);

    await recordStatementOfCompliance(form({ weekStart: "2026-03-08", signedDate: "2026-03-16" }));
    expect(
      lastFiling().payrollNumber,
      "the rejected attempt burned a payroll number on its way out",
    ).toBe(2);
    expect(state.counters.get("job-1")).toBe(2);
  });

  it("starts at 1 for a job's first filing, not 0", async () => {
    await recordStatementOfCompliance(form());
    expect(lastFiling().payrollNumber).toBe(1);
  });

  it("is sequential PER JOB — two jobs do not share one series", async () => {
    state.jobs.push({ id: "job-2", companyId: "company-1", projectLocation: null, contractNumber: null });
    await recordStatementOfCompliance(form({ jobId: "job-1" }));
    await recordStatementOfCompliance(form({ jobId: "job-2" }));
    expect(state.filings.map((f) => f.payrollNumber)).toEqual([1, 1]);
  });
});

describe("the signature date", () => {
  it("is the date on the form, never the clock", async () => {
    // The defect: `signedDate: new Date()`. A statement signed on Friday
    // and entered on Monday would be recorded as signed Monday — the app
    // producing a false statement about the date of a sworn document.
    await recordStatementOfCompliance(form({ signedDate: SIGNED_ON }));
    expect(lastFiling().signedDate.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("is stored at UTC midnight, so a comparison between dates is a comparison between days", async () => {
    await recordStatementOfCompliance(form({ signedDate: "2026-04-30" }));
    const stored = lastFiling().signedDate;
    expect(stored.getUTCHours()).toBe(0);
    expect(stored.getUTCMinutes()).toBe(0);
    expect(stored.getUTCSeconds()).toBe(0);
    expect(stored.getUTCMilliseconds()).toBe(0);
  });

  it("is required — an unsigned statement of compliance is not one", async () => {
    const result = await recordStatementOfCompliance(form({ signedDate: "" }));
    expect(result).toEqual({ ok: false, error: "Signature date is required" });
    expect(state.filings).toHaveLength(0);
  });

  it("cannot predate the week it covers, because those hours had not been worked", async () => {
    const result = await recordStatementOfCompliance(form({ signedDate: "2026-03-06" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/before the payroll week ended/);
    expect(state.filings).toHaveLength(0);
  });

  it("allows signing on the last day of the week itself", async () => {
    expect(await recordStatementOfCompliance(form({ signedDate: "2026-03-07" }))).toEqual({
      ok: true,
    });
  });
});

describe("the week is the identity", () => {
  it("derives weekEnding from certifiedPayrollWeekWindow rather than trusting the form", async () => {
    // The defect: storing whatever date was posted. weekEnding is half the
    // identity of a filing AND the key the WH-347 page reads it back by, so
    // a posted date off by a day files a week whose grid shows different
    // hours, and nothing downstream can notice. Posting a Wednesday here
    // proves the Saturday is computed, not copied.
    await recordStatementOfCompliance(form({ weekStart: "2026-03-04" }));
    expect(lastFiling().weekEnding.toISOString()).toBe(WEEK_ENDING.toISOString());
  });

  it("refuses a second filing for a week already filed", async () => {
    // The defect: no P2002 handling — the error escapes, the user gets a
    // 500 instead of a sentence. The worse defect, which the absence of any
    // update path rules out structurally: an upsert, silently replacing
    // what was actually sworn to and sent.
    await recordStatementOfCompliance(form());
    const second = await recordStatementOfCompliance(form({ signedDate: "2026-03-10" }));

    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toMatch(/already been filed/);
    expect(state.filings).toHaveLength(1);
    expect(lastFiling().signedDate.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("does not treat two different weeks of one job as a clash", async () => {
    await recordStatementOfCompliance(form({ weekStart: "2026-03-01" }));
    const next = await recordStatementOfCompliance(
      form({ weekStart: "2026-03-08", signedDate: "2026-03-16" }),
    );
    expect(next).toEqual({ ok: true });
    expect(state.filings).toHaveLength(2);
  });
});

describe("what the signer asserts", () => {
  it("refuses to guess how fringes were paid", async () => {
    // The defect: defaulting fringeMethod. That picks, on the signer's
    // behalf, which of two statements about their own trust-fund
    // arrangements they swore to.
    const result = await recordStatementOfCompliance(form({ fringeMethod: "" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/how fringe benefits were paid/);
    expect(state.filings).toHaveLength(0);
  });

  it("refuses a fringe method that is not one of the form's three answers", async () => {
    const result = await recordStatementOfCompliance(form({ fringeMethod: "NONE" }));
    expect(result.ok).toBe(false);
    expect(state.filings).toHaveLength(0);
  });

  it("records blank 4(c) exceptions as null — a claim of none, not an empty box", async () => {
    await recordStatementOfCompliance(form());
    expect(lastFiling().exceptions).toBeNull();
  });

  it("keeps the exceptions text the signer typed", async () => {
    await recordStatementOfCompliance(form({ exceptions: "Apprentice Ruiz — vacation in cash." }));
    expect(lastFiling().exceptions).toBe("Apprentice Ruiz — vacation in cash.");
  });

  it("defaults isFinal to false and only sets it when the box is ticked", async () => {
    await recordStatementOfCompliance(form());
    expect(lastFiling().isFinal).toBe(false);

    await recordStatementOfCompliance(
      form({ weekStart: "2026-03-08", signedDate: "2026-03-16", isFinal: "on" }),
    );
    expect(lastFiling().isFinal).toBe(true);
  });

  it("records the signed-in person as the signer, whatever the form posts", async () => {
    // The defect: `signedByUserId` taken from the form. The schema has no
    // createdByUserId, so that would let one person put another's name on
    // a perjury-bearing statement with no record of who typed it.
    await recordStatementOfCompliance(form({ signedByUserId: "user-somebody-else" }));
    expect(lastFiling().signedByUserId).toBe("user-signer");
  });
});

describe("who may sign", () => {
  it("refuses a member without MANAGE_COMPLIANCE, and writes nothing", async () => {
    principal.jobFunction = "FIELD";
    const result = await recordStatementOfCompliance(form());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/part of your job function/);
    expect(state.filings).toHaveLength(0);
    expect(state.issued).toEqual([]);
  });

  it("lets the payroll/compliance function through — the people hired to do this", async () => {
    principal.jobFunction = "PAYROLL_COMPLIANCE";
    expect(await recordStatementOfCompliance(form())).toEqual({ ok: true });
  });

  it("lets an owner through regardless of job function", async () => {
    principal.role = "OWNER";
    principal.jobFunction = "FIELD";
    expect(await recordStatementOfCompliance(form())).toEqual({ ok: true });
  });

  it("refuses a job belonging to another company", async () => {
    const result = await recordStatementOfCompliance(form({ jobId: "job-other" }));
    expect(result).toEqual({ ok: false, error: "Job not found" });
    expect(state.filings).toHaveLength(0);
  });

  it("refuses a job that does not exist", async () => {
    const result = await recordStatementOfCompliance(form({ jobId: "job-nope" }));
    expect(result).toEqual({ ok: false, error: "Job not found" });
  });
});

/* ------------------------------------------------------------------ *
 * The identity lock, and the constraint it leans on
 * ------------------------------------------------------------------ */

const MODULE_PATH = join(__dirname, "certifiedPayroll.ts");

/** Comments are stripped before scanning. PR #176's census was silently
 * disarmed for a whole file because an explanatory comment contained the
 * literal pattern it looked for — and this module's comments discuss the
 * very writes the scan forbids, so without this the check would fail on
 * its own prose and then be "fixed" by weakening it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Any write to the filing table that is not a `create`. The prefix match
 * is deliberate: `update` also catches `updateMany` and
 * `updateManyAndReturn`, `delete` also catches `deleteMany`. An
 * alternation that listed the exact method names missed
 * `updateManyAndReturn` in an earlier census in this repo. */
const NON_CREATE_WRITE = /certifiedPayrollFiling\s*\.\s*(update|upsert|delete)/g;

describe("the job's contract details — the header's write path", () => {
  const job = () => state.jobs.find((j) => j.id === "job-1")!;

  function detailsForm(over: Record<string, string> = {}) {
    const fd = new FormData();
    const fields: Record<string, string> = {
      jobId: "job-1",
      projectLocation: "1200 Maple St, Sacramento CA",
      contractNumber: "SAC-2026-0041",
      ...over,
    };
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  /** One filing on job-1, so the after-filing rules have something to be
   * about. Goes through the real action rather than pushing a row, so a
   * test here cannot pass against a filing shape the action would never
   * produce. */
  async function fileAWeek() {
    const result = await recordStatementOfCompliance(form());
    expect(result).toEqual({ ok: true });
  }

  it("writes both fields — the only write path Job.projectLocation and Job.contractNumber have", async () => {
    // The wrong behaviour: these two columns were schema-real and
    // page-read with NO action writing them anywhere, so fileable: true
    // was unreachable in production and nobody's test noticed.
    const result = await recordJobContractDetails(detailsForm());
    expect(result).toEqual({ ok: true });
    expect(job().projectLocation).toBe("1200 Maple St, Sacramento CA");
    expect(job().contractNumber).toBe("SAC-2026-0041");
  });

  it("stores a blank as null, never as an empty string", async () => {
    // lib/wh347.ts treats "" as absent; a stored "" would clear `!= null`
    // reads elsewhere while the printed box is still empty.
    await recordJobContractDetails(detailsForm());
    const result = await recordJobContractDetails(
      detailsForm({ projectLocation: "   ", contractNumber: "" }),
    );
    expect(result).toEqual({ ok: true });
    expect(job().projectLocation).toBeNull();
    expect(job().contractNumber).toBeNull();
  });

  it("edits freely while nothing has been filed — a typo before the first filing is just a typo", async () => {
    await recordJobContractDetails(detailsForm({ contractNumber: "SAC-2026-0014" }));
    const result = await recordJobContractDetails(detailsForm({ contractNumber: "SAC-2026-0041" }));
    expect(result).toEqual({ ok: true });
    expect(job().contractNumber).toBe("SAC-2026-0041");
  });

  it("still fills a BLANK field after a week has been filed — a blank was printed as a red sentence, not a value", async () => {
    await fileAWeek();
    const result = await recordJobContractDetails(detailsForm());
    expect(result).toEqual({ ok: true });
    expect(job().projectLocation).toBe("1200 Maple St, Sacramento CA");
  });

  it("refuses to CHANGE a recorded value once any week is filed, and writes nothing", async () => {
    // The drift this exists to refuse: page 1 prints these live from the
    // Job, so editing them after a filing changes what a reprint of that
    // filed week says — a document the agency already holds.
    await recordJobContractDetails(detailsForm());
    await fileAWeek();
    const result = await recordJobContractDetails(detailsForm({ contractNumber: "SAC-2026-9999" }));
    expect(result).toMatchObject({ ok: false });
    expect(job().contractNumber).toBe("SAC-2026-0041");
    expect(job().projectLocation).toBe("1200 Maple St, Sacramento CA");
  });

  it("refuses to CLEAR a recorded value once any week is filed — clearing is a change", async () => {
    await recordJobContractDetails(detailsForm());
    await fileAWeek();
    const result = await recordJobContractDetails(detailsForm({ projectLocation: "" }));
    expect(result).toMatchObject({ ok: false });
    expect(job().projectLocation).toBe("1200 Maple St, Sacramento CA");
  });

  it("refuses a member without MANAGE_COMPLIANCE, and writes nothing", async () => {
    principal.jobFunction = "FIELD";
    const result = await recordJobContractDetails(detailsForm());
    expect(result).toMatchObject({ ok: false });
    expect(job().projectLocation).toBeNull();
  });

  it("refuses a job belonging to another company", async () => {
    const result = await recordJobContractDetails(detailsForm({ jobId: "job-other" }));
    expect(result).toEqual({ ok: false, error: "Job not found" });
    expect(state.jobs.find((j) => j.id === "job-other")!.projectLocation).toBeNull();
  });
});

describe("identity is locked because there is no write path that could change it", () => {
  it("proves the pattern matches every shape it claims to, so a clean sweep means something", () => {
    // Guards the guard. Without this, a broken regex reads exactly like a
    // module with no update path.
    for (const sample of [
      "await tx.certifiedPayrollFiling.update({ where: { id } })",
      "prisma.certifiedPayrollFiling.updateMany({})",
      "prisma.certifiedPayrollFiling.updateManyAndReturn({})",
      "prisma.certifiedPayrollFiling.upsert({})",
      "prisma.certifiedPayrollFiling.delete({ where: { id } })",
      "prisma.certifiedPayrollFiling.deleteMany({})",
      "prisma . certifiedPayrollFiling . update ({})",
    ]) {
      expect(sample.match(NON_CREATE_WRITE), sample).not.toBeNull();
    }
    // And that it does NOT match the one write this module is allowed.
    expect("tx.certifiedPayrollFiling.create({})".match(NON_CREATE_WRITE)).toBeNull();
  });

  it("has code to scan at all", () => {
    const source = stripComments(readFileSync(MODULE_PATH, "utf8"));
    expect(source.length).toBeGreaterThan(500);
    expect(source).toContain("certifiedPayrollFiling.create");
  });

  it("never updates, upserts or deletes a filing", () => {
    // jobId, weekEnding and payrollNumber are what an agency holds a copy
    // of. Editing any of them turns a filing into a different filing while
    // keeping its signature. The schema deliberately carries no trigger
    // enforcing that (#194 removed one from TimeEntry), so the lock IS the
    // absence of a write path — which makes this scan the enforcement,
    // not a style check.
    const source = stripComments(readFileSync(MODULE_PATH, "utf8"));
    const hits = [...source.matchAll(NON_CREATE_WRITE)].map((m) => m[0]);
    expect(
      hits,
      "A filing is signed under penalty of perjury and an agency already holds it. " +
        "A correction is an AMENDMENT — a new row that supersedes this one and preserves " +
        "it — never an edit. If you are building that flow, this test is the conversation " +
        "to have first.",
    ).toEqual([]);
  });

  it("exports exactly the actions this file argues for, so there is no unexamined door onto these rows", () => {
    // This asserted ["recordStatementOfCompliance"] alone until the job
    // header fields gained their write path. The point was never the
    // NUMBER one — it is that every export of this module was put here on
    // purpose and is covered by the no-update/upsert/delete scan above,
    // which runs over the whole file and therefore over any action listed
    // here. An export appearing that this list does not name is exactly
    // the "second door" the old sentence meant, and still fails.
    const source = stripComments(readFileSync(MODULE_PATH, "utf8"));
    const exported = [...source.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
    expect(exported).toEqual(["recordStatementOfCompliance", "recordJobContractDetails"]);
  });
});

describe("the database constraint the duplicate-week guard leans on", () => {
  // The test above proves the ACTION reports a P2002 properly. It cannot
  // prove Postgres would raise one. This reads the migration, because a
  // guard whose constraint was never created is a guard that never fires.
  const MIGRATION = join(
    __dirname,
    "../../../../packages/db/prisma/schema/migrations",
    "20260907160000_add_certified_payroll_filing/migration.sql",
  );

  it("creates a unique index on (jobId, weekEnding)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "CertifiedPayrollFiling_jobId_weekEnding_key" ON "CertifiedPayrollFiling"\("jobId", "weekEnding"\)/,
    );
  });

  it("gives signedDate no default, so the database can never stamp it", () => {
    // The other half of "entered, not stamped". A DEFAULT CURRENT_TIMESTAMP
    // here would silently misdate every sworn document whose signature date
    // the action ever failed to send.
    const sql = readFileSync(MIGRATION, "utf8");
    const column = sql
      .split("\n")
      .find((line) => line.trim().startsWith('"signedDate"')) as string;
    expect(column).toBeDefined();
    expect(column).toContain("NOT NULL");
    expect(column).not.toMatch(/DEFAULT/i);
    // And the control: createdAt, which IS stamped, in the same file.
    const createdAt = sql
      .split("\n")
      .find((line) => line.trim().startsWith('"createdAt"')) as string;
    expect(createdAt).toMatch(/DEFAULT CURRENT_TIMESTAMP/);
  });
});
