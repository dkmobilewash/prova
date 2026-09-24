import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wall schedule's writes, pinned where a person cannot click them.
 *
 *   1. A run write regenerates the estimate's wall lines in the SAME
 *      transaction: add a run, the lines appear; lengthen it, the SAME line
 *      ids carry the new quantities; remove it, the lines are soft-deleted.
 *   2. A price the estimator typed over a generated line SURVIVES a re-sync —
 *      measuring is the schedule's job, pricing is theirs.
 *   3. Editing a wall type NEVER changes an existing estimate by itself; only
 *      the job's own run change or its Refresh button does.
 *   4. After award the runs are locked: a contracted job refuses, in words.
 *   5. Every read and write is scoped by company in the where — the fake below
 *      honours it, so an unscoped query matches another company's row and fails.
 *   6. Capabilities are refused before anything is read, and typed junk comes
 *      back as a sentence, not a throw.
 */

type Row = Record<string, unknown> & { id: string };
type Tables = Record<string, Row[]>;
let db: Tables;
let reads = 0;
let seq = 0;

const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Equality, `{ in }`, `{ not: null }`, and one level of relation filter
 * (`wallType: { companyId }`) — exactly what these actions ask for. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const cond = value as Record<string, unknown>;
      if ("in" in cond) return (cond.in as unknown[]).includes(row[key]);
      if ("not" in cond) return row[key] !== cond.not;
      const parent = db[key === "wallType" ? "wallType" : key]?.find((r) => r.id === row[`${key}Id`]);
      return parent ? matches(parent, cond) : false;
    }
    return row[key] === value;
  });
}

function model(name: string) {
  const rows = () => db[name];
  return {
    findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      reads += 1;
      const row = rows().find((r) => matches(r, where)) ?? null;
      if (row && select && "_count" in select) {
        return { ...row, _count: { runs: db.wallRun.filter((run) => run.wallTypeId === row.id).length } };
      }
      return row;
    },
    findMany: async ({ where, include }: { where?: Record<string, unknown>; include?: Record<string, unknown> } = {}) => {
      reads += 1;
      const found = rows().filter((r) => matches(r, where));
      if (include?.components) {
        return found.map((type) => ({
          ...type,
          components: db.wallTypeComponent
            .filter((c) => c.wallTypeId === type.id)
            .map((c) => ({ ...c, catalogEntry: db.lineItemCatalogEntry.find((e) => e.id === c.catalogEntryId) ?? null })),
        }));
      }
      return found;
    },
    count: async ({ where }: { where?: Record<string, unknown> } = {}) => rows().filter((r) => matches(r, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const { components, ...rest } = data as Record<string, unknown> & { components?: { create: Record<string, unknown>[] } };
      const row = { openings: [], isDeleted: false, ...rest, id: `${name}_${++seq}` } as Row;
      rows().push(row);
      for (const child of components?.create ?? []) db.wallTypeComponent.push({ ...child, id: `wallTypeComponent_${++seq}`, wallTypeId: row.id });
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows().find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows().filter((r) => matches(r, where));
      for (const row of hit) Object.assign(row, data);
      return { count: hit.length };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      db[name] = rows().filter((r) => r.id !== where.id);
      return {};
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = rows().length;
      db[name] = rows().filter((r) => !matches(r, where));
      return { count: before - db[name].length };
    },
  };
}

vi.mock("@prova/db", () => {
  const client: Record<string, unknown> = {};
  for (const name of ["job", "wallType", "wallTypeComponent", "wallRun", "jobLineItem", "lineItemCatalogEntry", "craftClassification"]) {
    client[name] = new Proxy({}, { get: (_t, prop) => (model(name) as Record<string, unknown>)[prop as string] });
  }
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
  return { prisma: client };
});

const actions = () => import("./wallTypes");

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

const liveWallLines = (jobId = "job_1") =>
  db.jobLineItem.filter((l) => l.jobId === jobId && !l.isDeleted && l.wallTypeComponentId);
const line = (componentId: string) => liveWallLines().find((l) => l.wallTypeComponentId === componentId)!;

