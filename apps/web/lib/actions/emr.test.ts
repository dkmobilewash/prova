import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mod-rate actions: a rate is RECORDED as the bureau issued it.
 *
 * What these pin, each because it would otherwise fail silently:
 *   - one rate per company per effective date, refused in a SENTENCE — the
 *     unique violation must come back as `{ ok: false }`, not a throw that
 *     production redacts to a digest;
 *   - a percentage typed where a decimal belongs ("87") is refused rather
 *     than stored as a mod a hundred times too high;
 *   - update and delete find the row by id AND company — the fake below
 *     honours the where clause, so an action that dropped `companyId` would
 *     edit another tenant's rate and this file would see it;
 *   - the effective date is locked on edit;
 *   - delete is owner-only, refused by return, not by throw.
 */

type Row = Record<string, unknown> & { id: string; companyId: string; effectiveDate: Date };

let rows: Row[] = [];
let seq = 0;

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([key, value]) => row[key] === value);

const experienceModRate = {
  create: vi.fn(async ({ data }: { data: { companyId: string; effectiveDate: Date } & Record<string, unknown> }) => {
    // Enforces @@unique([companyId, effectiveDate]) the way Postgres does,
    // with the error SHAPE Prisma throws — a `code`, not a class, since
    // `instanceof` is false at runtime in this app (see shared.ts).
    const clash = rows.some(
      (row) => row.companyId === data.companyId && row.effectiveDate.getTime() === data.effectiveDate.getTime(),
    );
    if (clash) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const row = { id: `emr_${++seq}`, ...data } as Row;
    rows.push(row);
    return row;
  }),
  findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((row) => matches(row, where)) ?? null),
  update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const index = rows.findIndex((row) => row.id === where.id);
    if (index === -1) throw new Error("Record to update not found");
    rows[index] = { ...rows[index], ...data };
    return rows[index];
  }),
  delete: vi.fn(async ({ where }: { where: { id: string } }) => {
    const index = rows.findIndex((row) => row.id === where.id);
    if (index === -1) throw new Error("Record to delete not found");
    return rows.splice(index, 1)[0];
  }),
};

const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@prova/db", () => ({ Prisma: {}, prisma: { experienceModRate } }));

const { recordExperienceModRate, updateExperienceModRate, deleteExperienceModRate } = await import("./emr");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const valid = { effectiveDate: "2026-01-01", rate: "0.87", source: "NCCI" };

beforeEach(() => {
  rows = [];
  seq = 0;
  context.role = "OWNER";
  context.jobFunction = null;
  vi.clearAllMocks();
});

describe("recordExperienceModRate", () => {
  it("records the rate as typed, at UTC midnight, against the caller's company", async () => {
    expect(await recordExperienceModRate(form({ ...valid, sourceUrl: "https://example.com/ws.pdf" }))).toEqual({ ok: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: "co_1",
      rate: "0.87",
      source: "NCCI",
      sourceUrl: "https://example.com/ws.pdf",
      createdByUserId: "user_1",
    });
    expect((rows[0].effectiveDate as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("refuses a second rate on the same effective date in a sentence, not a throw", async () => {
    await recordExperienceModRate(form(valid));
    const result = await recordExperienceModRate(form({ ...valid, rate: "0.91" }));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/effective 2026-01-01 is already on file/) });
    expect(rows).toHaveLength(1);
  });

  it("allows the same date for a different company", async () => {
    rows.push({ id: "other", companyId: "co_2", effectiveDate: new Date("2026-01-01T00:00:00.000Z"), rate: "1.4" });
    expect(await recordExperienceModRate(form(valid))).toEqual({ ok: true });
  });

  it("refuses a percentage typed where a decimal belongs", async () => {
    const result = await recordExperienceModRate(form({ ...valid, rate: "87" }));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/0\.87/) });
    expect(experienceModRate.create).not.toHaveBeenCalled();
  });

  it("requires the effective date and the source — it never defaults either", async () => {
    expect((await recordExperienceModRate(form({ ...valid, effectiveDate: "" }))).ok).toBe(false);
    expect((await recordExperienceModRate(form({ ...valid, source: " " }))).ok).toBe(false);
    expect(experienceModRate.create).not.toHaveBeenCalled();
  });

  it("refuses a non-http link, which would otherwise land in an href", async () => {
    const result = await recordExperienceModRate(form({ ...valid, sourceUrl: "javascript:alert(1)" }));
    expect(result.ok).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("refuses a member without MANAGE_COMPLIANCE before touching the database", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const result = await recordExperienceModRate(form(valid));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/job function/) });
    expect(experienceModRate.create).not.toHaveBeenCalled();
  });
});

describe("updateExperienceModRate", () => {
  it("corrects the rate and leaves the effective date where it was", async () => {
    await recordExperienceModRate(form(valid));
    const id = rows[0].id;
    const result = await updateExperienceModRate(id, form({ ...valid, effectiveDate: "2030-01-01", rate: "0.85" }));
    expect(result).toEqual({ ok: true });
    expect(rows[0].rate).toBe("0.85");
    expect((rows[0].effectiveDate as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("cannot reach another company's rate by id", async () => {
    rows.push({ id: "theirs", companyId: "co_2", effectiveDate: new Date("2026-01-01T00:00:00.000Z"), rate: "1.4" });
    const result = await updateExperienceModRate("theirs", form({ ...valid, rate: "0.5" }));
    expect(result.ok).toBe(false);
    expect(rows[0].rate).toBe("1.4");
  });
});

describe("deleteExperienceModRate", () => {
  it("lets the owner delete their own company's rate", async () => {
    await recordExperienceModRate(form(valid));
    expect(await deleteExperienceModRate(rows[0].id)).toEqual({ ok: true });
    expect(rows).toHaveLength(0);
  });

  it("refuses a non-owner by RETURNING the refusal", async () => {
    await recordExperienceModRate(form(valid));
    context.role = "MEMBER";
    const result = await deleteExperienceModRate(rows[0].id);
    expect(result).toEqual({ ok: false, error: "Only the account owner can delete a mod rate" });
    expect(rows).toHaveLength(1);
  });

  it("cannot delete another company's rate by id", async () => {
    rows.push({ id: "theirs", companyId: "co_2", effectiveDate: new Date("2026-01-01T00:00:00.000Z"), rate: "1.4" });
    expect((await deleteExperienceModRate("theirs")).ok).toBe(false);
    expect(rows).toHaveLength(1);
  });
});
