import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The proposal clause writes, pinned where a person cannot click them.
 *
 *   1. A clause pulled onto a job's proposal is a SNAPSHOT. Editing — or
 *      deleting — the library clause afterwards does not move the text on a
 *      proposal that may already have gone to a GC. This is the property the
 *      whole two-table shape exists for, so it is tested by doing exactly
 *      that and reading the job's row back.
 *   2. Every refusal is RETURNED, never thrown — production redacts a thrown
 *      Server Action message, and "write the clause text first" is a
 *      sentence somebody needs to read.
 *   3. Every read and write is scoped by company IN THE WHERE. The fake
 *      below honours `companyId`, so a query that forgot it would match
 *      another company's row here and fail.
 *   4. Deleting a library clause is owner-only, and a refused delete deletes
 *      nothing.
 *   5. MANAGE_ESTIMATING is asserted before anything is read.
 */

type Row = Record<string, unknown> & { id: string; companyId: string };

let library: Row[] = [];
let jobClauses: Row[] = [];
let jobs: Row[] = [];
let reads = 0;

const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([key, value]) => row[key] === value);

function table(rows: () => Row[], set: (next: Row[]) => void, prefix: string) {
  return {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { ...data, id: `${prefix}_${rows().length + 1}` } as Row;
      set([...rows(), row]);
      return row;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      reads += 1;
      return rows().find((row) => matches(row, where)) ?? null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows().find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const hit = rows().filter((row) => matches(row, where));
      set(rows().filter((row) => !hit.includes(row)));
      return { count: hit.length };
    },
  };
}

vi.mock("@prova/db", () => ({
  prisma: {
    proposalClause: table(() => library, (next) => (library = next), "lib"),
    jobProposalClause: table(() => jobClauses, (next) => (jobClauses = next), "jpc"),
    job: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        reads += 1;
        return jobs.find((row) => matches(row, where)) ?? null;
      },
    },
  },
}));

const actions = () => import("./proposals");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  library = [
    { id: "dumpsters", companyId: "co_1", kind: "EXCLUSION", text: "Excluded: owner-furnished dumpsters" },
    { id: "theirs", companyId: "co_2", kind: "EXCLUSION", text: "Another company's clause" },
  ];
  jobClauses = [];
  jobs = [
    { id: "job_1", companyId: "co_1" },
    { id: "job_other", companyId: "co_2" },
  ];
  reads = 0;
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("a clause on a job's proposal is a snapshot", () => {
  it("keeps its text when the library clause is edited afterwards", async () => {
    const { addProposalClauseToJob, updateProposalClause } = await actions();

    expect(await addProposalClauseToJob("job_1", form({ clauseId: "dumpsters" }))).toEqual({ ok: true });
    expect(jobClauses).toHaveLength(1);
    expect(jobClauses[0]).toMatchObject({ jobId: "job_1", companyId: "co_1", kind: "EXCLUSION", text: "Excluded: owner-furnished dumpsters" });

    expect(
      await updateProposalClause("dumpsters", form({ kind: "CLARIFICATION", text: "Dumpsters by others" })),
    ).toEqual({ ok: true });
    expect(library.find((c) => c.id === "dumpsters")).toMatchObject({ kind: "CLARIFICATION", text: "Dumpsters by others" });

    // The proposal a GC may already hold did not move.
    expect(jobClauses[0]).toMatchObject({ kind: "EXCLUSION", text: "Excluded: owner-furnished dumpsters" });
  });

  it("keeps its text when the library clause is deleted afterwards", async () => {
    const { addProposalClauseToJob, deleteProposalClause } = await actions();
    await addProposalClauseToJob("job_1", form({ clauseId: "dumpsters" }));
    expect(await deleteProposalClause("dumpsters")).toEqual({ ok: true });
    expect(jobClauses[0]).toMatchObject({ text: "Excluded: owner-furnished dumpsters" });
  });

  it("can be typed inline for one job, and stores the kind it was given", async () => {
    const { addProposalClauseToJob } = await actions();
    const result = await addProposalClauseToJob(
      "job_1",
      form({ kind: "ALTERNATE", text: "Add Level 5 finish in the lobby" }),
    );
    expect(result).toEqual({ ok: true });
    expect(jobClauses[0]).toMatchObject({ kind: "ALTERNATE", text: "Add Level 5 finish in the lobby" });
    expect(library).toHaveLength(2); // an inline clause does not join the library
  });
});