beforeEach(() => {
  seq = 0;
  reads = 0;
  context.role = "OWNER";
  context.jobFunction = null;
  db = {
    job: [
      { id: "job_1", companyId: "co_1", status: "ESTIMATE" },
      { id: "job_done", companyId: "co_1", status: "CONTRACTED" },
      { id: "job_other", companyId: "co_2", status: "ESTIMATE" },
    ],
    lineItemCatalogEntry: [
      { id: "cat_board", companyId: "co_1", defaultUnitPrice: "1.85", defaultBudgetedUnitCost: "0.95", tradeScope: "METAL_FRAMING_DRYWALL", craftClassificationId: null },
    ],
    craftClassification: [],
    wallType: [
      { id: "w1", companyId: "co_1", code: "W1", name: "Studs + ⅝″ both sides", defaultHeightFt: "10", sides: 2, studSpacingIn: "16", sortOrder: 0 },
      { id: "w_theirs", companyId: "co_2", code: "W1", name: "Not yours", defaultHeightFt: "10", sides: 2, studSpacingIn: "16", sortOrder: 0 },
    ],
    wallTypeComponent: [
      { id: "c_studs", wallTypeId: "w1", description: "Studs", unit: "ea", basis: "STUDS", factor: "1", wastePercent: "0", roundUp: true, productionRate: null, catalogEntryId: null, craftClassificationId: null, sortOrder: 0 },
      { id: "c_board", wallTypeId: "w1", description: "⅝″ Type X", unit: "sq ft", basis: "BOARDED_SQFT", factor: "1", wastePercent: "0", roundUp: false, productionRate: "50", catalogEntryId: "cat_board", craftClassificationId: null, sortOrder: 1 },
    ],
    wallRun: [],
    jobLineItem: [],
  };
});

describe("a run write keeps the estimate's wall lines in step", () => {
  it("adds the lines when the first run goes in, priced from the catalog where linked", async () => {
    const { addWallRun } = await actions();
    const result = await addWallRun("job_1", form({ label: "L2 corridor", wallTypeId: "w1", lengthFt: "100" }));
    expect(result).toMatchObject({ ok: true, value: { created: 2, updated: 0, removed: 0 } });
    expect(line("c_studs")).toMatchObject({ description: "W1 — Studs", quantity: "76", unitPrice: null });
    // 100 ft × 10 ft × both sides = 2000 sq ft; 2000 / 50 = 40 hrs.
    expect(line("c_board")).toMatchObject({
      quantity: "2000",
      laborHours: "40",
      unitPrice: "1.85",
      budgetedUnitCost: "0.95",
      sourceCatalogEntryId: "cat_board",
      priceBasis: "COMPANY_CATALOG",
    });
  });

  it("moves quantities on the SAME lines when a run changes, and keeps a price the estimator typed", async () => {
    const { addWallRun, updateWallRun } = await actions();
    await addWallRun("job_1", form({ label: "L2", wallTypeId: "w1", lengthFt: "100" }));
    const boardId = line("c_board").id;
    line("c_board").unitPrice = "2.10"; // the estimator re-priced it by hand

    const runId = db.wallRun[0].id;
    const result = await updateWallRun("job_1", runId, form({ label: "L2", wallTypeId: "w1", lengthFt: "120" }));
    expect(result).toMatchObject({ ok: true, value: { created: 0, updated: 2, removed: 0 } });
    expect(line("c_board").id).toBe(boardId);
    expect(line("c_board")).toMatchObject({ quantity: "2400", laborHours: "48", unitPrice: "2.10" });
    expect(liveWallLines()).toHaveLength(2);
  });

  it("sums two runs of one type onto one line per part", async () => {
    const { addWallRun } = await actions();
    await addWallRun("job_1", form({ label: "A", wallTypeId: "w1", lengthFt: "100" }));
    await addWallRun("job_1", form({ label: "B", wallTypeId: "w1", lengthFt: "20" }));
    expect(liveWallLines()).toHaveLength(2);
    expect(line("c_studs").quantity).toBe(String(76 + 16));
  });

  it("soft-deletes the wall lines when the last run is removed", async () => {
    const { addWallRun, deleteWallRun } = await actions();
    await addWallRun("job_1", form({ label: "L2", wallTypeId: "w1", lengthFt: "100" }));
    const result = await deleteWallRun("job_1", db.wallRun[0].id);
    expect(result).toMatchObject({ ok: true, value: { removed: 2 } });
    expect(liveWallLines()).toHaveLength(0);
    // Soft, not hard: the rows are still there for history.
    expect(db.jobLineItem.filter((l) => l.isDeleted)).toHaveLength(2);
  });
});

describe("the library does not reach into an estimate by itself", () => {
  it("leaves a job's lines alone when a wall type changes, until the job is refreshed", async () => {
    const { addWallRun, updateWallTypeComponent, refreshWallSchedule } = await actions();
    await addWallRun("job_1", form({ label: "L2", wallTypeId: "w1", lengthFt: "100" }));

    // Two layers each side now — the library changed.
    expect(
      await updateWallTypeComponent("c_board", form({ description: "⅝″ Type X", unit: "sq ft", basis: "BOARDED_SQFT", factor: "2", productionRate: "50", catalogEntryId: "cat_board" })),
    ).toEqual({ ok: true });
    expect(line("c_board").quantity).toBe("2000");

    const refreshed = await refreshWallSchedule("job_1");
    expect(refreshed).toMatchObject({ ok: true, value: { updated: 2 } });
    expect(line("c_board").quantity).toBe("4000");
  });

  it("refuses to delete a wall type any run still uses, and says how many", async () => {
    const { addWallRun, deleteWallType } = await actions();
    await addWallRun("job_1", form({ label: "L2", wallTypeId: "w1", lengthFt: "100" }));
    const result = await deleteWallType("w1");
    expect(result).toEqual({ ok: false, error: "W1 is on 1 wall run. Remove that run from their jobs first." });
    expect(db.wallType.find((t) => t.id === "w1")).toBeDefined();
  });
});

describe("refusals, in words", () => {
  it("locks the runs once the job is contracted", async () => {
    const { addWallRun } = await actions();
    const result = await addWallRun("job_done", form({ label: "L2", wallTypeId: "w1", lengthFt: "100" }));
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/change order/);
    expect(db.wallRun).toHaveLength(0);
  });

  it("returns a sentence for a length it cannot read, and writes nothing", async () => {
    const { addWallRun } = await actions();
    const result = await addWallRun("job_1", form({ label: "L2", wallTypeId: "w1", lengthFt: "about a hundred" }));
    expect(result).toMatchObject({ ok: false });
    expect(db.wallRun).toHaveLength(0);
    expect(db.jobLineItem).toHaveLength(0);
  });

  it("refuses a wall type with no tag from the drawings, in words", async () => {
    const { createWallType } = await actions();
    const result = await createWallType(form({ code: "", name: "No tag", studSpacingIn: "16" }));
    expect(result).toEqual({ ok: false, error: "Give the wall type its tag from the drawings — W1, P-4A." });
  });
});

describe("company scoping", () => {
  it("cannot put another company's wall type on a run", async () => {
    const { addWallRun } = await actions();
    const result = await addWallRun("job_1", form({ label: "L2", wallTypeId: "w_theirs", lengthFt: "100" }));
    expect(result).toEqual({ ok: false, error: "Pick the wall type from your schedule." });
    expect(db.wallRun).toHaveLength(0);
  });

  it("cannot add a run to another company's job", async () => {
    const { addWallRun } = await actions();
    const result = await addWallRun("job_other", form({ label: "L2", wallTypeId: "w1", lengthFt: "100" }));
    expect(result).toEqual({ ok: false, error: "That job isn't on your account any more." });
  });

  it("cannot edit or remove a part of another company's wall type", async () => {
    db.wallTypeComponent.push({ id: "c_theirs", wallTypeId: "w_theirs", description: "x", unit: null, basis: "STUDS", factor: "1", wastePercent: "0", roundUp: false, productionRate: null, catalogEntryId: null, craftClassificationId: null, sortOrder: 0 });
    const { updateWallTypeComponent, removeWallTypeComponent } = await actions();
    expect(await updateWallTypeComponent("c_theirs", form({ description: "mine", basis: "STUDS", factor: "1" }))).toMatchObject({ ok: false });
    expect(await removeWallTypeComponent("c_theirs")).toMatchObject({ ok: false });
    expect(db.wallTypeComponent.find((c) => c.id === "c_theirs")).toMatchObject({ description: "x" });
  });
});

describe("who may do what", () => {
  it("refuses a job function without VIEW_JOB_COSTS before reading anything", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const { addWallRun, refreshWallSchedule } = await actions();
    expect(await addWallRun("job_1", form({ label: "L2", wallTypeId: "w1", lengthFt: "100" }))).toMatchObject({ ok: false });
    expect(await refreshWallSchedule("job_1")).toMatchObject({ ok: false });
    expect(reads).toBe(0);
  });

  it("lets only the owner delete a wall type", async () => {
    context.role = "MEMBER";
    const { deleteWallType } = await actions();
    expect(await deleteWallType("w1")).toMatchObject({ ok: false });
    expect(db.wallType.find((t) => t.id === "w1")).toBeDefined();
  });
});

describe("starter wall types", () => {
  it("adds W1 and W2, unpriced and without crew rates, and not twice", async () => {
    db.wallType = db.wallType.filter((t) => t.companyId !== "co_1");
    db.wallTypeComponent = [];
    const { addStarterWallTypes } = await actions();
    expect(await addStarterWallTypes()).toEqual({ ok: true, value: { added: ["W1", "W2"] } });
    const mine = db.wallType.filter((t) => t.companyId === "co_1");
    expect(mine.map((t) => t.code)).toEqual(["W1", "W2"]);
    expect(db.wallTypeComponent.every((c) => c.catalogEntryId == null && c.productionRate == null)).toBe(true);
    expect(await addStarterWallTypes()).toMatchObject({ ok: false });
  });
});