describe("refusals are returned as sentences", () => {
  it("refuses a blank clause, and writes nothing", async () => {
    const { createProposalClause, addProposalClauseToJob } = await actions();
    expect(await createProposalClause(form({ kind: "EXCLUSION", text: "   " }))).toEqual({
      ok: false,
      error: "Write the clause text first.",
    });
    expect(await addProposalClauseToJob("job_1", form({ kind: "EXCLUSION", text: "" }))).toMatchObject({ ok: false });
    expect(library).toHaveLength(2);
    expect(jobClauses).toHaveLength(0);
  });

  it("files a forged kind as an exclusion rather than failing the form", async () => {
    const { createProposalClause } = await actions();
    await createProposalClause(form({ kind: "DROP TABLE", text: "Excluded: permits" }));
    expect(library.at(-1)).toMatchObject({ kind: "EXCLUSION", text: "Excluded: permits" });
  });
});

describe("company scoping", () => {
  it("cannot copy another company's library clause onto a proposal", async () => {
    const { addProposalClauseToJob } = await actions();
    const result = await addProposalClauseToJob("job_1", form({ clauseId: "theirs" }));
    expect(result).toMatchObject({ ok: false });
    expect(jobClauses).toHaveLength(0);
  });

  it("cannot add to another company's job, and says so rather than throwing", async () => {
    const { addProposalClauseToJob } = await actions();
    const result = await addProposalClauseToJob("job_other", form({ kind: "EXCLUSION", text: "x" }));
    expect(result).toEqual({ ok: false, error: "That job isn't on your account any more." });
    expect(jobClauses).toHaveLength(0);
  });

  it("cannot edit or delete another company's library clause", async () => {
    const { updateProposalClause, deleteProposalClause } = await actions();
    expect(await updateProposalClause("theirs", form({ kind: "EXCLUSION", text: "mine now" }))).toMatchObject({ ok: false });
    expect(await deleteProposalClause("theirs")).toMatchObject({ ok: false });
    expect(library.find((c) => c.id === "theirs")).toMatchObject({ text: "Another company's clause" });
  });

  it("cannot remove a clause from another company's job", async () => {
    jobClauses = [{ id: "jpc_x", companyId: "co_2", jobId: "job_other", kind: "EXCLUSION", text: "theirs" }];
    const { removeProposalClause } = await actions();
    expect(await removeProposalClause("job_other", "jpc_x")).toMatchObject({ ok: false });
    expect(jobClauses).toHaveLength(1);
  });
});

describe("who may do what", () => {
  it("lets only the owner delete a library clause, and a refusal deletes nothing", async () => {
    context.role = "MEMBER";
    const { deleteProposalClause } = await actions();
    const result = await deleteProposalClause("dumpsters");
    expect(result).toMatchObject({ ok: false });
    expect(library.find((c) => c.id === "dumpsters")).toBeDefined();
  });

  it("refuses a member without MANAGE_ESTIMATING before reading anything", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const { createProposalClause, addProposalClauseToJob } = await actions();
    expect(await createProposalClause(form({ text: "x" }))).toMatchObject({ ok: false });
    expect(await addProposalClauseToJob("job_1", form({ clauseId: "dumpsters" }))).toMatchObject({ ok: false });
    expect(reads).toBe(0);
    expect(jobClauses).toHaveLength(0);
  });
});
